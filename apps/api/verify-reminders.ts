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
import {
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	reminders,
	sql,
	statuses,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { scanAndSendDue } from "./src/push";

async function main() {
	const db = getDb();
	// Ukliď případný fixture po přerušeném předchozím běhu. Testovací adresy jsou
	// vyhrazené pouze tomuto skriptu; FK cascade odstraní i jejich workspaces.
	await db.delete(workspaces).where(sql`${workspaces.ownerId} in (
		select id from users where email like ${"reminder-%@watson.test"}
	)`);
	await db.delete(users).where(sql`${users.email} like ${"reminder-%@watson.test"}`);
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [user] = await db
		.insert(users)
		.values({
			id: crypto.randomUUID(),
			name: "Reminder verification",
			email: `reminder-${stamp}@watson.test`,
			emailVerified: true,
		})
		.returning({ id: users.id });
	if (!user) throw new Error("test user setup failed");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Reminder ${stamp}`, ownerId: user.id, isPersonal: true })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("test workspace setup failed");
	await db.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
	const [project] = await db
		.insert(projects)
		.values({ workspaceId: workspace.id, ownerId: user.id, name: `Reminder ${stamp}` })
		.returning({ id: projects.id });
	if (!project) throw new Error("test project setup failed");
	await db.insert(projectMembers).values({ projectId: project.id, userId: user.id, role: "manager" });
	const [status] = await db
		.insert(statuses)
		.values({ scope: "project", projectId: project.id, name: "Čeká", position: 0, isDone: false })
		.returning({ id: statuses.id });
	if (!status) throw new Error("test status setup failed");
	const [task] = await db
		.insert(tasks)
		.values({
			projectId: project.id,
			name: "Reminder verification task",
			statusId: status.id,
			createdBy: user.id,
			startDate: new Date(Date.now() + 30 * 60_000),
			startTimezone: "UTC",
		})
		.returning({ id: tasks.id, projectId: tasks.projectId });
	if (!task) throw new Error("test task setup failed");

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
			{
				taskId: task.id,
				projectId: task.projectId,
				userId: user.id,
				type: "relative",
				offsetMin: 60,
				channel: "push",
			},
			{
				taskId: task.id,
				projectId: task.projectId,
				userId: user.id,
				type: "relative",
				offsetMin: 10,
				channel: "push",
			},
		])
		.returning({
			id: reminders.id,
			channel: reminders.channel,
			type: reminders.type,
			offsetMin: reminders.offsetMin,
		});

	let failed = 0;
	try {
		// Dva workery současně: SKIP LOCKED dovolí claim pouze jednomu.
		await Promise.all([scanAndSendDue(), scanAndSendDue()]);
		for (const r of inserted) {
			const [row] = await db
				.select({
					sentAt: reminders.sentAt,
					deliveryState: reminders.deliveryState,
					attempts: reminders.attempts,
				})
				.from(reminders)
				.where(eq(reminders.id, r.id));
			if (row?.sentAt != null) {
				failed++;
				console.error(
					`  ✗ channel=${r.channel}: sent_at=${row.sentAt.toISOString()} přestože NIC nebylo doručeno (0 subscriptions / e-mail neimplementován)`,
				);
			} else {
				console.log(`  ✓ channel=${r.channel}: sent_at NULL — poctivý stav`);
			}
			if (r.channel === "push" && r.type === "relative" && r.offsetMin === 10) {
				if (row?.deliveryState !== "pending" || row.attempts !== 0) {
					failed++;
					console.error(
						`  ✗ future relative reminder fired early: state=${row?.deliveryState}, attempts=${row?.attempts}`,
					);
				} else console.log("  ✓ pozdější připomínka zůstala nezávisle pending/0");
			} else if (r.channel === "push") {
				if (row?.deliveryState !== "retry" || row.attempts !== 1) {
					failed++;
					console.error(
						`  ✗ concurrent claim: state=${row?.deliveryState}, attempts=${row?.attempts}; čekáno retry/1`,
					);
				} else console.log("  ✓ dva workery provedly právě jeden pokus (retry/1)");
			} else if (row?.deliveryState !== "pending" || row.attempts !== 0) {
				failed++;
				console.error(
					`  ✗ email no-op změnil frontu: state=${row?.deliveryState}, attempts=${row?.attempts}`,
				);
			} else console.log("  ✓ neimplementovaný email zůstal pending/0");
		}

		const pushId = inserted.find((row) => row.channel === "push" && row.type === "time")?.id;
		if (!pushId) throw new Error("push reminder nebyl vložen");
		// Vynutíme čtyři další splatné retry; pátý neúspěch musí skončit dead-letter.
		for (let attempt = 2; attempt <= 5; attempt++) {
			await db
				.update(reminders)
				.set({ nextAttemptAt: new Date(Date.now() - 1_000) })
				.where(eq(reminders.id, pushId));
			await scanAndSendDue();
		}
		const [dead] = await db
			.select({
				state: reminders.deliveryState,
				attempts: reminders.attempts,
				sentAt: reminders.sentAt,
				error: reminders.lastErrorCode,
			})
			.from(reminders)
			.where(eq(reminders.id, pushId));
		if (
			dead?.state !== "dead" ||
			dead.attempts !== 5 ||
			dead.sentAt != null ||
			!dead.error
		) {
			failed++;
			console.error(`  ✗ dead-letter po 5 pokusech — ${JSON.stringify(dead)}`);
		} else console.log("  ✓ po 5 neúspěších je reminder dead, sent_at NULL a má safe error code");
	} finally {
		// Workspace delete uklidí projekt, task i reminders přes FK cascade.
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, user.id));
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
