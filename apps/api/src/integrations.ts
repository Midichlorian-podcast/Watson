/**
 * F4 — produkční Integration Center a první provider adapter (LuckyOS).
 *
 * Důležité hranice:
 * - registry/health nikdy neobsahuje token, base URL ani upstream payload;
 * - lifecycle je osobní, tenant-scoped, CAS a idempotentní;
 * - lokální revoke skutečně uzavře všechny employee routy;
 * - provider chyby se převádějí na malý bezpečný allowlist kódů.
 */
import { createHash } from "node:crypto";
import {
	and,
	auditEvents,
	eq,
	getDb,
	integrationCommandReceipts,
	integrationConnections,
	sql,
	workspaces,
} from "@watson/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { env, luckyOsEnabled } from "./env";
import { issueBridgeToken } from "./powersync";
import { listServiceIntegrations } from "./serviceIntegrations";

export const integrationRoutes = new Hono<{ Variables: { requestId: string } }>();
type IntegrationContext = Context<{ Variables: { requestId: string } }>;

const PROVIDER = "luckyos" as const;
const LUCKYOS_SCOPES = [
	"employee.identity.read",
	"employee.status.read",
	"employee.submissions.write",
	"storage.files.write",
] as const;
const LUCKYOS_CAPABILITIES = [
	"employee_hub",
	"task_reconciliation",
	"form_submission",
	"drive_upload",
] as const;

const lifecycleSchema = z
	.object({
		operationId: z.string().trim().min(8).max(128),
		expectedVersion: z.number().int().positive(),
	})
	.strict();

const luckyIdentitySchema = z
	.object({
		user: z.object({ email: z.string().email().max(254) }).passthrough(),
		person: z
			.object({
				id: z.string().min(1).max(200),
				full_name: z.string().max(500).optional(),
				person_type: z.string().max(100).optional(),
			})
			.passthrough(),
	})
	.passthrough();

export const employeeStatusSchema = z
	.object({
		person: z
			.object({
				id: z.string().max(200).optional(),
				full_name: z.string().max(500).optional(),
				person_type: z.string().max(100).optional(),
			})
			.passthrough()
			.optional(),
		readiness: z.unknown().optional(),
		deadlines: z.unknown().optional(),
		notifications: z
			.array(
				z
					.object({
						id: z.string().min(1).max(128),
						type: z.string().min(1).max(64),
						title: z.string().min(1).max(500),
						message: z.string().max(5_000).optional(),
						href: z.string().url().max(2_000).optional(),
						due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
						is_read: z.boolean().optional(),
					})
					.strict(),
			)
			.max(1_000)
			.optional(),
	})
	.passthrough();
export type LuckyEmployeeStatus = z.infer<typeof employeeStatusSchema>;

export interface LuckyResult {
	ok: boolean;
	status: number;
	data: unknown;
	/** LuckyOS není nakonfigurován (chybí base URL i povolený dev mock). */
	notConfigured?: boolean;
	/** Uživatel spojení vědomě odpojil ve Watsonu. */
	revoked?: boolean;
}

type HealthInput = {
	ok: boolean;
	status: number;
	notConfigured?: boolean;
	tested?: boolean;
};

function safeErrorCode(result: HealthInput): string | null {
	if (result.ok) return null;
	if (result.notConfigured) return "luckyos_not_configured";
	if (result.status === 504) return "luckyos_timeout";
	if (result.status === 502) return "luckyos_unavailable";
	if (result.status === 401 || result.status === 403) return "luckyos_identity_rejected";
	if (result.status === 404) return "luckyos_identity_not_linked";
	if (result.status === 409 || result.status === 422) return "luckyos_contract_rejected";
	return "luckyos_upstream_error";
}

function providerMode(): "configured" | "demo" | "not_configured" {
	if (env.luckyOs.mock && !env.luckyOs.baseUrl) return "demo";
	if (env.luckyOs.baseUrl) return "configured";
	return "not_configured";
}

/** Dev canned odpovědi jsou v produkci zablokované už v env.ts. */
function mockLucky(email: string, path: string, method: string): unknown {
	if (path.startsWith("/api/employee/me")) {
		return {
			user: { email, role: "employee" },
			person: {
				id: `mock-${email}`,
				full_name: "Trenér (mock)",
				person_type: "dpp",
			},
		};
	}
	if (path.startsWith("/api/employee/status")) {
		return {
			person: {
				id: `mock-${email}`,
				full_name: "Trenér (mock)",
				person_type: "dpp",
			},
			readiness: {
				status: "blocked",
				blockers: [
					{
						type: "missing_bank_account",
						explanation: "Doplň číslo účtu pro výplatu.",
						href: "/employee/profile",
					},
				],
				missing_documents: ["dpp_contract"],
			},
			deadlines: { attendance_due_day: 10, payroll_day: 15 },
			notifications: [
				{
					id: "mock-att-2026-07",
					type: "attendance_reminder",
					title: "Odevzdej docházku za červenec",
					message: "Uzávěrka do 10. 7.",
					href: "/employee/attendance",
					due: "2026-07-10",
					is_read: false,
				},
				{
					id: "mock-bank",
					type: "missing_bank_account",
					title: "Doplň číslo účtu",
					message: "Bez čísla účtu nelze vyplatit mzdu.",
					href: "/employee/profile",
					is_read: false,
				},
				{
					id: "mock-payroll-ready",
					type: "payroll_ready",
					title: "Výplata připravena",
					message: "Červnová výplata je připravena k náhledu.",
					is_read: false,
				},
			],
		};
	}
	if (path.startsWith("/api/employee/attendance")) {
		return { ok: true, saved: 0, submission: { status: "submitted" } };
	}
	if (path.startsWith("/api/employee/expenses")) {
		return method === "POST" ? { claim: { status: "submitted" } } : { claims: [] };
	}
	if (path.startsWith("/api/employee/documents")) {
		return method === "POST"
			? { document: { review_status: "pending" } }
			: { documents: [] };
	}
	if (path.startsWith("/api/employee/profile-change")) {
		return method === "POST" ? { request: { status: "pending" } } : { requests: [] };
	}
	if (path.startsWith("/api/employee/small-numbers")) {
		return method === "POST"
			? { entry: { status: "submitted" } }
			: { choreographies: [], entries: [] };
	}
	return {};
}

async function rawLuckyFetch(
	email: string,
	personId: string | null,
	path: string,
	init?: RequestInit,
): Promise<LuckyResult> {
	if (env.luckyOs.mock && !env.luckyOs.baseUrl) {
		return { ok: true, status: 200, data: mockLucky(email, path, init?.method ?? "GET") };
	}
	if (!env.luckyOs.baseUrl) {
		return { ok: false, status: 503, data: null, notConfigured: true };
	}
	const token = await issueBridgeToken({ email, personId });
	let response: Response;
	try {
		const timeout = AbortSignal.timeout(15_000);
		response = await fetch(new URL(path, env.luckyOs.baseUrl), {
			...init,
			signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
			headers: {
				"content-type": "application/json",
				...(init?.headers ?? {}),
				authorization: `Bearer ${token}`,
			},
		});
	} catch (error) {
		return {
			ok: false,
			status: error instanceof Error && error.name === "TimeoutError" ? 504 : 502,
			data: null,
		};
	}
	let data: unknown = null;
	try {
		data = await response.json();
	} catch {
		data = null;
	}
	return { ok: response.ok, status: response.status, data };
}

/** 200 s neplatným kontraktem je provider chyba, ne zdravé spojení. */
function validateLuckyPayload(path: string, result: LuckyResult): LuckyResult {
	if (!result.ok) return result;
	const pathname = path.split("?", 1)[0];
	const valid = pathname === "/api/employee/me"
		? luckyIdentitySchema.safeParse(result.data).success
		: pathname === "/api/employee/status"
			? employeeStatusSchema.safeParse(result.data).success
			: true;
	return valid ? result : { ok: false, status: 422, data: null };
}

async function probeLuckyIdentity(email: string): Promise<LuckyResult> {
	return validateLuckyPayload(
		"/api/employee/me",
		await rawLuckyFetch(email, null, "/api/employee/me"),
	);
}

async function personalWorkspaceId(userId: string): Promise<string | null> {
	const db = getDb();
	const rows = await db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.ownerId, userId), eq(workspaces.isPersonal, true)))
		.limit(1);
	return rows[0]?.id ?? null;
}

async function ensureLuckyOsConnection(userId: string) {
	const db = getDb();
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:${PROVIDER}:${userId}`}, 0))`,
		);
		let row = (
			await tx
				.select()
				.from(integrationConnections)
				.where(
					and(
						eq(integrationConnections.ownerUserId, userId),
						eq(integrationConnections.provider, PROVIDER),
					),
				)
				.limit(1)
		)[0];
		if (!row) {
			const workspaceId = await personalWorkspaceId(userId);
			if (!workspaceId) throw new Error("personal_workspace_missing");
			[row] = await tx
				.insert(integrationConnections)
				.values({
					workspaceId,
					ownerUserId: userId,
					provider: PROVIDER,
					status: luckyOsEnabled ? "configured" : "not_configured",
					scopes: [...LUCKYOS_SCOPES],
					capabilities: [...LUCKYOS_CAPABILITIES],
				})
				.returning();
		}
		if (!row) throw new Error("integration_connection_missing");
		const environmentStatus = !luckyOsEnabled
			? "not_configured"
			: row.status === "not_configured"
				? "configured"
				: null;
		if (!row.revokedAt && environmentStatus && row.status !== environmentStatus) {
			[row] = await tx
				.update(integrationConnections)
				.set({ status: environmentStatus })
				.where(eq(integrationConnections.id, row.id))
				.returning();
		}
		if (!row) throw new Error("integration_connection_missing");
		return row;
	});
}

function publicConnection(row: Awaited<ReturnType<typeof ensureLuckyOsConnection>>) {
	return {
		id: row.id,
		provider: PROVIDER,
		name: "LuckyOS",
		status: row.revokedAt ? "revoked" : row.status,
		mode: providerMode(),
		enabled: luckyOsEnabled && !row.revokedAt,
		canTest: true,
		canRevoke: true,
		scopes: row.scopes,
		capabilities: row.capabilities,
		lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
		lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
		lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
		lastErrorCode: row.lastErrorCode,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		version: row.version,
	};
}

export async function isLuckyOsRevoked(userId: string): Promise<boolean> {
	const db = getDb();
	const row = (
		await db
			.select({ revokedAt: integrationConnections.revokedAt })
			.from(integrationConnections)
			.where(
				and(
					eq(integrationConnections.ownerUserId, userId),
					eq(integrationConnections.provider, PROVIDER),
				),
			)
			.limit(1)
	)[0];
	return Boolean(row?.revokedAt);
}

/** Heartbeat nezvyšuje CAS verzi a nikdy neukládá surovou upstream chybu. */
export async function recordLuckyOsHealth(
	userId: string,
	result: HealthInput,
): Promise<void> {
	const connection = await ensureLuckyOsConnection(userId);
	const now = new Date();
	const errorCode = safeErrorCode(result);
	const db = getDb();
	await db
		.update(integrationConnections)
		.set({
			status: connection.revokedAt
				? "revoked"
				: result.ok
					? "healthy"
					: result.notConfigured
						? "not_configured"
						: "degraded",
			lastTestedAt: result.tested ? now : connection.lastTestedAt,
			lastSuccessAt: result.ok ? now : connection.lastSuccessAt,
			lastErrorAt: result.ok ? connection.lastErrorAt : now,
			lastErrorCode: result.ok ? connection.lastErrorCode : errorCode,
		})
		.where(eq(integrationConnections.id, connection.id));
}

/**
 * Jediný JSON provider vstup pro employee broker. Revoke se kontroluje serverově
 * před vydáním bridge tokenu a výsledek se promítne do Integration Center.
 */
export async function luckyFetch(
	userId: string,
	email: string,
	personId: string | null,
	path: string,
	init?: RequestInit,
): Promise<LuckyResult> {
	if (await isLuckyOsRevoked(userId)) {
		return { ok: false, status: 423, data: null, revoked: true };
	}
	const result = validateLuckyPayload(
		path,
		await rawLuckyFetch(email, personId, path, init),
	);
	try {
		await recordLuckyOsHealth(userId, result);
	} catch (error) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "integration_health_write_failed",
				provider: PROVIDER,
				name: error instanceof Error ? error.name : "UnknownError",
			}),
		);
	}
	return result;
}

async function existingReceipt(userId: string, operationId: string) {
	const db = getDb();
	return (
		await db
			.select()
			.from(integrationCommandReceipts)
			.where(
				and(
					eq(integrationCommandReceipts.actorUserId, userId),
					eq(integrationCommandReceipts.operationId, operationId),
				),
			)
			.limit(1)
	)[0];
}

function requestHash(action: "revoke" | "reconnect", input: z.infer<typeof lifecycleSchema>) {
	return createHash("sha256")
		.update(JSON.stringify({ action, expectedVersion: input.expectedVersion }))
		.digest("hex");
}

integrationRoutes.get("/api/integrations", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const [connection, services] = await Promise.all([
		ensureLuckyOsConnection(session.user.id),
		listServiceIntegrations(session.user.id),
	]);
	return c.json({ integrations: [publicConnection(connection), ...services] });
});

integrationRoutes.post("/api/integrations/luckyos/test", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const email = session.user.email;
	if (!email) return c.json({ error: "no_email" }, 400);
	const result = await probeLuckyIdentity(email);
	await recordLuckyOsHealth(session.user.id, { ...result, tested: true });
	const connection = await ensureLuckyOsConnection(session.user.id);
	await getDb().insert(auditEvents).values({
		workspaceId: connection.workspaceId,
		actorType: "user",
		actorUserId: session.user.id,
		entity: "integration_connection",
		entityId: connection.id,
		action: result.ok ? "test_success" : "test_failed",
		diff: { provider: PROVIDER, result: result.ok ? "reachable" : safeErrorCode(result) },
		requestId: c.get("requestId") ?? null,
	});
	const refreshed = await ensureLuckyOsConnection(session.user.id);
	return c.json(
		{
			reachable: result.ok,
			error: safeErrorCode(result),
			integration: publicConnection(refreshed),
		},
		result.ok ? 200 : result.notConfigured ? 409 : 502,
	);
});

async function lifecycleCommand(
	c: IntegrationContext,
	action: "revoke" | "reconnect",
) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = lifecycleSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_lifecycle_command" }, 422);
	const input = parsed.data;
	const hash = requestHash(action, input);
	const replay = await existingReceipt(session.user.id, input.operationId);
	if (replay) {
		if (replay.action !== action || replay.requestHash !== hash) {
			return c.json({ error: "idempotency_key_reused" }, 409);
		}
		return c.json(replay.response);
	}

	if (action === "reconnect") {
		const email = session.user.email;
		if (!email) return c.json({ error: "no_email" }, 400);
		const test = await probeLuckyIdentity(email);
		await recordLuckyOsHealth(session.user.id, { ...test, tested: true });
		if (!test.ok) {
			return c.json(
				{ error: safeErrorCode(test), retryable: !test.notConfigured },
				test.notConfigured ? 409 : 502,
			);
		}
	}

	const db = getDb();
	const result = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-command:${session.user.id}:${input.operationId}`}, 0))`,
		);
		const seen = (
			await tx
				.select()
				.from(integrationCommandReceipts)
				.where(
					and(
						eq(integrationCommandReceipts.actorUserId, session.user.id),
						eq(integrationCommandReceipts.operationId, input.operationId),
					),
				)
				.limit(1)
		)[0];
		if (seen) {
			return seen.action === action && seen.requestHash === hash
				? { kind: "ok" as const, response: seen.response }
				: { kind: "reused" as const };
		}
		const connection = (
			await tx
				.select()
				.from(integrationConnections)
				.where(
					and(
						eq(integrationConnections.ownerUserId, session.user.id),
						eq(integrationConnections.provider, PROVIDER),
					),
				)
				.limit(1)
		)[0];
		if (!connection) return { kind: "missing" as const };
		if (connection.version !== input.expectedVersion) {
			return { kind: "stale" as const, currentVersion: connection.version };
		}
		const now = new Date();
		const [updated] = await tx
			.update(integrationConnections)
			.set(
				action === "revoke"
					? { status: "revoked", revokedAt: now, version: connection.version + 1 }
					: {
							status: "healthy",
							revokedAt: null,
							lastTestedAt: now,
							lastSuccessAt: now,
							version: connection.version + 1,
						},
			)
			.where(
				and(
					eq(integrationConnections.id, connection.id),
					eq(integrationConnections.version, input.expectedVersion),
				),
			)
			.returning();
		if (!updated) return { kind: "stale" as const, currentVersion: connection.version };
		const response = { ok: true, integration: publicConnection(updated) };
		await tx.insert(auditEvents).values({
			workspaceId: connection.workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "integration_connection",
			entityId: connection.id,
			action,
			before: {
				status: connection.status,
				revokedAt: connection.revokedAt?.toISOString() ?? null,
				version: connection.version,
			},
			diff: {
				provider: PROVIDER,
				status: updated.status,
				revokedAt: updated.revokedAt?.toISOString() ?? null,
				version: updated.version,
			},
			requestId: c.get("requestId") ?? null,
		});
		await tx.insert(integrationCommandReceipts).values({
			connectionId: connection.id,
			actorUserId: session.user.id,
			operationId: input.operationId,
			requestHash: hash,
			action,
			response,
		});
		return { kind: "ok" as const, response };
	});

	if (result.kind === "reused") return c.json({ error: "idempotency_key_reused" }, 409);
	if (result.kind === "missing") return c.json({ error: "integration_not_found" }, 404);
	if (result.kind === "stale") {
		return c.json({ error: "stale_version", currentVersion: result.currentVersion }, 409);
	}
	return c.json(result.response);
}

integrationRoutes.post("/api/integrations/luckyos/revoke", (c) => lifecycleCommand(c, "revoke"));
integrationRoutes.post("/api/integrations/luckyos/reconnect", (c) => lifecycleCommand(c, "reconnect"));
