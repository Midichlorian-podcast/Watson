import {
	aiPolicies,
	and,
	auditEvents,
	eq,
	getDb,
	memberships,
	sql,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const AI_CAPABILITIES = ["meeting_extract", "watson_command", "mail_reply_suggestion"] as const;
type AiCapability = (typeof AI_CAPABILITIES)[number];

const policySchema = z
	.object({
		workspaceId: z.string().uuid(),
		capability: z.enum(AI_CAPABILITIES),
		level: z.enum(["off", "suggest", "auto_notify"]),
		vendorConsent: z.boolean(),
		dailyLimit: z.number().int().min(1).max(1_000),
	})
	.strict();

interface PolicyConfig {
	vendorConsent?: boolean;
	dailyLimit?: number;
}

export type AiAuthorization =
	| { ok: true }
	| { ok: false; status: 403 | 429; error: string };

/**
 * Default deny policy + DB-backed denní quota sdílená všemi API instancemi.
 * Audit se zapisuje těsně před vendor callem: i provider error už znamená, že
 * data opustila Watson a musí být dohledatelná i započítaná do limitu.
 */
export async function authorizeAiVendorTransfer(input: {
	workspaceId: string;
	userId: string;
	capability: AiCapability;
	userConsent: boolean;
	requestId: string | null;
	inputChars: number;
	model: string;
}): Promise<AiAuthorization> {
	if (!input.userConsent) return { ok: false, status: 403, error: "ai_user_consent_required" };
	const db = getDb();
	return db.transaction(async (tx) => {
		// Count+insert musí být jeden distribuovaný kritický úsek. Bez advisory
		// locku by dva souběžné API procesy mohly oba přečíst stejný počet a
		// překročit denní limit. Klíč je per workspace+capability, ne globální.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.capability}`}, 0))`,
		);
		const policy = (
			await tx
				.select({ level: aiPolicies.level, config: aiPolicies.config })
				.from(aiPolicies)
				.where(
					and(
						eq(aiPolicies.workspaceId, input.workspaceId),
						eq(aiPolicies.capability, input.capability),
					),
				)
				.limit(1)
		)[0];
		const config = (policy?.config ?? {}) as PolicyConfig;
		if (!policy || policy.level === "off" || config.vendorConsent !== true) {
			return { ok: false as const, status: 403 as const, error: "ai_policy_disabled" };
		}
		const dailyLimit = Math.max(1, Math.min(1_000, config.dailyLimit ?? 20));
		const usedRows = (await tx.execute(sql`
			SELECT count(*)::int AS used
			FROM audit_events
			WHERE workspace_id = ${input.workspaceId}
			  AND entity = 'ai_vendor_transfer'
			  AND action = ${input.capability}
			  AND created_at >= date_trunc('day', now())
		`)) as unknown as { used: number }[];
		if ((usedRows[0]?.used ?? 0) >= dailyLimit) {
			return { ok: false as const, status: 429 as const, error: "ai_daily_quota_exceeded" };
		}
		await tx.insert(auditEvents).values({
			workspaceId: input.workspaceId,
			actorType: "user",
			actorUserId: input.userId,
			entity: "ai_vendor_transfer",
			action: input.capability,
			diff: {
				inputChars: input.inputChars,
				model: input.model,
				consent: true,
				policyLevel: policy.level,
			},
			requestId: input.requestId,
		});
		return { ok: true as const };
	});
}

/** Minimální PII redukce před vendor transferem; nikdy se neloguje původní obsah. */
export function redactVendorText(value: string): string {
	return value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
		.replace(/(?:\+?\d[\s().-]*){9,}/g, "[TELEFON]");
}

export const aiPolicyRoutes = new Hono<{ Variables: { requestId: string } }>();

aiPolicyRoutes.get("/api/ai/policies", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.query("workspaceId");
	if (!workspaceId || !z.string().uuid().safeParse(workspaceId).success)
		return c.json({ error: "invalid_workspace" }, 422);
	const db = getDb();
	const member = (
		await db
			.select({ id: memberships.userId })
			.from(memberships)
			.where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, session.user.id)))
			.limit(1)
	)[0];
	if (!member) return c.json({ error: "forbidden" }, 403);
	const policies = await db
		.select({
			capability: aiPolicies.capability,
			level: aiPolicies.level,
			config: aiPolicies.config,
		})
		.from(aiPolicies)
		.where(eq(aiPolicies.workspaceId, workspaceId));
	return c.json({ policies });
});

aiPolicyRoutes.put("/api/ai/policies", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = policySchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_ai_policy" }, 422);
	const body = parsed.data;
	const db = getDb();
	const access = (
		await db
			.select({ role: memberships.role, ownerId: workspaces.ownerId })
			.from(workspaces)
			.leftJoin(
				memberships,
				and(
					eq(memberships.workspaceId, workspaces.id),
					eq(memberships.userId, session.user.id),
				),
			)
			.where(eq(workspaces.id, body.workspaceId))
			.limit(1)
	)[0];
	const allowed =
		access?.ownerId === session.user.id || access?.role === "admin" || access?.role === "manager";
	if (!allowed) return c.json({ error: "forbidden" }, 403);
	await db.transaction(async (tx) => {
		await tx
			.insert(aiPolicies)
			.values({
				workspaceId: body.workspaceId,
				capability: body.capability,
				level: body.level,
				config: { vendorConsent: body.vendorConsent, dailyLimit: body.dailyLimit },
			})
			.onConflictDoUpdate({
				target: [aiPolicies.workspaceId, aiPolicies.capability],
				set: {
					level: body.level,
					config: { vendorConsent: body.vendorConsent, dailyLimit: body.dailyLimit },
				},
			});
		await tx.insert(auditEvents).values({
			workspaceId: body.workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "ai_policy",
			action: "upsert",
			diff: {
				capability: body.capability,
				level: body.level,
				vendorConsent: body.vendorConsent,
				dailyLimit: body.dailyLimit,
			},
			requestId: c.get("requestId") ?? null,
		});
	});
	return c.json({ ok: true });
});
