/** F4 integration proof: safe registry, health, revoke/reconnect, CAS, replay and audit. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	getDb,
	integrationCommandReceipts,
	integrationConnections,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";
import { recordLuckyOsHealth } from "./src/integrations";

const API = process.env.INTEGRATIONS_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

function sqlState(error: unknown) {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; cause?: unknown };
		if (typeof value.code === "string") return value.code;
		current = value.cause;
	}
	return null;
}

async function login(email: string) {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as unknown as Array<{ identifier: string }>;
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error(`login ${email}: no cookie`);
	return cookie;
}

async function request(cookie: string, path: string, method = "GET", body?: unknown) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: "http://localhost:5173",
			Cookie: cookie,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	return {
		status: response.status,
		text,
		body: JSON.parse(text || "{}") as Record<string, unknown>,
	};
}

async function makeIdentity(slug: string, stamp: string) {
	const [user] = await db
		.insert(users)
		.values({
			name: `Integration ${slug}`,
			email: `integration-${slug}-${stamp}@watson.test`,
			emailVerified: true,
		})
		.returning({ id: users.id, email: users.email });
	if (!user) throw new Error("user insert failed");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Osobní integration ${slug}`, ownerId: user.id, isPersonal: true })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace insert failed");
	await db.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
	return { ...user, workspaceId: workspace.id };
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const first = await makeIdentity("first", stamp);
	const second = await makeIdentity("second", stamp);
	const malformed = await makeIdentity("malformed", stamp);
	try {
		const firstCookie = await login(first.email);
		const secondCookie = await login(second.email);
		const malformedCookie = await login(malformed.email);
		let response = await request(firstCookie, "/api/integrations");
		const initial = (response.body.integrations as Array<Record<string, unknown>> | undefined)?.[0];
		const initialScopes = Array.isArray(initial?.scopes) ? (initial.scopes as string[]) : [];
		check("registry vyžaduje session a vrátí právě LuckyOS", response.status === 200 && initial?.provider === "luckyos", response);
		check(
			"veřejný snapshot neobsahuje tajemství, URL, e-mail ani workspace ID",
			!["token", "secret", "http://", "https://", first.email, first.workspaceId].some((needle) =>
				response.text.toLowerCase().includes(needle.toLowerCase()),
			),
			response.text,
		);
		check(
			"scopes jsou přesné a browser nedostává wildcard",
			initialScopes.length === 4 && !initialScopes.some((scope) => scope.includes("*")),
			initial?.scopes,
		);
		const malformedTest = await request(
			malformedCookie,
			"/api/integrations/luckyos/test",
			"POST",
		);
		const malformedBody = malformedTest.body.integration as Record<string, unknown> | undefined;
		check(
			"HTTP 200 s neplatným provider kontraktem není vydáno za úspěch",
			malformedTest.status === 502 &&
				malformedTest.body.error === "luckyos_contract_rejected" &&
				malformedBody?.status === "degraded",
			malformedTest,
		);
		check(
			"neplatný upstream payload se nevrací ani neukládá do bezpečné odpovědi",
			!malformedTest.text.includes("upstream_secret") &&
				!malformedTest.text.includes("must-not-leak"),
			malformedTest.text,
		);

		response = await request(firstCookie, "/api/integrations/luckyos/test", "POST");
		const tested = response.body.integration as Record<string, unknown> | undefined;
		check("test ověří skutečný bridge adapter", response.status === 200 && response.body.reachable === true, response);
		check(
			"úspěšný test zapíše health bez konfigurace v odpovědi",
			tested?.status === "healthy" && typeof tested.lastSuccessAt === "string" && typeof tested.lastTestedAt === "string",
			tested,
		);
		const version1 = Number(tested?.version);
		const revokeOperation = crypto.randomUUID();
		response = await request(firstCookie, "/api/integrations/luckyos/revoke", "POST", {
			operationId: revokeOperation,
			expectedVersion: version1,
		});
		const revoked = response.body.integration as Record<string, unknown> | undefined;
		check("revoke je serverová lifecycle změna", response.status === 200 && revoked?.status === "revoked", response);
		const revokedVersion = Number(revoked?.version);

		const replay = await request(firstCookie, "/api/integrations/luckyos/revoke", "POST", {
			operationId: revokeOperation,
			expectedVersion: version1,
		});
		const replayedIntegration = replay.body.integration as Record<string, unknown> | undefined;
		check(
			"stejný idempotency command vrátí totožnou odpověď",
			replay.status === 200 &&
				replayedIntegration?.id === revoked?.id &&
				replayedIntegration?.status === revoked?.status &&
				replayedIntegration?.version === revoked?.version &&
				replayedIntegration?.revokedAt === revoked?.revokedAt,
			replay,
		);
		const reused = await request(firstCookie, "/api/integrations/luckyos/revoke", "POST", {
			operationId: revokeOperation,
			expectedVersion: revokedVersion,
		});
		check("operationId nelze použít pro jiný payload", reused.status === 409 && reused.body.error === "idempotency_key_reused", reused);

		const blockedEmployee = await request(firstCookie, "/api/employee/me");
		check(
			"odpojení skutečně zavře employee broker",
			blockedEmployee.status === 200 && blockedEmployee.body.reason === "luckyos_revoked" && blockedEmployee.body.status === 423,
			blockedEmployee,
		);
		const blockedWrite = await request(firstCookie, "/api/employee/expenses", "POST", { id: crypto.randomUUID() });
		check("odpojení zavře také zápisové passthrough", blockedWrite.status === 423 && blockedWrite.body.reason === "luckyos_revoked", blockedWrite);

		const secondRegistry = await request(secondCookie, "/api/integrations");
		const secondConnection = (secondRegistry.body.integrations as Array<Record<string, unknown>> | undefined)?.[0];
		check("revoke jednoho uživatele nezasáhne jiného tenanta", secondConnection?.status !== "revoked", secondConnection);

		response = await request(firstCookie, "/api/integrations/luckyos/reconnect", "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: revokedVersion,
		});
		const reconnected = response.body.integration as Record<string, unknown> | undefined;
		check("reconnect nejdřív ověří provider a pak otevře broker", response.status === 200 && reconnected?.status === "healthy", response);
		const currentVersion = Number(reconnected?.version);
		const stale = await request(firstCookie, "/api/integrations/luckyos/revoke", "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: revokedVersion,
		});
		check("stará CAS verze nic nepřepíše", stale.status === 409 && stale.body.error === "stale_version" && stale.body.currentVersion === currentVersion, stale);
		const openEmployee = await request(firstCookie, "/api/employee/me");
		check("broker po reconnectu opět funguje", openEmployee.status === 200 && openEmployee.body.linked === true, openEmployee);

		const connectionRows = await db
			.select()
			.from(integrationConnections)
			.where(eq(integrationConnections.ownerUserId, first.id));
		const receipts = await db
			.select()
			.from(integrationCommandReceipts)
			.where(eq(integrationCommandReceipts.actorUserId, first.id));
		const audits = await db
			.select()
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, first.workspaceId),
					eq(auditEvents.entity, "integration_connection"),
				),
			);
		check("registry drží právě jeden osobní aggregate", connectionRows.length === 1 && connectionRows[0]?.workspaceId === first.workspaceId, connectionRows);
		check("replay nevytváří duplicitní receipt", receipts.length === 2, receipts.length);
		check("test, revoke a reconnect mají tenantový audit", audits.length === 3, audits.map((row) => row.action));
		check(
			"audit obsahuje jen allowlist stavů, ne tajemství",
			!JSON.stringify(audits).toLowerCase().match(/token|secret|authorization|http:\/\//),
			audits,
		);
		await recordLuckyOsHealth(first.id, { ok: false, status: 504, tested: true });
		await recordLuckyOsHealth(first.id, { ok: true, status: 200, tested: true });
		const healthHistory = (
			await db
				.select()
				.from(integrationConnections)
				.where(eq(integrationConnections.ownerUserId, first.id))
				.limit(1)
		)[0];
		check(
			"po obnovení zůstává poslední chyba historicky dohledatelná",
			healthHistory?.status === "healthy" &&
				healthHistory.lastErrorCode === "luckyos_timeout" &&
				healthHistory.lastErrorAt !== null,
			healthHistory,
		);

		let invalidProvider = false;
		try {
			await db.insert(integrationConnections).values({
				workspaceId: second.workspaceId,
				ownerUserId: second.id,
				provider: "unknown-provider",
				status: "configured",
				scopes: [],
				capabilities: [],
			});
		} catch (error) {
			invalidProvider = sqlState(error) === "23514";
		}
		check("DB odmítne provider mimo allowlist", invalidProvider);

		let invalidScopes = false;
		try {
			await db.execute(sql`
				UPDATE integration_connections SET scopes = '{"bad":true}'::jsonb
				WHERE owner_user_id = ${first.id}
			`);
		} catch (error) {
			invalidScopes = sqlState(error) === "23514";
		}
		check("DB odmítne scopes, které nejsou pole", invalidScopes);

		let inconsistentRevoke = false;
		try {
			await db.execute(sql`
				UPDATE integration_connections SET status = 'revoked', revoked_at = null
				WHERE owner_user_id = ${first.id}
			`);
		} catch (error) {
			inconsistentRevoke = sqlState(error) === "23514";
		}
		check("DB vynutí soulad revoked stavu a času", inconsistentRevoke);

		let invalidErrorCode = false;
		try {
			await db.execute(sql`
				UPDATE integration_connections SET last_error_code = 'raw-upstream-secret'
				WHERE owner_user_id = ${first.id}
			`);
		} catch (error) {
			invalidErrorCode = sqlState(error) === "23514";
		}
		check("DB přijme jen bezpečný allowlist error kódů", invalidErrorCode);

		let crossTenantConnection = false;
		try {
			await db.execute(sql`
				UPDATE integration_connections SET workspace_id = ${second.workspaceId}::uuid
				WHERE owner_user_id = ${first.id}
			`);
		} catch (error) {
			crossTenantConnection = sqlState(error) === "23514";
		}
		check("DB nedovolí přehodit propojení do cizího osobního prostoru", crossTenantConnection);

		let forgedReceipt = false;
		try {
			await db.insert(integrationCommandReceipts).values({
				connectionId: connectionRows[0]?.id ?? crypto.randomUUID(),
				actorUserId: second.id,
				operationId: crypto.randomUUID(),
				requestHash: "a".repeat(64),
				action: "revoke",
				response: { ok: true },
			});
		} catch (error) {
			forgedReceipt = sqlState(error) === "23514";
		}
		check("DB nedovolí receipt připsat jinému aktérovi", forgedReceipt);
	} finally {
		for (const identity of [first, second, malformed]) {
			await db.delete(workspaces).where(eq(workspaces.id, identity.workspaceId));
			await db.delete(users).where(eq(users.id, identity.id));
		}
	}
	if (failed > 0) {
		console.error(`\nIntegration Center: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nIntegration Center: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
