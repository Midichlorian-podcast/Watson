/** Reálný PostgreSQL test atomického a tenant-scoped LuckyOS reconcile. */
import "./src/env";
import {
	and,
	assignments,
	auditEvents,
	entityLinks,
	eq,
	getDb,
	memberships,
	projects,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { type EmployeeStatus, reconcileEmployeeTasks } from "./src/employee";

const db = getDb();
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
}

async function main(): Promise<void> {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const makeIdentity = async (slug: string) => {
		const [user] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `Employee ${slug}`,
				email: `employee-${slug}-${stamp}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id });
		if (!user) throw new Error("user insert failed");
		const [workspace] = await db
			.insert(workspaces)
			.values({ name: `Osobní ${slug}`, ownerId: user.id, isPersonal: true })
			.returning({ id: workspaces.id });
		if (!workspace) throw new Error("workspace insert failed");
		await db
			.insert(memberships)
			.values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
		return { userId: user.id, workspaceId: workspace.id };
	};
	const a = await makeIdentity("a");
	const b = await makeIdentity("b");
	const payload: EmployeeStatus = {
		notifications: [
			{
				id: "same-upstream-id",
				type: "missing_document",
				title: "Dodat potvrzení",
				message: "Chybí potvrzení.",
				due: "2026-08-31",
			},
		],
	};
	try {
		const concurrent = await Promise.all([
			reconcileEmployeeTasks(a.userId, payload, "emp-test-a1"),
			reconcileEmployeeTasks(a.userId, payload, "emp-test-a2"),
		]);
		check(
			"dva souběžné reconcile vytvoří právě jeden aggregate",
			concurrent.reduce((sum, result) => sum + result.created, 0) === 1,
			concurrent,
		);
		const projectA = (
			await db
				.select({ id: projects.id })
				.from(projects)
				.where(and(eq(projects.workspaceId, a.workspaceId), eq(projects.name, "Zaměstnanec")))
		)[0];
		if (!projectA) throw new Error("employee project A missing");
		const tasksA = await db.select().from(tasks).where(eq(tasks.projectId, projectA.id));
		check("souběh nezanechá duplicitní task", tasksA.length === 1, tasksA.length);
		check(
			"task, assignment a lineage vzniknou společně",
			tasksA.length === 1 &&
				(await db.select().from(assignments).where(eq(assignments.taskId, tasksA[0]?.id ?? "")))
					.length === 1 &&
				(
					await db
						.select()
						.from(entityLinks)
						.where(eq(entityLinks.workspaceId, a.workspaceId))
				).length === 1,
		);

		const resultB = await reconcileEmployeeTasks(b.userId, payload, "emp-test-b");
		check(
			"stejné upstream ID v jiném tenantovi vytvoří vlastní task",
			resultB.created === 1,
			resultB,
		);
		const links = await db
			.select({ workspaceId: entityLinks.workspaceId })
			.from(entityLinks)
			.where(
				and(
					eq(entityLinks.sourceSystem, "luckyos"),
					eq(entityLinks.externalId, "same-upstream-id"),
				),
			);
		check(
			"dedup klíč je tenant-scoped",
			links.length === 2 && new Set(links.map((row) => row.workspaceId)).size === 2,
			links,
		);
		const replay = await reconcileEmployeeTasks(b.userId, payload, "emp-test-b-retry");
		check("opakování stejného importu nic neduplikuje", replay.created === 0 && replay.skipped === 1, replay);
		check(
			"každá skutečná mutace má audit ve stejném workspace",
			(
				await db
					.select()
					.from(auditEvents)
					.where(eq(auditEvents.entity, "employee_reconcile"))
			).filter((event) => event.workspaceId === a.workspaceId || event.workspaceId === b.workspaceId)
				.length === 2,
		);
	} finally {
		for (const identity of [a, b]) {
			await db.delete(workspaces).where(eq(workspaces.id, identity.workspaceId));
			await db.delete(users).where(eq(users.id, identity.userId));
		}
	}
	if (failed > 0) {
		console.error(`\nEmployee reconcile: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nEmployee reconcile: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
