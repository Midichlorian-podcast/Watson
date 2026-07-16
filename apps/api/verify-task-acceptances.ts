/** Urgent task acceptance: project policy, DB reconciliation, ACL, CAS, audit and undo. */
import "./src/env";
import {
	and,
	assignments,
	auditEvents,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	taskAcceptances,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.TASK_ACCEPTANCES_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

function isAcceptanceGuard(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; message?: unknown; cause?: unknown };
		if (value.code === "P0001" || String(value.message).includes("task_acceptance_required")) return true;
		current = value.cause;
	}
	return false;
}

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as unknown as { identifier: string }[];
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

async function request(cookie: string, path: string, method = "GET", payload?: unknown) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: "http://localhost:5173",
			Cookie: cookie,
			...(payload === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: payload === undefined ? undefined : JSON.stringify(payload),
	});
	return {
		status: response.status,
		body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
	};
}

async function version(table: "projects" | "task_acceptances", id: string) {
	const rows = (await db.execute(sql`
		SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
		FROM ${sql.raw(table)} WHERE id = ${id}
	`)) as unknown as { version: string }[];
	if (!rows[0]?.version) throw new Error(`${table} version missing`);
	return rows[0].version;
}

async function acceptance(taskId: string, assigneeId: string) {
	return (
		await db
			.select()
			.from(taskAcceptances)
			.where(
				and(
					eq(taskAcceptances.taskId, taskId),
					eq(taskAcceptances.assigneeId, assigneeId),
				),
			)
	)[0];
}

async function respond(
	cookie: string,
	id: string,
	status: "accepted" | "declined",
	note: string | null = null,
	expectedUpdatedAt?: string,
) {
	return request(cookie, `/api/task-acceptances/${id}/respond`, "POST", {
		status,
		note,
		expectedUpdatedAt: expectedUpdatedAt ?? (await version("task_acceptances", id)),
	});
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createdUsers = await db
		.insert(users)
		.values(
			["manager", "editor", "assignee", "second", "outsider"].map((role) => ({
				id: crypto.randomUUID(),
				name: `Acceptance ${role}`,
				email: `acceptance-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})),
		)
		.returning({ id: users.id, email: users.email });
	const [manager, editor, assignee, second, outsider] = createdUsers;
	if (!manager || !editor || !assignee || !second || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Acceptance ${stamp}`, ownerId: manager.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values(
		[manager, editor, assignee, second].map((user) => ({
			workspaceId: workspace.id,
			userId: user.id,
			role: user.id === manager.id ? ("manager" as const) : ("member" as const),
		})),
	);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: manager.id, name: `Urgent ${stamp}` },
			{ workspaceId: workspace.id, ownerId: manager.id, name: `Other ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: project.id, userId: assignee.id, role: "editor" },
		{ projectId: project.id, userId: second.id, role: "editor" },
		{ projectId: otherProject.id, userId: manager.id, role: "manager" },
	]);
	const [urgent, ordinary, selfAssigned, p2] = await db
		.insert(tasks)
		.values([
			{ projectId: project.id, name: "Urgent P1", priority: 1, createdBy: manager.id },
			{ projectId: project.id, name: "Ordinary P3", priority: 3, createdBy: manager.id },
			{ projectId: project.id, name: "Self P1", priority: 1, createdBy: assignee.id },
			{ projectId: project.id, name: "Urgent P2", priority: 2, createdBy: manager.id },
		])
		.returning({ id: tasks.id });
	if (!urgent || !ordinary || !selfAssigned || !p2) throw new Error("tasks missing");
	await db.insert(assignments).values(
		[urgent, ordinary, selfAssigned, p2].map((task) => ({
			taskId: task.id,
			projectId: project.id,
			userId: assignee.id,
		})),
	);

	try {
		const managerCookie = await login(manager.email);
		const editorCookie = await login(editor.email);
		const assigneeCookie = await login(assignee.email);
		const secondCookie = await login(second.email);
		const outsiderCookie = await login(outsider.email);

		check(
			"výchozí politika nevytváří akceptace",
			(await db.select().from(taskAcceptances).where(eq(taskAcceptances.projectId, project.id)))
				.length === 0,
		);
		const initialVersion = await version("projects", project.id);
		let result = await request(editorCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			urgentAcceptanceEnabled: true,
			urgentAcceptancePriority: 1,
			expectedUpdatedAt: initialVersion,
		});
		check("politiku nezapne běžný editor", result.status === 403, result);
		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			urgentAcceptanceEnabled: true,
			urgentAcceptancePriority: 1,
			expectedUpdatedAt: initialVersion,
		});
		check("manager zapne P1 politiku", result.status === 200, result);
		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			urgentAcceptanceEnabled: false,
			expectedUpdatedAt: initialVersion,
		});
		check("nastavení používá CAS", result.status === 409, result);

		const urgentAcceptance = await acceptance(urgent.id, assignee.id);
		check("P1 cizí assignment vytvoří pending akceptaci", urgentAcceptance?.status === "pending", urgentAcceptance);
		check("P3 běžný úkol akceptaci nemá", !(await acceptance(ordinary.id, assignee.id)));
		check("vlastní assignment akceptaci nemá", !(await acceptance(selfAssigned.id, assignee.id)));
		check("P2 při hranici P1 akceptaci nemá", !(await acceptance(p2.id, assignee.id)));

		await db.insert(assignments).values({
			taskId: urgent.id,
			projectId: project.id,
			userId: second.id,
		});
		const secondAcceptance = await acceptance(urgent.id, second.id);
		check("pozdější assignment dostane vlastní pending rozhodnutí", secondAcceptance?.status === "pending");

		let taskCompletionBlocked = false;
		try {
			await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, urgent.id));
		} catch (error) {
			taskCompletionBlocked = isAcceptanceGuard(error);
		}
		check("DB blokuje dokončení úkolu před akceptací", taskCompletionBlocked);
		const urgentAssignment = (
			await db
				.select()
				.from(assignments)
				.where(and(eq(assignments.taskId, urgent.id), eq(assignments.userId, assignee.id)))
		)[0];
		let assignmentCompletionBlocked = false;
		try {
			if (urgentAssignment)
				await db
					.update(assignments)
					.set({ completedAt: new Date() })
					.where(eq(assignments.id, urgentAssignment.id));
		} catch (error) {
			assignmentCompletionBlocked = isAcceptanceGuard(error);
		}
		check("DB blokuje i per-osobní dokončení před akceptací", assignmentCompletionBlocked);

		if (!urgentAcceptance || !secondAcceptance) throw new Error("acceptances missing");
		result = await respond(editorCookie, urgentAcceptance.id, "accepted");
		check("jiný člen nerozhodne za řešitele", result.status === 403, result);
		result = await respond(outsiderCookie, urgentAcceptance.id, "accepted");
		check("uživatel mimo projekt dostane fail-closed 404", result.status === 404, result);
		const firstVersion = await version("task_acceptances", urgentAcceptance.id);
		const secretNote = `secret-note-${stamp}`;
		result = await respond(assigneeCookie, urgentAcceptance.id, "accepted", secretNote, firstVersion);
		check("řešitel urgentní úkol přijme", result.status === 200, result);
		result = await respond(assigneeCookie, urgentAcceptance.id, "accepted", secretNote, firstVersion);
		check("přesný retry je idempotentní", result.status === 200 && result.body.replayed === true, result);
		result = await respond(secondCookie, secondAcceptance.id, "declined", "Potřebuji upřesnit");
		check("druhý řešitel může odmítnout", result.status === 200, result);

		taskCompletionBlocked = false;
		try {
			await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, urgent.id));
		} catch {
			taskCompletionBlocked = true;
		}
		check("jedno odmítnutí dál blokuje dokončení", taskCompletionBlocked);
		const declinedVersion = await version("task_acceptances", secondAcceptance.id);
		result = await respond(secondCookie, secondAcceptance.id, "accepted", null, declinedVersion);
		check("řešitel může před prací rozhodnutí změnit", result.status === 200, result);
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, urgent.id));
		const completed = await db.select().from(tasks).where(eq(tasks.id, urgent.id));
		check("po všech přijetích lze úkol dokončit", completed[0]?.completedAt !== null, completed);
		result = await respond(
			assigneeCookie,
			urgentAcceptance.id,
			"declined",
			null,
			await version("task_acceptances", urgentAcceptance.id),
		);
		check("po dokončení je rozhodnutí zamčené", result.status === 409, result);

		await db.update(tasks).set({ priority: 1 }).where(eq(tasks.id, ordinary.id));
		let ordinaryAcceptance = await acceptance(ordinary.id, assignee.id);
		check("zvýšení priority na P1 vytvoří požadavek", ordinaryAcceptance?.status === "pending");
		await db.update(tasks).set({ priority: 3 }).where(eq(tasks.id, ordinary.id));
		ordinaryAcceptance = await acceptance(ordinary.id, assignee.id);
		check("snížení priority požadavek zruší", ordinaryAcceptance?.status === "cancelled");
		await db.update(tasks).set({ priority: 1 }).where(eq(tasks.id, ordinary.id));
		ordinaryAcceptance = await acceptance(ordinary.id, assignee.id);
		check("opětovná urgence vytvoří nové pending rozhodnutí", ordinaryAcceptance?.status === "pending");
		const ordinaryAssignment = (
			await db
				.select()
				.from(assignments)
				.where(and(eq(assignments.taskId, ordinary.id), eq(assignments.userId, assignee.id)))
		)[0];
		if (!ordinaryAssignment) throw new Error("ordinary assignment missing");
		await db.delete(assignments).where(eq(assignments.id, ordinaryAssignment.id));
		ordinaryAcceptance = await acceptance(ordinary.id, assignee.id);
		check("odebrání řešitele akceptaci zruší", ordinaryAcceptance?.status === "cancelled");
		await db.insert(assignments).values({
			taskId: ordinary.id,
			projectId: project.id,
			userId: assignee.id,
		});
		ordinaryAcceptance = await acceptance(ordinary.id, assignee.id);
		check("znovupřiřazení vyžádá nové rozhodnutí", ordinaryAcceptance?.status === "pending");

		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			urgentAcceptancePriority: 2,
			expectedUpdatedAt: await version("projects", project.id),
		});
		check("manager rozšíří hranici na P1–P2", result.status === 200, result);
		check("P2 po změně dostane pending akceptaci", (await acceptance(p2.id, assignee.id))?.status === "pending");

		let crossProjectGuard = false;
		try {
			await db.insert(taskAcceptances).values({
				taskId: p2.id,
				projectId: otherProject.id,
				assigneeId: second.id,
			});
		} catch {
			crossProjectGuard = true;
		}
		check("same-project FK odmítne cizí project_id", crossProjectGuard);

		const undoTaskId = crypto.randomUUID();
		await db.insert(tasks).values({
			id: undoTaskId,
			projectId: project.id,
			name: "Acceptance undo",
			priority: 1,
			createdBy: manager.id,
		});
		await db.insert(assignments).values({ taskId: undoTaskId, projectId: project.id, userId: assignee.id });
		const undoAcceptance = await acceptance(undoTaskId, assignee.id);
		if (!undoAcceptance) throw new Error("undo acceptance missing");
		await respond(assigneeCookie, undoAcceptance.id, "accepted");
		result = await request(managerCookie, "/api/tasks/delete", "POST", {
			taskIds: [undoTaskId],
			operationId: crypto.randomUUID(),
		});
		const batchId = result.body.batchId as string | undefined;
		check("smazání urgentního úkolu vytvoří undo batch", result.status === 200 && Boolean(batchId), result);
		check("cascade odstraní akceptaci", !(await acceptance(undoTaskId, assignee.id)));
		result = await request(managerCookie, "/api/tasks/restore", "POST", { batchId });
		check("undo obnoví úkol", result.status === 200, result);
		check("undo obnoví přijatou akceptaci", (await acceptance(undoTaskId, assignee.id))?.status === "accepted");

		const timeline = await request(managerCookie, `/api/tasks/${urgent.id}/timeline?limit=100`);
		const kinds = ((timeline.body.events as { kind?: string }[] | undefined) ?? []).map((event) => event.kind);
		check(
			"časová osa obsahuje request, accept i decline",
			timeline.status === 200 &&
				["acceptance_requested", "acceptance_accepted", "acceptance_declined"].every((kind) =>
					kinds.includes(kind),
				),
			{ status: timeline.status, kinds },
		);
		const auditRows = await db
			.select({ action: auditEvents.action, diff: auditEvents.diff, before: auditEvents.before })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.entity, "task_acceptances"),
				),
			);
		check(
			"audit pokrývá systémový request i lidská rozhodnutí",
			["requested", "accepted", "declined", "cancelled"].every((action) =>
				auditRows.some((row) => row.action === action),
			),
			auditRows,
		);
		check("audit neukládá text poznámky", !JSON.stringify(auditRows).includes(secretNote));

		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			urgentAcceptanceEnabled: false,
			expectedUpdatedAt: await version("projects", project.id),
		});
		check("manager politiku vypne", result.status === 200, result);
		check("vypnutí zruší všechny čekající požadavky", (await acceptance(p2.id, assignee.id))?.status === "cancelled");
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, p2.id));
		check("bez politiky dokončení zůstává běžné", (await db.select().from(tasks).where(eq(tasks.id, p2.id)))[0]?.completedAt !== null);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
	}

	if (failed > 0) throw new Error(`${failed} task acceptance checks failed`);
	console.log("\nTask acceptance checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
