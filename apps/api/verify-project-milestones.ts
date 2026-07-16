/** Projektové milníky: ACL, idempotence, DB guard, task reference, audit a export. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	getDb,
	memberships,
	projectMembers,
	projectMilestones,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.PROJECT_MILESTONES_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
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

async function request(cookie: string, path: string, method: string, payload?: unknown) {
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

async function projectVersion(id: string): Promise<string> {
	const row = (await db.execute(sql`
		SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
		FROM projects WHERE id = ${id}
	`)) as unknown as { version: string }[];
	if (!row[0]?.version) throw new Error("project version missing");
	return row[0].version;
}

async function milestoneVersion(id: string): Promise<string> {
	const row = (await db.execute(sql`
		SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
		FROM project_milestones WHERE id = ${id}
	`)) as unknown as { version: string }[];
	if (!row[0]?.version) throw new Error("milestone version missing");
	return row[0].version;
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createdUsers = await db
		.insert(users)
		.values(
			["manager", "editor", "commenter", "outsider"].map((role) => ({
				id: crypto.randomUUID(),
				name: `Milestone ${role}`,
				email: `milestone-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})),
		)
		.returning({ id: users.id, email: users.email });
	const [manager, editor, commenter, outsider] = createdUsers;
	if (!manager || !editor || !commenter || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Milestones ${stamp}`, ownerId: manager.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values(
		createdUsers.map((user) => ({
			workspaceId: workspace.id,
			userId: user.id,
			role: user.id === manager.id ? ("manager" as const) : ("member" as const),
		})),
	);
	const [project, targetProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: manager.id, name: `Goal ${stamp}`, kind: "goal" },
			{ workspaceId: workspace.id, ownerId: manager.id, name: `Target ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!project || !targetProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: project.id, userId: commenter.id, role: "commenter" },
		{ projectId: targetProject.id, userId: manager.id, role: "manager" },
	]);
	const [completedTask, openTask, otherTask] = await db
		.insert(tasks)
		.values([
			{ projectId: project.id, name: "Hotový", completedAt: new Date("2026-07-10T10:00:00Z") },
			{ projectId: project.id, name: "Otevřený" },
			{ projectId: targetProject.id, name: "Jiný" },
		])
		.returning({ id: tasks.id });
	if (!completedTask || !openTask || !otherTask) throw new Error("tasks missing");

	try {
		const managerCookie = await login(manager.email);
		const editorCookie = await login(editor.email);
		const commenterCookie = await login(commenter.email);
		const outsiderCookie = await login(outsider.email);

		const initialProjectVersion = await projectVersion(project.id);
		let result = await request(editorCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			milestonesEnabled: true,
			expectedUpdatedAt: initialProjectVersion,
		});
		check("milníky zapíná jen manager", result.status === 403, result);
		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			milestonesEnabled: true,
			expectedUpdatedAt: initialProjectVersion,
		});
		check("manager milníky zapne", result.status === 200, result);
		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			status: "paused",
			expectedUpdatedAt: initialProjectVersion,
		});
		check("stará verze nastavení je CAS konfliktem", result.status === 409, result);

		const specificId = crypto.randomUUID();
		const specific = {
			id: specificId,
			title: "Dokončit klíčový úkol",
			conditionType: "task_completed",
			taskId: completedTask.id,
			targetCount: null,
			dueDate: "2026-07-10",
			position: 0,
		};
		result = await request(
			commenterCookie,
			`/api/projects/${project.id}/milestones`,
			"POST",
			specific,
		);
		check("commenter milník nevytvoří", result.status === 403, result);
		result = await request(
			outsiderCookie,
			`/api/projects/${project.id}/milestones`,
			"POST",
			specific,
		);
		check("uživatel mimo projekt dostane fail-closed 404", result.status === 404, result);
		result = await request(
			editorCookie,
			`/api/projects/${project.id}/milestones`,
			"POST",
			specific,
		);
		check("editor vytvoří milník", result.status === 201, result);
		result = await request(
			editorCookie,
			`/api/projects/${project.id}/milestones`,
			"POST",
			specific,
		);
		check("stejný create je idempotentní replay", result.status === 200, result);

		result = await request(
			editorCookie,
			`/api/projects/${project.id}/milestones`,
			"POST",
			{ ...specific, id: crypto.randomUUID(), taskId: otherTask.id, title: "Cizí úkol" },
		);
		check("milník nesmí odkazovat na cizí projekt", result.status === 409, result);

		const countId = crypto.randomUUID();
		result = await request(
			editorCookie,
			`/api/projects/${project.id}/milestones`,
			"POST",
			{
				id: countId,
				title: "Dva hotové úkoly",
				conditionType: "completed_count",
				taskId: null,
				targetCount: 2,
				dueDate: null,
				position: 1,
			},
		);
		check("početní milník vznikne", result.status === 201, result);

		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			status: "done",
			expectedUpdatedAt: await projectVersion(project.id),
		});
		check("nesplněný milník blokuje uzavření cílového projektu", result.status === 409, result);
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, openTask.id));
		result = await request(managerCookie, `/api/projects/${project.id}/settings`, "PATCH", {
			status: "done",
			expectedUpdatedAt: await projectVersion(project.id),
		});
		check("splněné milníky dovolí uzavření", result.status === 200, result);

		let regressionBlocked = false;
		try {
			await db.update(tasks).set({ completedAt: null }).where(eq(tasks.id, openTask.id));
		} catch {
			regressionBlocked = true;
		}
		const taskAfterRegression = await db
			.select({ completedAt: tasks.completedAt })
			.from(tasks)
			.where(eq(tasks.id, openTask.id));
		check(
			"DB guard blokuje pozdější regresi hotového projektu",
			regressionBlocked && taskAfterRegression[0]?.completedAt !== null,
			taskAfterRegression,
		);

		result = await request(managerCookie, "/api/tasks/delete", "POST", {
			taskIds: [completedTask.id],
			operationId: crypto.randomUUID(),
		});
		check("referencovaný milníkový úkol nelze smazat", result.status === 409, result);

		result = await request(managerCookie, "/api/tasks/bulk/preview", "POST", {
			taskIds: [completedTask.id],
			action: { kind: "move", projectId: targetProject.id },
		});
		const conflicts = result.body.conflicts as { code?: string }[] | undefined;
		check(
			"bulk preview předem blokuje přesun milníkového úkolu",
			result.status === 200 && conflicts?.some((item) => item.code === "milestones_block_move") === true,
			result,
		);

		const countVersion = await milestoneVersion(countId);
		result = await request(editorCookie, `/api/project-milestones/${countId}`, "PATCH", {
			title: "Alespoň dva hotové",
			expectedUpdatedAt: countVersion,
		});
		check("editor milník upraví", result.status === 200, result);
		result = await request(editorCookie, `/api/project-milestones/${countId}`, "PATCH", {
			title: "Přepsaná stará verze",
			expectedUpdatedAt: countVersion,
		});
		check("stará verze milníku je CAS konfliktem", result.status === 409, result);
		const specificVersion = await milestoneVersion(specificId);
		result = await request(editorCookie, `/api/project-milestones/${specificId}`, "DELETE", {
			confirm: "špatný název",
			expectedUpdatedAt: specificVersion,
		});
		check("smazání vyžaduje přesné potvrzení", result.status === 409, result);
		result = await request(editorCookie, `/api/project-milestones/${specificId}`, "DELETE", {
			confirm: specific.title,
			expectedUpdatedAt: specificVersion,
		});
		check("potvrzený milník se smaže", result.status === 200, result);

		const createProjectId = crypto.randomUUID();
		result = await request(managerCookie, "/api/projects", "POST", {
			id: createProjectId,
			workspaceId: workspace.id,
			name: "Projekt s výchozím milníkem",
			kind: "goal",
			preset: "delivery",
			milestonesEnabled: true,
		});
		const defaults = await db
			.select()
			.from(projectMilestones)
			.where(eq(projectMilestones.projectId, createProjectId));
		check(
			"checkbox při založení atomicky vytvoří výchozí milník",
			result.status === 201 && defaults.length === 1 && defaults[0]?.conditionType === "all_tasks_completed",
			{ result, defaults },
		);

		const audits = await db
			.select({ entity: auditEvents.entity, action: auditEvents.action })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.actorUserId, editor.id),
				),
			);
		check(
			"create/update/delete mají auditní stopu",
			["create", "update", "delete"].every((action) =>
				audits.some((event) => event.entity === "project_milestones" && event.action === action),
			),
			audits,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
	}

	if (failed > 0) throw new Error(`${failed} project milestone checks failed`);
	console.log("\nProject milestone checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
