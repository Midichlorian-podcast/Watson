/**
 * Web Push + doručovací worker připomínek.
 *
 * - `pushRoutes` — REST: VAPID veřejný klíč, (od)hlášení odběru, testovací push.
 * - `startReminderWorker` — periodicky projde splatné `reminders`, doručí přes Web Push
 *   a `sent_at` nastaví AŽ po potvrzeném doručení aspoň jednomu odběru (CC-P0-09);
 *   kanál `email` je neimplementovaný a scan ho přeskakuje (zůstává pending).
 *
 * `push_subscriptions` se NEsynchronizuje do klienta (server-only) — odběry drží jen server.
 */
import {
	and,
	eq,
	getDb,
	inArray,
	projects,
	pushSubscriptions,
	reminders,
	sql,
	tasks,
} from "@watson/db";
import { Hono } from "hono";
import webpush from "web-push";
import { z } from "zod";
import { auth } from "./auth";
import { readNotificationHold } from "./availability";
import { env, pushEnabled } from "./env";

if (pushEnabled) {
	webpush.setVapidDetails(
		env.vapid.subject,
		env.vapid.publicKey as string,
		env.vapid.privateKey as string,
	);
}

interface DueReminder {
	id: string;
	userId: string;
	type: string;
	remindAt: Date | null;
	offsetMin: number | null;
	channel: string;
	taskName: string;
	dueDate: Date | null;
	startDate: Date | null;
	workspaceId: string;
}

/** Kdy má připomínka padnout. null = nelze určit (relative bez termínu). */
export function reminderFireTime(r: DueReminder): Date | null {
	if (r.type === "relative") {
		const base = r.startDate ?? r.dueDate;
		if (!base || r.offsetMin == null) return null;
		return new Date(base.getTime() - r.offsetMin * 60_000);
	}
	return r.remindAt ?? null; // time | recurring → absolutní čas
}

/** Odešle push jednomu odběru. 'expired' (404/410) → volající odběr smaže. */
async function sendOne(
	sub: { endpoint: string; p256dh: string; auth: string },
	payload: object,
): Promise<{ result: "ok" | "expired" | "error"; errorCode?: string }> {
	try {
		await webpush.sendNotification(
			{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
			JSON.stringify(payload),
		);
		return { result: "ok" };
	} catch (e) {
		const code = (e as { statusCode?: number }).statusCode;
		if (code === 404 || code === 410) return { result: "expired", errorCode: `http_${code}` };
		console.error(
			JSON.stringify({ level: "error", event: "push_delivery_failed", providerStatus: code ?? null }),
		);
		return { result: "error", errorCode: code ? `http_${code}` : "provider_error" };
	}
}

interface PushDeliveryResult {
	delivered: number;
	errorCode: string | null;
	providerMessageId: string | null;
}

async function deliverPushToUser(
	userId: string,
	payload: object,
): Promise<PushDeliveryResult> {
	if (!pushEnabled)
		return { delivered: 0, errorCode: "push_not_configured", providerMessageId: null };
	const db = getDb();
	const subs = await db
		.select({
			id: pushSubscriptions.id,
			endpoint: pushSubscriptions.endpoint,
			p256dh: pushSubscriptions.p256dh,
			auth: pushSubscriptions.auth,
		})
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId));
	if (subs.length === 0)
		return { delivered: 0, errorCode: "no_subscription", providerMessageId: null };
	let ok = 0;
	let lastError: string | null = null;
	for (const s of subs) {
		const res = await sendOne(s, payload);
		if (res.result === "ok") ok++;
		else if (res.result === "expired")
			await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
		if (res.result !== "ok") lastError = res.errorCode ?? "provider_error";
	}
	return {
		delivered: ok,
		errorCode: ok > 0 ? null : (lastError ?? "no_subscription"),
		providerMessageId: null,
	};
}

/** Pošle notifikaci uživateli na všechna jeho zařízení. Vrací počet úspěšných doručení. */
export async function pushToUser(userId: string, payload: object): Promise<number> {
	return (await deliverPushToUser(userId, payload)).delivered;
}

// E-mailový kanál připomínek: záměrně BEZ implementace i BEZ fake „sent" větve
// (CC-P0-09). Scan e-mailové připomínky přeskakuje; kanál se zapne až s reálným
// mailerem (Resend) a delivery state machine v F5.

/**
 * Atomicky claimne splatné push připomínky. SKIP LOCKED zaručuje, že dvě API
 * instance nevezmou stejný řádek; pětiminutový lease obnoví práci po pádu workeru.
 */
async function claimDue(now: Date): Promise<(DueReminder & { attempts: number })[]> {
	const db = getDb();
	const nowIso = now.toISOString();
	const claimed = await db.transaction(async (tx) =>
		tx.execute(sql`
			WITH candidates AS (
				SELECT r.id
				FROM reminders r
				JOIN tasks t ON t.id = r.task_id
				WHERE t.completed_at IS NULL
				  AND r.channel = 'push'
				  AND (
					(r.delivery_state IN ('pending', 'retry')
					 AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ${nowIso}::timestamptz)
					 AND (
						(r.type <> 'relative' AND r.remind_at IS NOT NULL AND r.remind_at <= ${nowIso}::timestamptz)
						OR
						(r.type = 'relative' AND r.offset_min IS NOT NULL
						 AND COALESCE(t.start_date, t.due_date::timestamptz)
						     - (r.offset_min * interval '1 minute') <= ${nowIso}::timestamptz)
					 ))
					OR
					(r.delivery_state = 'claimed' AND r.claimed_at < ${nowIso}::timestamptz - interval '5 minutes')
					OR
					(r.delivery_state = 'held' AND r.next_attempt_at IS NOT NULL
					 AND r.next_attempt_at <= ${nowIso}::timestamptz)
				  )
				ORDER BY COALESCE(r.next_attempt_at, r.remind_at, r.created_at), r.id
				FOR UPDATE OF r SKIP LOCKED
				LIMIT 100
			)
			UPDATE reminders r
			SET delivery_state = 'claimed', claimed_at = ${nowIso}::timestamptz,
			    held_at = NULL, held_reason = NULL,
				    attempts = r.attempts + 1
			FROM candidates c
			WHERE r.id = c.id
			RETURNING r.id
		`),
	);
	const ids = (claimed as unknown as { id: string }[]).map((row) => row.id);
	if (ids.length === 0) return [];
	return (await db
		.select({
			id: reminders.id,
			userId: reminders.userId,
			type: reminders.type,
			remindAt: reminders.remindAt,
			offsetMin: reminders.offsetMin,
			channel: reminders.channel,
			taskName: tasks.name,
			dueDate: tasks.dueDate,
			startDate: tasks.startDate,
			workspaceId: projects.workspaceId,
			attempts: reminders.attempts,
		})
		.from(reminders)
		.innerJoin(tasks, eq(tasks.id, reminders.taskId))
		.innerJoin(projects, eq(projects.id, tasks.projectId))
		.where(inArray(reminders.id, ids))) as (DueReminder & { attempts: number })[];
}

/** Projde splatné připomínky přes delivery state machine a označí sent jen po ACK. */
export async function scanAndSendDue(now: Date = new Date()): Promise<number> {
	const db = getDb();
	const rows = await claimDue(now);

	let fired = 0;
	for (const r of rows) {
		const hold = await readNotificationHold(db, r.workspaceId, r.userId, now);
		if (hold) {
			await db
				.update(reminders)
				.set({
					deliveryState: "held",
					heldAt: now,
					heldReason: hold.reason,
					claimedAt: null,
					nextAttemptAt: hold.until,
					attempts: Math.max(0, r.attempts - 1),
					lastErrorCode: null,
				})
				.where(and(eq(reminders.id, r.id), eq(reminders.deliveryState, "claimed")));
			continue;
		}
		const payload = {
			title: "Watson · připomínka",
			body: r.taskName,
			tag: `reminder-${r.id}`,
			url: "/dnes",
		};
		const delivery = await deliverPushToUser(r.userId, payload);
		if (delivery.delivered > 0) {
			await db
				.update(reminders)
				.set({
					deliveryState: "sent",
					sentAt: now,
					claimedAt: null,
					heldAt: null,
					heldReason: null,
					nextAttemptAt: null,
					lastErrorCode: null,
					providerMessageId: delivery.providerMessageId,
				})
				.where(and(eq(reminders.id, r.id), eq(reminders.deliveryState, "claimed")));
			fired++;
			continue;
		}
		const dead = r.attempts >= 5;
		const delayMinutes = Math.min(2 ** Math.max(0, r.attempts - 1), 60);
		await db
			.update(reminders)
			.set({
				deliveryState: dead ? "dead" : "retry",
				claimedAt: null,
				heldAt: null,
				heldReason: null,
				nextAttemptAt: dead ? null : new Date(now.getTime() + delayMinutes * 60_000),
				lastErrorCode: delivery.errorCode,
			})
			.where(and(eq(reminders.id, r.id), eq(reminders.deliveryState, "claimed")));
	}
	if (fired) console.log(`[reminders] doručeno ${fired}`);
	return fired;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Spustí periodický scan (default každých 30 s). Idempotentní; bez VAPID neběží. */
export function startReminderWorker(intervalMs = 30_000): void {
	if (timer) return;
	if (!pushEnabled) {
		console.warn("[reminders] worker neběží — chybí VAPID klíče v .env");
		return;
	}
	timer = setInterval(() => {
		scanAndSendDue().catch((error) =>
			console.error(
				JSON.stringify({
					level: "error",
					event: "reminder_scan_failed",
					name: error instanceof Error ? error.name : "UnknownError",
				}),
			),
		);
	}, intervalMs);
	console.log(`[reminders] worker běží (interval ${intervalMs / 1000}s)`);
}

/** REST endpointy Web Push. */
export const pushRoutes = new Hono();

const pushEndpoint = z
	.string()
	.url()
	.max(4096)
	.refine((value) => new URL(value).protocol === "https:", "push_endpoint_must_use_https")
	.refine((value) => {
		const host = new URL(value).hostname.toLowerCase();
		return host !== "localhost" && host !== "::1" && !host.endsWith(".local") && !/^127\./.test(host);
	}, "push_endpoint_must_be_public");
const subscribeSchema = z
	.object({
		endpoint: pushEndpoint,
		keys: z
			.object({
				p256dh: z.string().min(20).max(512),
				auth: z.string().min(8).max(128),
			})
			.strict(),
	})
	.strict();
const unsubscribeSchema = z.object({ endpoint: pushEndpoint }).strict();

/** Veřejný VAPID klíč (klient ho potřebuje k subscribe). */
pushRoutes.get("/api/push/vapid", (c) =>
	c.json({ publicKey: env.vapid.publicKey ?? null, enabled: pushEnabled }),
);

/** Uloží (upsert dle endpointu) push odběr přihlášeného uživatele. */
pushRoutes.post("/api/push/subscribe", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = subscribeSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success)
		return c.json({ error: "invalid_subscription", issues: parsed.error.issues }, 422);
	const { endpoint, keys: { p256dh, auth: authKey } } = parsed.data;
	const userAgent = (c.req.header("user-agent") ?? "").slice(0, 512) || null;

	const db = getDb();
	const result = await db.transaction(async (tx) => {
		const inserted = await tx
			.insert(pushSubscriptions)
			.values({
				userId: session.user.id,
				endpoint,
				p256dh,
				auth: authKey,
				userAgent,
			})
			.onConflictDoNothing()
			.returning({ id: pushSubscriptions.id });
		if (inserted.length > 0) return { conflict: false as const };
		const existing = (
			await tx
				.select({ userId: pushSubscriptions.userId })
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.endpoint, endpoint))
				.limit(1)
		)[0];
		if (!existing || existing.userId !== session.user.id) return { conflict: true as const };
		await tx
			.update(pushSubscriptions)
			.set({ p256dh, auth: authKey, userAgent })
			.where(
				and(
					eq(pushSubscriptions.endpoint, endpoint),
					eq(pushSubscriptions.userId, session.user.id),
				),
			);
		return { conflict: false as const };
	});
	if (result.conflict)
		return c.json(
			{
				error: "subscription_owned_by_another_account",
				action: "unsubscribe_in_browser_and_create_a_new_subscription",
			},
			409,
		);
	return c.json({ ok: true });
});

/** Zruší odběr dle endpointu. */
pushRoutes.post("/api/push/unsubscribe", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = unsubscribeSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success)
		return c.json({ error: "invalid_unsubscribe", issues: parsed.error.issues }, 422);
	const { endpoint } = parsed.data;
	const db = getDb();
	// CC-P0-09: mazat jen VLASTNÍ odběr — cizí session nesmí odhlásit cizí endpoint.
	await db
		.delete(pushSubscriptions)
		.where(
			and(
				eq(pushSubscriptions.endpoint, endpoint),
				eq(pushSubscriptions.userId, session.user.id),
			),
		);
	return c.json({ ok: true });
});

/** Testovací push na aktuálního uživatele (ověření celé cesty). */
pushRoutes.post("/api/push/test", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const delivered = await pushToUser(session.user.id, {
		title: "Watson · test",
		body: "Testovací připomínka — doručení funguje.",
		tag: "test",
		url: "/dnes",
	});
	return c.json({ ok: true, delivered });
});
