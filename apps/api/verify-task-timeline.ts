/** Integrační důkaz: autoritativní časová osa, sanitizace, deduplikace, cursor a ACL. */
import "./src/env";
import {
	auditEvents,
	getDb,
	memberships,
	projectMembers,
	projects,
	taskActivity,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.TASK_TIMELINE_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

type TimelineEvent = {
	id: string;
	source: "audit" | "legacy";
	kind: string;
	actorName: string | null;
	changedFields: string[];
	commentId?: string;
	excerpt?: string;
};
type TimelinePage = { events: TimelineEvent[]; nextCursor: string | null };

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		"SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1",
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

const getTimeline = (cookie: string, taskId: string, query = "limit=10") =>
	fetch(`${API}/api/tasks/${taskId}/timeline?${query}`, {
		headers: { Origin: "http://localhost:5173", Cookie: cookie },
	});

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [member, outsider] = await db
		.insert(users)
		.values([
			{
				id: crypto.randomUUID(),
				name: "Timeline member",
				email: `timeline-member-${suffix}@watson.test`,
				emailVerified: true,
			},
			{
				id: crypto.randomUUID(),
				name: "Timeline outsider",
				email: `timeline-outsider-${suffix}@watson.test`,
				emailVerified: true,
			},
		])
		.returning({ id: users.id, email: users.email });
	if (!member || !outsider) throw new Error("timeline users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Timeline ${suffix}`, ownerId: member.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("timeline workspace missing");
	const [foreignWorkspace] = await db
		.insert(workspaces)
		.values({ name: `Foreign timeline ${suffix}`, ownerId: outsider.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!foreignWorkspace) throw new Error("foreign timeline workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: member.id, role: "manager" },
		{ workspaceId: workspace.id, userId: outsider.id, role: "admin" },
	]);
	const [project] = await db
		.insert(projects)
		.values({ workspaceId: workspace.id, ownerId: member.id, name: "Restricted timeline" })
		.returning({ id: projects.id });
	if (!project) throw new Error("timeline project missing");
	await db
		.insert(projectMembers)
		.values({ projectId: project.id, userId: member.id, role: "manager" });
	const [task] = await db
		.insert(tasks)
		.values({ projectId: project.id, name: "Timeline task", createdBy: member.id })
		.returning({ id: tasks.id });
	if (!task) throw new Error("timeline task missing");

	const start = Date.now() - 60_000;
	const auditData = [
		{ entity: "tasks", action: "put", diff: { name: "Timeline task", description: "SECRET_DESCRIPTION" } },
		{ entity: "tasks", action: "patch", diff: { description: "SECRET_DESCRIPTION_2" }, before: { description: "old secret" } },
		{ entity: "tasks", action: "patch", diff: { due_date: "2026-08-01" }, before: { due_date: "2026-07-30" } },
		{ entity: "tasks", action: "patch", diff: { name: "New public name" }, before: { name: "Timeline task" } },
		{ entity: "comments", action: "put", diff: { task_id: task.id, body: "Schválili jsme variantu A." } },
		{ entity: "comment_decisions", action: "put", diff: { task_id: task.id, comment_id: crypto.randomUUID() } },
		{ entity: "assignments", action: "put", diff: { task_id: task.id, user_id: member.id } },
		{ entity: "reminders", action: "put", diff: { task_id: task.id } },
		{ entity: "tasks", action: "patch", diff: { deadline: "2026-08-03" }, before: { deadline: "2026-08-02" } },
		{ entity: "tasks", action: "patch", diff: { color: "#123456" }, before: { color: null } },
		{ entity: "tasks", action: "patch", diff: { recurrence: "weekly" }, before: { recurrence: null } },
		{ entity: "tasks", action: "patch", diff: { duration_min: 45 }, before: { duration_min: 30 } },
	] as const;
	const auditIds: string[] = [];
	for (const [index, event] of auditData.entries()) {
		const id = crypto.randomUUID();
		auditIds.push(id);
		await db.insert(auditEvents).values({
			id,
			workspaceId: workspace.id,
			actorType: "user",
			actorUserId: member.id,
			entity: event.entity,
			entityId: event.entity === "tasks" ? task.id : crypto.randomUUID(),
			action: event.action,
			diff: event.diff,
			before: "before" in event ? event.before : null,
			createdAt: new Date(start - index * 1_000),
		});
	}
	await db.insert(auditEvents).values({
		workspaceId: foreignWorkspace.id,
		actorType: "user",
		actorUserId: outsider.id,
		entity: "comments",
		entityId: crypto.randomUUID(),
		action: "put",
		diff: { task_id: task.id, body: "CROSS_TENANT_SECRET" },
		createdAt: new Date(start + 1_000),
	});
	await db.insert(taskActivity).values([
		{
			id: crypto.randomUUID(),
			taskId: task.id,
			projectId: project.id,
			userId: member.id,
			field: "due_date",
			oldValue: "2026-07-30",
			newValue: "2026-08-01",
			createdAt: new Date(start - 2_000 + 500),
		},
		{
			id: crypto.randomUUID(),
			taskId: task.id,
			projectId: project.id,
			userId: member.id,
			field: "priority",
			oldValue: "4",
			newValue: "1",
			createdAt: new Date(start - 3_000 + 500),
		},
	]);

	try {
		const memberCookie = await login(member.email);
		const outsiderCookie = await login(outsider.email);
		let response = await getTimeline(memberCookie, task.id);
		const first = (await response.json()) as TimelinePage;
		check("člen projektu načte časovou osu", response.status === 200, response.status);
		check("první stránka drží limit a nabízí cursor", first.events.length === 10 && Boolean(first.nextCursor), first);
		response = await getTimeline(
			memberCookie,
			task.id,
			`limit=10&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
		);
		const second = (await response.json()) as TimelinePage;
		const all = [...first.events, ...second.events];
		check("druhá stránka se nepřekrývá", !first.events.some((event) => second.events.some((next) => next.id === event.id)));
		check("autoritativní audit + jediná unikátní legacy událost", all.length === 13, all.map((event) => event.id));
		check("odpověď obsahuje rozhodnutí i komentář", all.some((event) => event.kind === "decision_marked") && all.some((event) => event.kind === "comment_added"));
		check("shodný legacy termín je deduplikovaný", all.filter((event) => event.kind === "task_rescheduled").length === 2, all.filter((event) => event.kind === "task_rescheduled"));
		check("odlišná legacy změna ze stejného okamžiku zůstala", all.some((event) => event.source === "legacy" && event.changedFields.includes("priority")));
		check("jméno aktéra doplnil server", all.every((event) => event.actorName === "Timeline member"), all.map((event) => event.actorName));
		const serialized = JSON.stringify(all);
		check("citlivé hodnoty popisu se nevracejí", !serialized.includes("SECRET_DESCRIPTION") && all.some((event) => event.changedFields.includes("description")));
		check("cizí tenant nemůže podvrhnout související audit", !serialized.includes("CROSS_TENANT_SECRET"));

		response = await getTimeline(memberCookie, task.id, "limit=10&cursor=not-a-cursor");
		check("neplatný cursor je odmítnut", response.status === 422, response.status);
		response = await getTimeline(memberCookie, "not-a-uuid");
		check("neplatné id je odmítnuto", response.status === 422, response.status);
		response = await getTimeline(outsiderCookie, task.id);
		check("workspace admin mimo restricted projekt dostane fail-closed 404", response.status === 404, response.status);
	} finally {
		await db.delete(workspaces).where(({ id }, { eq }) => eq(id, workspace.id));
		await db.delete(workspaces).where(({ id }, { eq }) => eq(id, foreignWorkspace.id));
		await db.delete(users).where(({ id }, { eq }) => eq(id, outsider.id));
		await db.delete(users).where(({ id }, { eq }) => eq(id, member.id));
	}

	if (failed) throw new Error(`${failed} task timeline checks failed`);
	console.log("\nTask timeline checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
