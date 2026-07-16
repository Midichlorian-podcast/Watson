/** Integrační důkaz: preview, atomická dávka, idempotence, bezpečné undo a move scope. */
import "./src/env";
import {
	and,
	assignments,
	auditEvents,
	comments,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	statuses,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.TASK_BULK_API ?? "http://127.0.0.1:8790";
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

const post = async (cookie: string, path: string, body: unknown) => {
	const response = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", Cookie: cookie },
		body: JSON.stringify(body),
	});
	return {
		status: response.status,
		body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
	};
};

async function preview(cookie: string, taskIds: string[], action: Record<string, unknown>) {
	return post(cookie, "/api/tasks/bulk/preview", { taskIds, action });
}

async function execute(
	cookie: string,
	taskIds: string[],
	action: Record<string, unknown>,
	previewHash: string,
	operationId = crypto.randomUUID(),
) {
	return post(cookie, "/api/tasks/bulk/execute", { taskIds, action, previewHash, operationId });
}

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [manager, teammate, outsider] = await db
		.insert(users)
		.values([
			{ name: "Bulk manager", email: `bulk-manager-${suffix}@watson.test`, emailVerified: true },
			{ name: "Bulk teammate", email: `bulk-teammate-${suffix}@watson.test`, emailVerified: true },
			{ name: "Bulk outsider", email: `bulk-outsider-${suffix}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	if (!manager || !teammate || !outsider) throw new Error("bulk users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Bulk ${suffix}`, ownerId: manager.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("bulk workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: teammate.id, role: "member" },
		{ workspaceId: workspace.id, userId: outsider.id, role: "member" },
	]);
	const [source, target] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, name: "Bulk source", ownerId: manager.id },
			{ workspaceId: workspace.id, name: "Bulk target", ownerId: manager.id },
		])
		.returning({ id: projects.id });
	if (!source || !target) throw new Error("bulk projects missing");
	await db.insert(projectMembers).values([
		{ projectId: source.id, userId: manager.id, role: "manager" },
		{ projectId: source.id, userId: teammate.id, role: "editor" },
		{ projectId: target.id, userId: manager.id, role: "manager" },
	]);
	const [openStatus, doneStatus] = await db
		.insert(statuses)
		.values([
			{ projectId: source.id, name: "Open", position: 0, isDone: false },
			{ projectId: source.id, name: "Done", position: 1, isDone: true },
		])
		.returning({ id: statuses.id });
	if (!openStatus || !doneStatus) throw new Error("bulk statuses missing");
	const [plain, recurring, shared, child] = await db
		.insert(tasks)
		.values([
			{ projectId: source.id, name: "Plain", priority: 4, statusId: openStatus.id, createdBy: manager.id },
			{ projectId: source.id, name: "Recurring", priority: 4, recurrenceRule: JSON.stringify({ kind: "daily" }), createdBy: manager.id },
			{ projectId: source.id, name: "Shared", priority: 4, assignmentMode: "shared_all", createdBy: manager.id },
			{ projectId: source.id, name: "Child", priority: 4, createdBy: manager.id },
		])
		.returning({ id: tasks.id });
	if (!plain || !recurring || !shared || !child) throw new Error("bulk tasks missing");
	await db.update(tasks).set({ parentId: plain.id }).where(eq(tasks.id, child.id));
	await db.insert(assignments).values({
		taskId: plain.id,
		projectId: source.id,
		userId: teammate.id,
	});
	const [comment] = await db
		.insert(comments)
		.values({ taskId: child.id, projectId: source.id, authorId: manager.id, body: "Move me" })
		.returning({ id: comments.id });
	if (!comment) throw new Error("bulk comment missing");

	try {
		const managerCookie = await login(manager.email);
		const outsiderCookie = await login(outsider.email);
		const ids = [plain.id, recurring.id, shared.id];

		let p = await preview(managerCookie, ids, { kind: "priority", priority: 2 });
		check(
			"preview vrací přesný počet změn a recurrence scope",
			p.status === 200 && p.body.applyCount === 2 && p.body.skippedCount === 1,
			p,
		);
		const stalePriorityHash = String(p.body.previewHash);
		await db.update(tasks).set({ priority: 1 }).where(eq(tasks.id, plain.id));
		let x = await execute(
			managerCookie,
			ids,
			{ kind: "priority", priority: 2 },
			stalePriorityHash,
		);
		check("stale preview je odmítnut před jakoukoli dávkovou změnou", x.status === 409, x);
		const afterStale = await db
			.select({ id: tasks.id, priority: tasks.priority })
			.from(tasks)
			.where(sql`${tasks.id} = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})`);
		check(
			"stale command nepřepsal ostatní položky",
			afterStale.filter((row) => row.id !== plain.id).every((row) => row.priority === 4),
			afterStale,
		);
		await db.update(tasks).set({ priority: 4 }).where(eq(tasks.id, plain.id));
		p = await preview(managerCookie, ids, { kind: "priority", priority: 2 });
		const priorityHash = String(p.body.previewHash);
		const op = crypto.randomUUID();
		x = await execute(managerCookie, ids, { kind: "priority", priority: 2 }, priorityHash, op);
		check("atomický priority command uspěje", x.status === 200, x);
		const priorityRows = await db.select({ priority: tasks.priority }).from(tasks).where(sql`${tasks.id} = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})`);
		check(
			"bezpečné priority se změnily společně a řada zůstala",
			priorityRows.filter((row) => row.priority === 2).length === 2 &&
				priorityRows.filter((row) => row.priority === 4).length === 1,
			priorityRows,
		);
		const batchId = String(x.body.batchId);
		x = await execute(managerCookie, ids, { kind: "priority", priority: 2 }, priorityHash, op);
		check("stejný operation ID je idempotentní replay", x.status === 200 && x.body.replay === true, x);
		await db.update(tasks).set({ priority: 3 }).where(eq(tasks.id, plain.id));
		x = await post(managerCookie, "/api/tasks/bulk/undo", { batchId });
		check("undo nepřepíše novější změnu", x.status === 409 && x.body.error === "bulk_undo_stale", x);
		const afterStaleUndo = (await db.select().from(tasks).where(eq(tasks.id, plain.id)))[0];
		check("odmítnuté undo zachovalo novější hodnotu", afterStaleUndo?.priority === 3, afterStaleUndo);
		await db.update(tasks).set({ priority: 2 }).where(eq(tasks.id, plain.id));
		x = await post(managerCookie, "/api/tasks/bulk/undo", { batchId });
		check("batch undo uspěje", x.status === 200, x);
		const undone = await db.select({ priority: tasks.priority }).from(tasks).where(sql`${tasks.id} = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})`);
		check("jedno undo vrátí celou dávku", undone.every((row) => row.priority === 4), undone);

		p = await preview(managerCookie, ids, { kind: "reschedule", dueDate: "2026-08-01" });
		check("preview vysvětlí vynechanou opakovanou řadu", p.status === 200 && p.body.applyCount === 2 && p.body.skippedCount === 1, p);
		x = await execute(managerCookie, ids, { kind: "reschedule", dueDate: "2026-08-01" }, String(p.body.previewHash));
		check("termínová dávka uspěje", x.status === 200, x);
		const recurringAfter = (await db.select().from(tasks).where(eq(tasks.id, recurring.id)))[0];
		check("opakovaná řada zůstala beze změny", recurringAfter?.dueDate == null, recurringAfter?.dueDate);

		p = await preview(managerCookie, ids, { kind: "complete" });
		check("dokončení vynechá recurrence a shared_all", p.status === 200 && p.body.applyCount === 1 && p.body.skippedCount === 2, p);
		x = await execute(managerCookie, ids, { kind: "complete" }, String(p.body.previewHash));
		check("bezpečné bulk dokončení uspěje", x.status === 200, x);
		const completed = (await db.select().from(tasks).where(eq(tasks.id, plain.id)))[0];
		check("dokončení nastavilo done status", completed?.statusId === doneStatus.id && Boolean(completed.completedAt), completed);

		p = await preview(managerCookie, [plain.id, shared.id], { kind: "assign", userId: manager.id });
		check("assign preview vynechá shared_all", p.status === 200 && p.body.applyCount === 1 && p.body.skippedCount === 1, p);

		p = await preview(managerCookie, [plain.id], { kind: "move", projectId: target.id });
		check("move preview blokuje chybějící členství řešitele", p.status === 200 && p.body.canExecute === false, p);
		await db.insert(projectMembers).values({ projectId: target.id, userId: teammate.id, role: "editor" });
		p = await preview(managerCookie, [plain.id], { kind: "move", projectId: target.id });
		check("move preview počítá i potomka", p.status === 200 && p.body.treeCount === 2 && p.body.applyCount === 2, p);
		x = await execute(managerCookie, [plain.id], { kind: "move", projectId: target.id }, String(p.body.previewHash));
		check("move proběhne atomicky", x.status === 200, x);
		const movedTasks = await db.select().from(tasks).where(sql`${tasks.id} IN (${plain.id}, ${child.id})`);
		const movedComment = (await db.select().from(comments).where(eq(comments.id, comment.id)))[0];
		check("strom i denormalizovaný komentář změnily projekt", movedTasks.every((row) => row.projectId === target.id) && movedComment?.projectId === target.id, { movedTasks, movedComment });
		x = await post(managerCookie, "/api/tasks/bulk/undo", { batchId: String(x.body.batchId) });
		check("move undo uspěje", x.status === 200, x);
		const restoredChild = (await db.select().from(tasks).where(eq(tasks.id, child.id)))[0];
		check("move undo obnovilo scope i status rodiče", restoredChild?.projectId === source.id, restoredChild);

		p = await preview(managerCookie, [plain.id], { kind: "delete" });
		check("delete preview ukáže kaskádu stromu", p.status === 200 && p.body.treeCount === 2, p);
		p = await preview(managerCookie, [recurring.id], { kind: "delete" });
		check(
			"bulk delete opakované řady vyžaduje explicitní scope",
			p.status === 200 && p.body.canExecute === false && p.body.conflicts?.length === 1,
			p,
		);
		p = await preview(outsiderCookie, [plain.id], { kind: "priority", priority: 1 });
		check("uživatel mimo projekt nedostane preview", p.status === 403, p.status);

		const audits = await db
			.select({ action: auditEvents.action })
			.from(auditEvents)
			.where(and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.entity, "task_bulk_batch")));
		check("commandy i undo mají autoritativní audit", audits.some((row) => row.action === "priority") && audits.some((row) => row.action === "undo"), audits);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, outsider.id));
		await db.delete(users).where(eq(users.id, teammate.id));
		await db.delete(users).where(eq(users.id, manager.id));
	}

	if (failed) throw new Error(`${failed} task bulk checks failed`);
	console.log("\nTask bulk checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
