/** Integrační důkaz: DAG závislostí, tenant scope a warning/strict politika dokončení. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	taskDependencies,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { sqlstateOf } from "./src/powersync";

const API = process.env.TASK_DEPENDENCIES_API ?? "http://127.0.0.1:8790";
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
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
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

const writer = (cookie: string) => {
	const clientId = `task-dependencies-${crypto.randomUUID()}`;
	let operation = 0;
	return (id: string, data: Record<string, unknown>) =>
		fetch(`${API}/api/sync/write`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:5173",
				Cookie: cookie,
			},
			body: JSON.stringify({
				op: "PUT",
				table: "task_dependencies",
				id,
				data,
				clientId,
				operationId: String(++operation),
			}),
		});
};

const patchPolicy = (cookie: string, workspaceId: string, policy: "warning" | "strict") =>
	fetch(`${API}/api/workspaces/${workspaceId}/task-conflict-policy`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", Cookie: cookie },
		body: JSON.stringify({ policy }),
	});

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [manager, member] = await db
		.insert(users)
		.values([
			{ id: crypto.randomUUID(), name: "Dependency manager", email: `dependency-manager-${suffix}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Dependency member", email: `dependency-member-${suffix}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	if (!manager || !member) throw new Error("dependency users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Dependencies ${suffix}`, ownerId: manager.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("dependency workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
	]);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: manager.id, name: "Dependency graph" },
			{ workspaceId: workspace.id, ownerId: manager.id, name: "Other graph" },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("dependency projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: member.id, role: "editor" },
		{ projectId: otherProject.id, userId: manager.id, role: "manager" },
		{ projectId: otherProject.id, userId: member.id, role: "editor" },
	]);
	const [a, b, c, d, other] = await db
		.insert(tasks)
		.values([
			{ projectId: project.id, name: "A", createdBy: manager.id },
			{ projectId: project.id, name: "B", createdBy: manager.id },
			{ projectId: project.id, name: "C", createdBy: manager.id },
			{ projectId: project.id, name: "D", createdBy: manager.id },
			{ projectId: otherProject.id, name: "Other", createdBy: manager.id },
		])
		.returning({ id: tasks.id });
	if (!a || !b || !c || !d || !other) throw new Error("dependency tasks missing");

	try {
		const managerCookie = await login(manager.email);
		const memberCookie = await login(member.email);
		const asMember = writer(memberCookie);
		const edgeId = crypto.randomUUID();
		let response = await asMember(edgeId, {
			project_id: project.id,
			blocking_task_id: a.id,
			blocked_task_id: b.id,
			created_by: manager.id,
		});
		check("editor přidá závislost ve svém projektu", response.status === 200, response.status);
		const stored = (await db.select().from(taskDependencies).where(eq(taskDependencies.id, edgeId)))[0];
		check("server odvodil autora závislosti", stored?.createdBy === member.id, stored);

		response = await asMember(crypto.randomUUID(), {
			project_id: project.id,
			blocking_task_id: a.id,
			blocked_task_id: b.id,
		});
		check("duplicitní hrana je konflikt", response.status === 409, response.status);
		response = await asMember(crypto.randomUUID(), {
			project_id: project.id,
			blocking_task_id: b.id,
			blocked_task_id: b.id,
		});
		check("úkol nemůže blokovat sám sebe", response.status === 422, response.status);
		response = await asMember(crypto.randomUUID(), {
			project_id: project.id,
			blocking_task_id: b.id,
			blocked_task_id: a.id,
		});
		check("opačná hrana nevytvoří cyklus", response.status === 422, response.status);
		response = await asMember(crypto.randomUUID(), {
			project_id: project.id,
			blocking_task_id: other.id,
			blocked_task_id: b.id,
		});
		check("hrana nespojí dva projekty", response.status === 403, response.status);

		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, b.id));
		check(
			"výchozí warning politika dokončení povolí",
			Boolean((await db.select().from(tasks).where(eq(tasks.id, b.id)))[0]?.completedAt),
		);
		await db.update(tasks).set({ completedAt: null }).where(eq(tasks.id, b.id));

		response = await patchPolicy(memberCookie, workspace.id, "strict");
		check("běžný člen nezmění politiku prostoru", response.status === 403, response.status);
		response = await patchPolicy(managerCookie, workspace.id, "strict");
		check("vedení zapne striktní politiku", response.status === 200, response.status);
		let strictCode: string | null = null;
		try {
			await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, b.id));
		} catch (error) {
			strictCode = sqlstateOf(error);
		}
		check("DB odmítne dokončení blokovaného úkolu", strictCode === "23514", strictCode);
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, a.id));
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, b.id));
		check(
			"po dokončení předchůdce lze pokračovat",
			Boolean((await db.select().from(tasks).where(eq(tasks.id, b.id)))[0]?.completedAt),
		);

		const opposite = await Promise.allSettled([
			db.insert(taskDependencies).values({
				id: crypto.randomUUID(), projectId: project.id, blockingTaskId: c.id, blockedTaskId: d.id, createdBy: manager.id,
			}),
			db.insert(taskDependencies).values({
				id: crypto.randomUUID(), projectId: project.id, blockingTaskId: d.id, blockedTaskId: c.id, createdBy: manager.id,
			}),
		]);
		const fulfilled = opposite.filter((result) => result.status === "fulfilled").length;
		const rejectedCodes = opposite
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map((result) => sqlstateOf(result.reason));
		check(
			"souběžné opačné inserty vytvoří právě jednu hranu",
			fulfilled === 1 && rejectedCodes[0] === "23514",
			{ fulfilled, rejectedCodes },
		);

		const policyAudits = await db
			.select({ id: auditEvents.id })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.action, "task_conflict_policy_update"),
				),
			);
		check("změna politiky je auditovaná", policyAudits.length === 1, policyAudits.length);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, manager.id));
	}

	if (failed) throw new Error(`${failed} task dependency checks failed`);
	console.log("\nTask dependency checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
