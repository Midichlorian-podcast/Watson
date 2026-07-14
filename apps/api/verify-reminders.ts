/**
 * Regresní ověření CC-P0-09 (F0 slice) proti živé dev DB: připomínka NESMÍ dostat
 * `sent_at`, pokud provider nic nedoručil (0 subscriptions) nebo je kanál e-mail
 * (neimplementovaný). Před opravou scanAndSendDue nastavoval sent_at vždy.
 *
 * Vyžaduje běžící PostgreSQL (docker compose). Spuštění z kořene repa:
 *   pnpm --filter @watson/api verify:reminders
 *
 * Skript si vloží dvě testovací připomínky, spustí scan a zase je smaže —
 * na existující data nesahá (pending reminder bez remind_at scan přeskakuje).
 */
import "./src/env";
import { eq, getDb, reminders, tasks, users } from "@watson/db";
import { scanAndSendDue } from "./src/push";

async function main() {
	const db = getDb();
	const [user] = await db.select().from(users).where(eq(users.email, "demo@watson.test"));
	if (!user) throw new Error("demo@watson.test nenalezen");
	const [task] = await db.select().from(tasks).limit(1);
	if (!task) throw new Error("žádný task v DB");

	const past = new Date(Date.now() - 5 * 60_000);
	const inserted = await db
		.insert(reminders)
		.values([
			{
				taskId: task.id,
				projectId: task.projectId,
				userId: user.id,
				type: "time",
				remindAt: past,
				channel: "push",
			},
			{
				taskId: task.id,
				projectId: task.projectId,
				userId: user.id,
				type: "time",
				remindAt: past,
				channel: "email",
			},
		])
		.returning({ id: reminders.id, channel: reminders.channel });

	let failed = 0;
	try {
		await scanAndSendDue();
		for (const r of inserted) {
			const [row] = await db
				.select({ sentAt: reminders.sentAt })
				.from(reminders)
				.where(eq(reminders.id, r.id));
			if (row?.sentAt != null) {
				failed++;
				console.error(
					`  ✗ channel=${r.channel}: sent_at=${row.sentAt.toISOString()} přestože NIC nebylo doručeno (0 subscriptions / e-mail neimplementován)`,
				);
			} else {
				console.log(`  ✓ channel=${r.channel}: zůstává pending (sent_at NULL) — poctivý stav`);
			}
		}
	} finally {
		for (const r of inserted) await db.delete(reminders).where(eq(reminders.id, r.id));
	}

	if (failed) {
		console.error(`\nCC-P0-09 verify: ${failed} SELHALO — sent_at lže o doručení`);
		process.exit(1);
	}
	console.log("\nCC-P0-09 verify: vše prošlo");
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
