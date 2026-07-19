/** Integrační test default-deny AI policy, explicitního souhlasu a distribuované kvóty. */
import "./src/env";
import {
	aiPolicies,
	and,
	auditEvents,
	eq,
	getDb,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";
import { authorizeAiVendorTransfer, redactVendorText } from "./src/aiPolicy";

const API = process.env.AI_POLICY_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
	const tokenRows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${tokenRows[0]?.identifier}&callbackURL=http://localhost:5173/`,
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

async function putPolicy(
	cookie: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${API}/api/ai/policies`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:5173",
			Cookie: cookie,
		},
		body: JSON.stringify(body),
	});
}

async function main(): Promise<void> {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [manager, member] = await db
		.insert(users)
		.values([
			{
				id: crypto.randomUUID(),
				name: "AI policy manager",
				email: `ai-manager-${stamp}@watson.test`,
				emailVerified: true,
			},
			{
				id: crypto.randomUUID(),
				name: "AI policy member",
				email: `ai-member-${stamp}@watson.test`,
				emailVerified: true,
			},
		])
		.returning({ id: users.id, email: users.email });
	if (!manager || !member) throw new Error("user setup failed");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `AI policy ${stamp}`, ownerId: manager.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace setup failed");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
	]);

	try {
		const managerCookie = await login(manager.email);
		const memberCookie = await login(member.email);
		const base = {
			workspaceId: workspace.id,
			capability: "meeting_extract",
			level: "suggest",
			dailyLimit: 1,
		};
		let response = await putPolicy(memberCookie, { ...base, vendorConsent: true });
		check("běžný člen nemůže měnit AI policy", response.status === 403, response.status);
		response = await putPolicy(managerCookie, { ...base, vendorConsent: false });
		check("manager může uložit default-deny policy", response.status === 200, response.status);

		response = await fetch(`${API}/api/ai/policies?workspaceId=${workspace.id}`, {
			headers: { Origin: "http://localhost:5173", Cookie: memberCookie },
		});
		const listed = (await response.json().catch(() => ({}))) as { policies?: unknown[] };
		check(
			"člen může číst transparentní workspace policy",
			response.status === 200 && listed.policies?.length === 1,
			{ status: response.status, listed },
		);

		let authz = await authorizeAiVendorTransfer({
			workspaceId: workspace.id,
			userId: member.id,
			capability: "meeting_extract",
			userConsent: true,
			requestId: "ai-policy-disabled",
			inputChars: 123,
			model: "test-model",
		});
		check("vendor consent v policy je default-deny", !authz.ok && authz.status === 403, authz);

		response = await putPolicy(managerCookie, { ...base, vendorConsent: true });
		check("manager může vendor transfer výslovně povolit", response.status === 200, response.status);
		authz = await authorizeAiVendorTransfer({
			workspaceId: workspace.id,
			userId: member.id,
			capability: "meeting_extract",
			userConsent: false,
			requestId: "ai-no-user-consent",
			inputChars: 123,
			model: "test-model",
		});
		check("každý call vyžaduje souhlas uživatele", !authz.ok && authz.status === 403, authz);

		const secret = "eva.novak@example.test +420 777 888 999";
		const calls = await Promise.all(
			["a", "b"].map((suffix) =>
				authorizeAiVendorTransfer({
					workspaceId: workspace.id,
					userId: member.id,
					capability: "meeting_extract",
					userConsent: true,
					requestId: `ai-concurrent-${suffix}`,
					inputChars: secret.length,
					model: "test-model",
				}),
			),
		);
		check(
			"distribuovaná kvóta pustí z dvojice souběžných callů právě jeden",
			calls.filter((x) => x.ok).length === 1 && calls.filter((x) => !x.ok && x.status === 429).length === 1,
			calls,
		);
		const transferAudits = await db
			.select({ diff: auditEvents.diff })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.entity, "ai_vendor_transfer"),
					eq(auditEvents.action, "meeting_extract"),
				),
			);
		check("kvóta vytvoří právě jeden transfer audit", transferAudits.length === 1, transferAudits);
		check(
			"audit neobsahuje vstupní obsah ani PII",
			!JSON.stringify(transferAudits).includes("eva.novak") &&
				!JSON.stringify(transferAudits).includes("777"),
			transferAudits,
		);
		check(
			"redakce odstraní e-mail i telefon před přenosem",
			redactVendorText(secret) === "[EMAIL] [TELEFON]",
			redactVendorText(secret),
		);
		const rows = await db
			.select({ config: aiPolicies.config })
			.from(aiPolicies)
			.where(
				and(
					eq(aiPolicies.workspaceId, workspace.id),
					eq(aiPolicies.capability, "meeting_extract"),
				),
			);
		check("policy je per workspace+capability", rows.length === 1, rows);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, manager.id));
	}

	if (failed) throw new Error(`${failed} AI policy checks failed`);
	console.log("\nAI policy checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
