/** F4 — provozní integrace reminder e-mailu a vestavěného úložiště příloh. */
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
import { escapeEmailHtml, sendProviderEmail, type EmailProviderErrorCode } from "./emailProvider";
import { emailEnabled, env } from "./env";

export const serviceIntegrationRoutes = new Hono<{ Variables: { requestId: string } }>();
type ServiceContext = Context<{ Variables: { requestId: string } }>;
type ServiceProvider = "resend_email" | "watson_attachments";
type SafeServiceError = EmailProviderErrorCode | "email_revoked" | "attachment_storage_unavailable";

const DEFINITIONS = {
	resend_email: {
		name: "E-mailové připomínky",
		scopes: ["notifications.reminders.send"],
		capabilities: ["email_reminders", "provider_ack"],
		canTest: true,
		canRevoke: true,
	},
	watson_attachments: {
		name: "Přílohy Watson",
		scopes: ["tasks.attachments.store", "tasks.attachments.read"],
		capabilities: ["attachment_staging", "safe_preview", "range_download"],
		canTest: true,
		canRevoke: false,
	},
} as const;

const lifecycleSchema = z
	.object({
		operationId: z.string().trim().min(8).max(128),
		expectedVersion: z.number().int().positive(),
	})
	.strict();

function environmentStatus(provider: ServiceProvider) {
	return provider === "resend_email" && !emailEnabled ? "not_configured" : "configured";
}

function providerMode(provider: ServiceProvider): "configured" | "not_configured" | "built_in" {
	if (provider === "watson_attachments") return "built_in";
	return emailEnabled ? "configured" : "not_configured";
}

async function personalWorkspaceId(userId: string): Promise<string> {
	const row = (
		await getDb()
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(and(eq(workspaces.ownerId, userId), eq(workspaces.isPersonal, true)))
			.limit(1)
	)[0];
	if (!row) throw new Error("personal_workspace_missing");
	return row.id;
}

async function ensureServiceConnection(userId: string, provider: ServiceProvider) {
	const definition = DEFINITIONS[provider];
	const workspaceId = await personalWorkspaceId(userId);
	return getDb().transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:${userId}:${provider}`}, 0))`,
		);
		let row = (
			await tx
				.select()
				.from(integrationConnections)
				.where(
					and(
						eq(integrationConnections.ownerUserId, userId),
						eq(integrationConnections.provider, provider),
					),
				)
				.limit(1)
		)[0];
		if (!row) {
			[row] = await tx
				.insert(integrationConnections)
				.values({
					workspaceId,
					ownerUserId: userId,
					provider,
					status: environmentStatus(provider),
					scopes: [...definition.scopes],
					capabilities: [...definition.capabilities],
				})
				.returning();
		} else if (
			!row.revokedAt &&
			(row.status === "not_configured") !== (environmentStatus(provider) === "not_configured")
		) {
			[row] = await tx
				.update(integrationConnections)
				.set({ status: environmentStatus(provider) })
				.where(eq(integrationConnections.id, row.id))
				.returning();
		}
		if (!row) throw new Error("service_integration_missing");
		return row;
	});
}

export function publicServiceConnection(
	row: Awaited<ReturnType<typeof ensureServiceConnection>>,
	provider: ServiceProvider,
) {
	const definition = DEFINITIONS[provider];
	return {
		id: row.id,
		provider,
		name: definition.name,
		status: row.revokedAt ? "revoked" : row.status,
		mode: providerMode(provider),
		enabled: providerMode(provider) !== "not_configured" && !row.revokedAt,
		canTest: definition.canTest,
		canRevoke: definition.canRevoke,
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

export async function listServiceIntegrations(userId: string) {
	const [email, attachments] = await Promise.all([
		ensureServiceConnection(userId, "resend_email"),
		ensureServiceConnection(userId, "watson_attachments"),
	]);
	return [
		publicServiceConnection(email, "resend_email"),
		publicServiceConnection(attachments, "watson_attachments"),
	];
}

async function recordHealth(
	userId: string,
	provider: ServiceProvider,
	result: { ok: boolean; errorCode?: SafeServiceError | null; tested?: boolean },
) {
	const connection = await ensureServiceConnection(userId, provider);
	const now = new Date();
	await getDb()
		.update(integrationConnections)
		.set({
			status: connection.revokedAt
				? "revoked"
				: result.ok
					? "healthy"
					: provider === "resend_email" && !emailEnabled
						? "not_configured"
						: "degraded",
			lastTestedAt: result.tested ? now : connection.lastTestedAt,
			lastSuccessAt: result.ok ? now : connection.lastSuccessAt,
			lastErrorAt: result.ok ? connection.lastErrorAt : now,
			lastErrorCode: result.ok ? connection.lastErrorCode : (result.errorCode ?? null),
		})
		.where(eq(integrationConnections.id, connection.id));
}

export async function recordReminderEmailHealth(
	userId: string,
	result: { ok: boolean; errorCode?: SafeServiceError | null; tested?: boolean },
) {
	await recordHealth(userId, "resend_email", result);
}

export async function reminderEmailAvailability(userId: string) {
	if (!emailEnabled) return { enabled: false, reason: "email_not_configured" as const };
	const connection = await ensureServiceConnection(userId, "resend_email");
	if (connection.revokedAt) return { enabled: false, reason: "email_revoked" as const };
	return { enabled: true, reason: null };
}

async function auditTest(
	c: ServiceContext,
	userId: string,
	provider: ServiceProvider,
	ok: boolean,
	errorCode: SafeServiceError | null,
) {
	const connection = await ensureServiceConnection(userId, provider);
	await getDb()
		.insert(auditEvents)
		.values({
			workspaceId: connection.workspaceId,
			actorType: "user",
			actorUserId: userId,
			entity: "integration_connection",
			entityId: connection.id,
			action: ok ? "test_success" : "test_failed",
			diff: { provider, result: ok ? "reachable" : errorCode },
			requestId: c.get("requestId") ?? null,
		});
}

serviceIntegrationRoutes.post("/api/integrations/resend_email/test", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const availability = await reminderEmailAvailability(session.user.id);
	if (!availability.enabled) {
		await recordReminderEmailHealth(session.user.id, {
			ok: false,
			errorCode: availability.reason,
			tested: true,
		});
		await auditTest(c, session.user.id, "resend_email", false, availability.reason);
		const row = await ensureServiceConnection(session.user.id, "resend_email");
		return c.json(
			{
				reachable: false,
				error: availability.reason,
				integration: publicServiceConnection(row, "resend_email"),
			},
			409,
		);
	}
	const result = await sendProviderEmail({
		from: env.reminderEmailFrom,
		to: session.user.email,
		subject: "Watson · test e-mailových připomínek",
		text: "E-mailové připomínky jsou propojené. Tento test nevytvořil žádný úkol ani připomínku.",
		html: "<p><strong>E-mailové připomínky jsou propojené.</strong></p><p>Tento test nevytvořil žádný úkol ani připomínku.</p>",
		idempotencyKey: `integration-test-${c.get("requestId") ?? crypto.randomUUID()}`,
	});
	await recordReminderEmailHealth(session.user.id, {
		ok: result.ok,
		errorCode: result.ok ? null : result.errorCode,
		tested: true,
	});
	await auditTest(
		c,
		session.user.id,
		"resend_email",
		result.ok,
		result.ok ? null : result.errorCode,
	);
	const row = await ensureServiceConnection(session.user.id, "resend_email");
	return c.json(
		{
			reachable: result.ok,
			error: result.ok ? null : result.errorCode,
			integration: publicServiceConnection(row, "resend_email"),
		},
		result.ok ? 200 : result.permanent ? 409 : 502,
	);
});

serviceIntegrationRoutes.post("/api/integrations/watson_attachments/test", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	let ok = false;
	try {
		const rows = (await getDb().execute(sql`
			SELECT to_regclass('public.attachment_blobs') IS NOT NULL AS blobs,
			       to_regclass('public.attachment_upload_stages') IS NOT NULL AS stages
		`)) as unknown as { blobs: boolean; stages: boolean }[];
		ok = rows[0]?.blobs === true && rows[0]?.stages === true;
	} catch {
		ok = false;
	}
	const errorCode = ok ? null : ("attachment_storage_unavailable" as const);
	await recordHealth(session.user.id, "watson_attachments", { ok, errorCode, tested: true });
	await auditTest(c, session.user.id, "watson_attachments", ok, errorCode);
	const row = await ensureServiceConnection(session.user.id, "watson_attachments");
	return c.json(
		{
			reachable: ok,
			error: errorCode,
			integration: publicServiceConnection(row, "watson_attachments"),
		},
		ok ? 200 : 503,
	);
});

function lifecycleHash(action: "revoke" | "reconnect", input: z.infer<typeof lifecycleSchema>) {
	return createHash("sha256")
		.update(
			JSON.stringify({ provider: "resend_email", action, expectedVersion: input.expectedVersion }),
		)
		.digest("hex");
}

async function emailLifecycle(c: ServiceContext, action: "revoke" | "reconnect") {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = lifecycleSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_lifecycle_command" }, 422);
	if (action === "reconnect" && !emailEnabled)
		return c.json({ error: "email_not_configured" }, 409);
	const input = parsed.data;
	const requestHash = lifecycleHash(action, input);
	const existing = (
		await getDb()
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
	if (existing) {
		if (existing.action !== action || existing.requestHash !== requestHash)
			return c.json({ error: "idempotency_key_reused" }, 409);
		return c.json(existing.response);
	}
	await ensureServiceConnection(session.user.id, "resend_email");
	const result = await getDb().transaction(async (tx) => {
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
		if (seen)
			return seen.action === action && seen.requestHash === requestHash
				? { kind: "ok" as const, response: seen.response }
				: { kind: "reused" as const };
		const connection = (
			await tx
				.select()
				.from(integrationConnections)
				.where(
					and(
						eq(integrationConnections.ownerUserId, session.user.id),
						eq(integrationConnections.provider, "resend_email"),
					),
				)
				.limit(1)
		)[0];
		if (!connection) return { kind: "missing" as const };
		if (connection.version !== input.expectedVersion)
			return { kind: "stale" as const, currentVersion: connection.version };
		const now = new Date();
		const [updated] = await tx
			.update(integrationConnections)
			.set(
				action === "revoke"
					? { status: "revoked", revokedAt: now, version: connection.version + 1 }
					: { status: "configured", revokedAt: null, version: connection.version + 1 },
			)
			.where(
				and(
					eq(integrationConnections.id, connection.id),
					eq(integrationConnections.version, input.expectedVersion),
				),
			)
			.returning();
		if (!updated) return { kind: "stale" as const, currentVersion: connection.version };
		const response = { ok: true, integration: publicServiceConnection(updated, "resend_email") };
		await tx.insert(auditEvents).values({
			workspaceId: connection.workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "integration_connection",
			entityId: connection.id,
			action,
			before: { status: connection.status, version: connection.version },
			diff: { provider: "resend_email", status: updated.status, version: updated.version },
			requestId: c.get("requestId") ?? null,
		});
		await tx.insert(integrationCommandReceipts).values({
			connectionId: connection.id,
			actorUserId: session.user.id,
			operationId: input.operationId,
			requestHash,
			action,
			response,
		});
		return { kind: "ok" as const, response };
	});
	if (result.kind === "reused") return c.json({ error: "idempotency_key_reused" }, 409);
	if (result.kind === "missing") return c.json({ error: "integration_not_found" }, 404);
	if (result.kind === "stale")
		return c.json({ error: "stale_version", currentVersion: result.currentVersion }, 409);
	return c.json(result.response);
}

serviceIntegrationRoutes.post("/api/integrations/resend_email/revoke", (c) =>
	emailLifecycle(c, "revoke"),
);
serviceIntegrationRoutes.post("/api/integrations/resend_email/reconnect", (c) =>
	emailLifecycle(c, "reconnect"),
);

/** Bezpečný template skutečného task reminderu. */
export async function sendTaskReminderEmail(input: {
	reminderId: string;
	userId: string;
	to: string;
	taskId: string;
	taskName: string;
}) {
	const availability = await reminderEmailAvailability(input.userId);
	if (!availability.enabled)
		return { ok: false as const, errorCode: availability.reason, permanent: true };
	const taskUrl = `${env.webOrigin}/ukoly?ukol=${encodeURIComponent(input.taskId)}`;
	const safeName = escapeEmailHtml(input.taskName);
	const safeUrl = escapeEmailHtml(taskUrl);
	const result = await sendProviderEmail({
		from: env.reminderEmailFrom,
		to: input.to,
		subject: `Watson · ${input.taskName.replace(/[\r\n]+/g, " ").slice(0, 160)}`,
		text: `Připomínka úkolu: ${input.taskName}\n\n${taskUrl}`,
		html: `<p>Připomínka úkolu:</p><p><strong>${safeName}</strong></p><p><a href="${safeUrl}">Otevřít úkol ve Watsonu</a></p>`,
		idempotencyKey: `reminder-${input.reminderId}`,
	});
	await recordReminderEmailHealth(input.userId, {
		ok: result.ok,
		errorCode: result.ok ? null : result.errorCode,
	});
	return result;
}
