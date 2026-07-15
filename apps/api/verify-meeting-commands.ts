/**
 * Integrační test atomických commandů Meets proti reálnému API + PostgreSQL.
 * Ověřuje nejen HTTP odpověď, ale i počet a vazby řádků po úspěchu/rollbacku,
 * idempotentní retry a odmítnutí stejného command ID s jiným payloadem.
 */
import "./src/env";
import {
	and,
	assignments,
	auditEvents,
	entityLinks,
	eq,
	getDb,
	meetings,
	memberships,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.MEETING_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
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
	if (!cookie) throw new Error(`login ${email}: missing session cookie`);
	return cookie;
}

async function post(cookie: string, path: string, body: unknown): Promise<Response> {
	return fetch(`${API}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:5173",
			Cookie: cookie,
		},
		body: JSON.stringify(body),
	});
}

async function main(): Promise<void> {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const makeUser = async (slug: string) => {
		const [row] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `Meet command ${slug}`,
				email: `meet-command-${slug}-${stamp}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		if (!row) throw new Error(`user ${slug} was not created`);
		return row;
	};
	const owner = await makeUser("owner");
	const participant = await makeUser("participant");
	const outsider = await makeUser("outsider");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Meet commands ${stamp}`, ownerId: owner.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace was not created");
	const workspaceId = workspace.id;
	await db.insert(memberships).values([
		{ workspaceId, userId: owner.id, role: "admin" },
		{ workspaceId, userId: participant.id, role: "member" },
		{ workspaceId, userId: outsider.id, role: "member" },
	]);
	const [project] = await db
		.insert(projects)
		.values({ workspaceId, name: "Atomický projekt", ownerId: owner.id })
		.returning({ id: projects.id });
	if (!project) throw new Error("project was not created");
	const projectId = project.id;
	await db.insert(projectMembers).values([
		{ projectId, userId: owner.id, role: "manager" },
		{ projectId, userId: participant.id, role: "editor" },
	]);

	try {
		const cookie = await login(owner.email);
		const meetingId = crypto.randomUUID();
		const hubTaskId = crypto.randomUUID();
		const plan = {
			meetingId,
			hubTaskId,
			workspaceId,
			projectId,
			title: "Atomická porada",
			dueDate: "2026-08-20",
			startAt: "2026-08-20T08:30:00.000Z",
			durationMin: 60,
			participantIds: [owner.id, participant.id],
		};

		let response = await post(cookie, "/api/meetings/plan", plan);
		check("plan command uspěje", response.status === 200, response.status);
		const firstPlan = (await response.json().catch(() => ({}))) as { replayed?: boolean };
		check("první plan není replay", firstPlan.replayed === false, firstPlan);
		check(
			"vznikne právě jeden meeting",
			(await db.select().from(meetings).where(eq(meetings.id, meetingId))).length === 1,
		);
		check(
			"vznikne právě jeden hub task",
			(await db.select().from(tasks).where(eq(tasks.id, hubTaskId))).length === 1,
		);
		check(
			"vzniknou oba účastníci",
			(await db.select().from(assignments).where(eq(assignments.taskId, hubTaskId))).length === 2,
		);

		response = await post(cookie, "/api/meetings/plan", plan);
		const replayPlan = (await response.json().catch(() => ({}))) as { replayed?: boolean };
		check("stejný plan retry je 200 replay", response.status === 200 && replayPlan.replayed === true, {
			status: response.status,
			body: replayPlan,
		});
		check(
			"plan retry nevytvoří další assignments",
			(await db.select().from(assignments).where(eq(assignments.taskId, hubTaskId))).length === 2,
		);
		response = await post(cookie, "/api/meetings/plan", { ...plan, title: "Jiný payload" });
		check("stejné command ID s jiným plánem je 409", response.status === 409, response.status);

		const invalidMeetingId = crypto.randomUUID();
		const invalidHubId = crypto.randomUUID();
		response = await post(cookie, "/api/meetings/plan", {
			...plan,
			meetingId: invalidMeetingId,
			hubTaskId: invalidHubId,
			participantIds: [owner.id, outsider.id],
		});
		check("účastník mimo projekt je odmítnut", response.status === 422, response.status);
		check(
			"neplatný plan zanechá nula meeting řádků",
			(await db.select().from(meetings).where(eq(meetings.id, invalidMeetingId))).length === 0,
		);
		check(
			"neplatný plan zanechá nula task řádků",
			(await db.select().from(tasks).where(eq(tasks.id, invalidHubId))).length === 0,
		);

		const prepTaskId = crypto.randomUUID();
		await db.insert(tasks).values({
			id: prepTaskId,
			projectId,
			parentId: hubTaskId,
			name: "Přenést dál",
			createdBy: owner.id,
		});
		const followMeetingId = crypto.randomUUID();
		const followHubId = crypto.randomUUID();
		const followPlan = {
			...plan,
			meetingId: followMeetingId,
			hubTaskId: followHubId,
			title: "Navazující porada",
			dueDate: "2026-08-27",
			startAt: "2026-08-27T08:30:00.000Z",
			seriesId: meetingId,
			prevMeetingId: meetingId,
			carryTaskIds: [prepTaskId],
		};
		response = await post(cookie, "/api/meetings/plan", followPlan);
		check("follow-up command uspěje", response.status === 200, response.status);
		const carried = (await db.select().from(tasks).where(eq(tasks.id, prepTaskId)))[0];
		check("carryover se atomicky přesune pod nový hub", carried?.parentId === followHubId, carried);
		response = await post(cookie, "/api/meetings/plan", followPlan);
		check("follow-up retry je idempotentní", response.status === 200, response.status);
		response = await post(cookie, "/api/meetings/plan", { ...followPlan, carryTaskIds: [] });
		check("follow-up retry se změněným carry payloadem je 409", response.status === 409, response.status);

		const proposals = [
			{
				title: "Připravit rozpočet",
				kind: "action",
				keep: true,
				projectId,
				assigneeUserIds: [participant.id],
				priority: 2,
			},
			{
				title: "Schválit rozpočet",
				kind: "action",
				keep: true,
				projectId,
				parentIndex: 0,
			},
			{ title: "Použijeme variantu B", kind: "decision", keep: true },
			{ title: "Prověřit nejasný termín", kind: "unclear", keep: false },
		];
		const commitBody = { defaultProjectId: projectId, proposals };
		response = await post(cookie, `/api/meetings/${meetingId}/commit`, commitBody);
		const commitResult = (await response.json().catch(() => ({}))) as {
			created?: number;
			taskIds?: string[];
			replayed?: boolean;
		};
		check(
			"commit vytvoří dva akční body",
			response.status === 200 && commitResult.created === 2 && commitResult.taskIds?.length === 2,
			{ status: response.status, body: commitResult },
		);
		const taskIds = commitResult.taskIds ?? [];
		const createdTasks = taskIds.length
			? (await db.select().from(tasks).where(eq(tasks.meetingId, meetingId))).filter((task) =>
					taskIds.includes(task.id),
				)
			: [];
		check("oba body nesou meeting lineage", createdTasks.length === 2, createdTasks.length);
		const child = createdTasks.find((task) => task.name === "Schválit rozpočet");
		const parent = createdTasks.find((task) => task.name === "Připravit rozpočet");
		check("hierarchie návrhů je zachována", child?.parentId === parent?.id, { child, parent });
		check(
			"řešitel vznikne jen u určeného bodu",
			taskIds.length > 0 &&
				(await db.select().from(assignments).where(and(eq(assignments.userId, participant.id))))
					.filter((row) => taskIds.includes(row.taskId)).length === 1,
		);
		check(
			"lineage odkazy vzniknou ve stejné transakci",
			(
				await db
					.select()
					.from(entityLinks)
					.where(and(eq(entityLinks.fromType, "meeting"), eq(entityLinks.fromId, meetingId)))
			).length === 2,
		);
		const hub = (await db.select().from(tasks).where(eq(tasks.id, hubTaskId)))[0];
		check(
			"rozhodnutí i nejasnost zůstanou v trvalé stopě hubu",
			!!hub?.description?.includes("Použijeme variantu B") &&
				!!hub.description.includes("Prověřit nejasný termín"),
			hub?.description,
		);
		check(
			"meeting je committed",
			(await db.select().from(meetings).where(eq(meetings.id, meetingId)))[0]?.status === "committed",
		);

		response = await post(cookie, `/api/meetings/${meetingId}/commit`, commitBody);
		const replayCommit = (await response.json().catch(() => ({}))) as { replayed?: boolean };
		check(
			"stejný commit retry je 200 replay",
			response.status === 200 && replayCommit.replayed === true,
			{ status: response.status, body: replayCommit },
		);
		check(
			"commit retry nevytvoří další body",
			(await db.select().from(tasks).where(eq(tasks.meetingId, meetingId))).length === 3,
		);
		response = await post(cookie, `/api/meetings/${meetingId}/commit`, {
			...commitBody,
			proposals: [{ ...proposals[0], title: "Jiný commit" }],
		});
		check("jiný payload po commitu je 409", response.status === 409, response.status);

		const rollbackMeetingId = crypto.randomUUID();
		const rollbackHubId = crypto.randomUUID();
		response = await post(cookie, "/api/meetings/plan", {
			...plan,
			meetingId: rollbackMeetingId,
			hubTaskId: rollbackHubId,
			title: "Rollback porada",
		});
		check("setup rollback porady uspěje", response.status === 200, response.status);
		response = await post(cookie, `/api/meetings/${rollbackMeetingId}/commit`, {
			defaultProjectId: projectId,
			proposals: [
				{
					title: "Nesmí vzniknout",
					kind: "action",
					keep: true,
					projectId,
					assigneeUserIds: [outsider.id],
				},
			],
		});
		check("neplatný assignee je odmítnut 422", response.status === 422, response.status);
		check(
			"neplatný commit nevytvoří žádný akční bod",
			(await db.select().from(tasks).where(eq(tasks.meetingId, rollbackMeetingId))).length === 1,
		);
		check(
			"neplatný commit nezmění status",
			(await db.select().from(meetings).where(eq(meetings.id, rollbackMeetingId)))[0]?.status ===
				"scheduled",
		);
		check(
			"každý úspěšný command má audit",
			(
				await db
					.select()
					.from(auditEvents)
					.where(and(eq(auditEvents.entity, "meetings"), eq(auditEvents.entityId, meetingId)))
			).length >= 2,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
		for (const user of [owner, participant, outsider]) {
			await db.delete(users).where(eq(users.id, user.id));
		}
	}

	if (failed > 0) {
		console.error(`\nMeeting commands: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nMeeting commands: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
