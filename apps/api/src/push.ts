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
	isNull,
	pushSubscriptions,
	reminders,
	tasks,
} from "@watson/db";
import { Hono } from "hono";
import webpush from "web-push";
import { auth } from "./auth";
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
): Promise<"ok" | "expired" | "error"> {
	try {
		await webpush.sendNotification(
			{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
			JSON.stringify(payload),
		);
		return "ok";
	} catch (e) {
		const code = (e as { statusCode?: number }).statusCode;
		if (code === 404 || code === 410) return "expired";
		console.error("[push] odeslání selhalo", code ?? "", (e as Error).message);
		return "error";
	}
}

/** Pošle notifikaci uživateli na všechna jeho zařízení. Vrací počet úspěšných doručení. */
export async function pushToUser(
	userId: string,
	payload: object,
): Promise<number> {
	if (!pushEnabled) return 0;
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
	let ok = 0;
	for (const s of subs) {
		const res = await sendOne(s, payload);
		if (res === "ok") ok++;
		else if (res === "expired")
			await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
	}
	return ok;
}

// E-mailový kanál připomínek: záměrně BEZ implementace i BEZ fake „sent" větve
// (CC-P0-09). Scan e-mailové připomínky přeskakuje; kanál se zapne až s reálným
// mailerem (Resend) a delivery state machine v F5.

/** Projde splatné připomínky (sent_at NULL, úkol nedokončený), doručí, označí sent. */
export async function scanAndSendDue(now: Date = new Date()): Promise<number> {
	const db = getDb();
	const rows = (await db
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
		})
		.from(reminders)
		.innerJoin(tasks, eq(tasks.id, reminders.taskId))
		.where(
			and(isNull(reminders.sentAt), isNull(tasks.completedAt)),
		)) as DueReminder[];

	let fired = 0;
	for (const r of rows) {
		const fireAt = reminderFireTime(r);
		if (!fireAt || fireAt.getTime() > now.getTime()) continue;
		// CC-P0-09: e-mailový kanál není implementovaný (sendEmailReminder je no-op) —
		// připomínka zůstává pending; `sent_at` nesmí lhát o doručení.
		if (r.channel === "email") continue;
		const payload = {
			title: "Watson · připomínka",
			body: r.taskName,
			tag: `reminder-${r.id}`,
			url: "/dnes",
		};
		const delivered = await pushToUser(r.userId, payload);
		// `sent_at` až po potvrzeném úspěchu aspoň jednoho odběru; při 0 doručeních
		// zůstává pending a další scan to zkusí znovu (plná state machine s retry
		// limitem a dead-letter = CC-P0-09 v F5).
		if (delivered === 0) continue;
		await db
			.update(reminders)
			.set({ sentAt: now })
			.where(eq(reminders.id, r.id));
		fired++;
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
		scanAndSendDue().catch((e) => console.error("[reminders] scan chyba", e));
	}, intervalMs);
	console.log(`[reminders] worker běží (interval ${intervalMs / 1000}s)`);
}

/** REST endpointy Web Push. */
export const pushRoutes = new Hono();

/** Veřejný VAPID klíč (klient ho potřebuje k subscribe). */
pushRoutes.get("/api/push/vapid", (c) =>
	c.json({ publicKey: env.vapid.publicKey ?? null, enabled: pushEnabled }),
);

/** Uloží (upsert dle endpointu) push odběr přihlášeného uživatele. */
pushRoutes.post("/api/push/subscribe", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = (await c.req.json().catch(() => null)) as {
		endpoint?: string;
		keys?: { p256dh?: string; auth?: string };
	} | null;
	const endpoint = body?.endpoint;
	const p256dh = body?.keys?.p256dh;
	const authKey = body?.keys?.auth;
	if (!endpoint || !p256dh || !authKey)
		return c.json({ error: "invalid subscription" }, 400);

	const db = getDb();
	await db
		.insert(pushSubscriptions)
		.values({
			userId: session.user.id,
			endpoint,
			p256dh,
			auth: authKey,
			userAgent: c.req.header("user-agent") ?? null,
		})
		// Kolize endpointu = STEJNÉ zařízení (push subscription je per browser profil,
		// sdílená napříč účty) → přepis na aktuální session je legitimní přepnutí účtu.
		// Vzdálený útočník by musel znát celý capability URL endpointu. Plné vlastnictví
		// + ověření řeší CC-P0-09/P1-10 se state machine; tady vědomě zůstává reassign.
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: { userId: session.user.id, p256dh, auth: authKey },
		});
	return c.json({ ok: true });
});

/** Zruší odběr dle endpointu. */
pushRoutes.post("/api/push/unsubscribe", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = (await c.req.json().catch(() => null)) as {
		endpoint?: string;
	} | null;
	if (!body?.endpoint) return c.json({ error: "invalid" }, 400);
	const db = getDb();
	// CC-P0-09: mazat jen VLASTNÍ odběr — cizí session nesmí odhlásit cizí endpoint.
	await db
		.delete(pushSubscriptions)
		.where(
			and(
				eq(pushSubscriptions.endpoint, body.endpoint),
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
