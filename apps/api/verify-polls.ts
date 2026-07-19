/** Vložitelné task ankety: typy, ACL, DB invarianty, audit, timeline, export a undo. */
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
	taskPollResponses,
	taskPolls,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.POLLS_API ?? "http://127.0.0.1:8790";
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
	const tokenRows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${tokenRows[0]?.identifier}&callbackURL=http://localhost:5173/`,
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

async function request(cookie: string, path: string, method: string, body?: unknown) {
	return fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: "http://localhost:5173",
			Cookie: cookie,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function createPoll(
	cookie: string,
	taskId: string,
	question: string,
	responseType: string,
	options?: string[],
) {
	const id = crypto.randomUUID();
	const response = await request(cookie, `/api/tasks/${taskId}/polls`, "POST", {
		id,
		question,
		responseType,
		...(options ? { options } : {}),
	});
	return { id, response, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const roles = ["owner", "editor", "commenter", "guest", "outsider"];
	const createdUsers = await db
		.insert(users)
		.values(
			roles.map((role) => ({
				id: crypto.randomUUID(),
				name: `Poll ${role}`,
				email: `poll-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})),
		)
		.returning({ id: users.id, email: users.email });
	const [owner, editor, commenter, guest, outsider] = createdUsers;
	if (!owner || !editor || !commenter || !guest || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Polls ${stamp}`, ownerId: owner.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values(
		createdUsers.map((user) => ({
			workspaceId: workspace.id,
			userId: user.id,
			role:
				user.id === guest.id
					? ("guest" as const)
					: user.id === owner.id
						? ("manager" as const)
						: ("member" as const),
		})),
	);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Poll project ${stamp}` },
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Other ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: owner.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: project.id, userId: commenter.id, role: "commenter" },
		{ projectId: project.id, userId: guest.id, role: "commenter" },
		{ projectId: otherProject.id, userId: owner.id, role: "manager" },
		{ projectId: otherProject.id, userId: outsider.id, role: "editor" },
	]);
	const taskId = crypto.randomUUID();
	const restoreTaskId = crypto.randomUUID();
	const otherTaskId = crypto.randomUUID();
	await db.insert(tasks).values([
		{ id: taskId, projectId: project.id, name: "Poll task", createdBy: editor.id },
		{ id: restoreTaskId, projectId: project.id, name: "Restore poll task", createdBy: owner.id },
		{ id: otherTaskId, projectId: otherProject.id, name: "Other poll task", createdBy: owner.id },
	]);

	try {
		const ownerCookie = await login(owner.email);
		const editorCookie = await login(editor.email);
		const commenterCookie = await login(commenter.email);
		const guestCookie = await login(guest.email);
		const outsiderCookie = await login(outsider.email);

		let denied = await createPoll(commenterCookie, taskId, "Zakázaná?", "text");
		check("commenter anketu nevytvoří", denied.response.status === 403, denied.body);
		denied = await createPoll(outsiderCookie, taskId, "Skrytá?", "text");
		check("úkol se nečlenovi neprozradí", denied.response.status === 404, denied.body);

		const single = await createPoll(editorCookie, taskId, "Půjdeme na večeři?", "single_choice", [
			"Ano",
			"Ne",
		]);
		const multiple = await createPoll(
			editorCookie,
			taskId,
			"Které termíny můžeš?",
			"multiple_choice",
			["Pondělí", "Úterý", "Středa"],
		);
		const text = await createPoll(editorCookie, taskId, "Co máme zlepšit?", "text");
		const number = await createPoll(editorCookie, taskId, "Kolik míst potřebujeme?", "number");
		const date = await createPoll(editorCookie, taskId, "Navrhni datum", "date");
		check(
			"editor vytvoří všech pět typů ankety",
			[single, multiple, text, number, date].every((poll) => poll.response.status === 201),
			[single, multiple, text, number, date].map((poll) => poll.response.status),
		);
		let response = await request(editorCookie, `/api/tasks/${taskId}/polls`, "POST", {
			id: crypto.randomUUID(),
			question: "Duplicitní volby",
			responseType: "single_choice",
			options: ["Ano", "ano"],
		});
		check("duplicitní volby jsou odmítnuty", response.status === 422, response.status);

		const singleRow = (await db.select().from(taskPolls).where(eq(taskPolls.id, single.id)))[0];
		const yes = singleRow?.options[0];
		if (!yes) throw new Error("single option missing");
		response = await request(commenterCookie, `/api/polls/${single.id}/response`, "PUT", {
			value: crypto.randomUUID(),
		});
		check("neznámá možnost se odmítne", response.status === 422, response.status);
		response = await request(commenterCookie, `/api/polls/${single.id}/response`, "PUT", {
			value: yes.id,
		});
		check("commenter může hlasovat", response.status === 200, response.status);
		response = await request(guestCookie, `/api/polls/${single.id}/response`, "PUT", { value: yes.id });
		check("workspace guest zůstává read-only", response.status === 403, response.status);
		response = await request(outsiderCookie, `/api/polls/${single.id}/response`, "PUT", {
			value: yes.id,
		});
		check("nečlen anketu přes API neuvidí", response.status === 404, response.status);

		const multipleRow = (await db.select().from(taskPolls).where(eq(taskPolls.id, multiple.id)))[0];
		const optionIds = multipleRow?.options.map((option) => option.id) ?? [];
		response = await request(ownerCookie, `/api/polls/${multiple.id}/response`, "PUT", {
			value: [optionIds[0], optionIds[0]],
		});
		check("vícenásobná odpověď nesmí duplikovat možnost", response.status === 422, response.status);
		response = await request(ownerCookie, `/api/polls/${multiple.id}/response`, "PUT", {
			value: optionIds.slice(0, 2),
		});
		check("výběr více možností projde", response.status === 200, response.status);
		response = await request(ownerCookie, `/api/polls/${text.id}/response`, "PUT", { value: "   " });
		check("prázdný text se odmítne", response.status === 422, response.status);
		response = await request(ownerCookie, `/api/polls/${text.id}/response`, "PUT", {
			value: "  Lepší podklady  ",
		});
		check("text se uloží oříznutý", response.status === 200, response.status);
		response = await request(ownerCookie, `/api/polls/${number.id}/response`, "PUT", { value: "42" });
		check("číselná anketa nepřijme text", response.status === 422, response.status);
		response = await request(ownerCookie, `/api/polls/${number.id}/response`, "PUT", { value: 42.5 });
		check("číselná odpověď projde", response.status === 200, response.status);
		response = await request(ownerCookie, `/api/polls/${date.id}/response`, "PUT", {
			value: "2026-02-30",
		});
		check("neexistující datum se odmítne", response.status === 422, response.status);
		response = await request(ownerCookie, `/api/polls/${date.id}/response`, "PUT", {
			value: "2026-09-15",
		});
		check("datum odpovědi projde", response.status === 200, response.status);

		const editable = await createPoll(ownerCookie, taskId, "Původní otázka", "single_choice", [
			"První",
			"Druhá",
		]);
		const editableBefore = (await db.select().from(taskPolls).where(eq(taskPolls.id, editable.id)))[0];
		response = await request(ownerCookie, `/api/polls/${editable.id}`, "PATCH", {
			question: "Upravená otázka",
			options: ["První", "Druhá", "Třetí"],
		});
		const editableAfter = (await db.select().from(taskPolls).where(eq(taskPolls.id, editable.id)))[0];
		check("bez odpovědí lze anketu opravit", response.status === 200, response.status);
		check(
			"nezměněná možnost zachová stabilní ID",
			editableBefore?.options[0]?.id === editableAfter?.options[0]?.id,
			editableAfter?.options,
		);
		response = await request(editorCookie, `/api/polls/${single.id}`, "PATCH", {
			question: "Přepsaná otázka",
		});
		check("po první odpovědi je význam ankety uzamčen", response.status === 409, response.status);

		response = await request(editorCookie, `/api/polls/${single.id}/close`, "POST");
		check("editor hlasování uzavře", response.status === 200, response.status);
		response = await request(commenterCookie, `/api/polls/${single.id}/response`, "PUT", {
			value: yes.id,
		});
		check("uzavřenou anketu nelze měnit", response.status === 409, response.status);
		response = await request(editorCookie, `/api/polls/${single.id}/reopen`, "POST");
		check("editor anketu znovu otevře", response.status === 200, response.status);
		const beforeAuditCount = (
			await db
				.select({ id: auditEvents.id })
				.from(auditEvents)
				.where(and(eq(auditEvents.entity, "task_poll_responses"), eq(auditEvents.actorUserId, commenter.id)))
		).length;
		response = await request(commenterCookie, `/api/polls/${single.id}/response`, "PUT", {
			value: yes.id,
		});
		const afterAuditCount = (
			await db
				.select({ id: auditEvents.id })
				.from(auditEvents)
				.where(and(eq(auditEvents.entity, "task_poll_responses"), eq(auditEvents.actorUserId, commenter.id)))
		).length;
		check(
			"stejná odpověď je idempotentní bez auditního šumu",
			response.status === 200 && beforeAuditCount === afterAuditCount,
		);

		let dbRejected = false;
		try {
			await db.insert(taskPollResponses).values({
				pollId: number.id,
				taskId,
				projectId: project.id,
				respondentId: editor.id,
				value: "not a number",
			});
		} catch {
			dbRejected = true;
		}
		check("DB trigger odmítne špatný typ i mimo API", dbRejected);
		dbRejected = false;
		try {
			await db.insert(taskPollResponses).values({
				pollId: single.id,
				taskId,
				projectId: project.id,
				respondentId: outsider.id,
				value: yes.id,
			});
		} catch {
			dbRejected = true;
		}
		check("DB trigger odmítne respondenta mimo projekt", dbRejected);

		const owned = await createPoll(ownerCookie, taskId, "Anketa autora", "text");
		response = await request(commenterCookie, `/api/polls/${owned.id}/response`, "PUT", {
			value: "Odpověď",
		});
		check("fixture ankety s odpovědí vznikla", response.status === 200, response.status);
		response = await request(
			editorCookie,
			`/api/polls/${owned.id}?confirm=${encodeURIComponent("Anketa autora")}`,
			"DELETE",
		);
		check("cizí editor nesmaže anketu s odpověďmi", response.status === 403, response.status);
		response = await request(ownerCookie, `/api/polls/${owned.id}?confirm=jiná`, "DELETE");
		check("delete vyžaduje přesné potvrzení otázky", response.status === 409, response.status);
		response = await request(
			ownerCookie,
			`/api/polls/${owned.id}?confirm=${encodeURIComponent("Anketa autora")}`,
			"DELETE",
		);
		check("autor odstraní vlastní používanou anketu", response.status === 200, response.status);
		check(
			"delete kaskádou odstraní odpovědi",
			(
				await db.select().from(taskPollResponses).where(eq(taskPollResponses.pollId, owned.id))
			).length === 0,
		);

		const restore = await createPoll(ownerCookie, restoreTaskId, "Obnovit rozhodnutí?", "single_choice", [
			"Ano",
			"Ne",
		]);
		const restoreRow = (await db.select().from(taskPolls).where(eq(taskPolls.id, restore.id)))[0];
		const restoreOption = restoreRow?.options[0];
		if (!restoreOption) throw new Error("restore option missing");
		await request(commenterCookie, `/api/polls/${restore.id}/response`, "PUT", {
			value: restoreOption.id,
		});
		await request(ownerCookie, `/api/polls/${restore.id}/close`, "POST");
		response = await request(ownerCookie, "/api/tasks/bulk/preview", "POST", {
			taskIds: [restoreTaskId],
			action: { kind: "move", projectId: otherProject.id },
		});
		const movePreview = (await response.json().catch(() => ({}))) as {
			conflicts?: { code: string }[];
		};
		check(
			"přesun úkolu s anketou neztratí data potichu",
			response.status === 200 &&
				movePreview.conflicts?.some((conflict) => conflict.code === "polls_block_move") === true,
			movePreview,
		);
		response = await request(ownerCookie, "/api/export", "GET");
		const backup = (await response.json().catch(() => ({}))) as {
			tables?: Record<string, Record<string, unknown>[]>;
		};
		check(
			"export obsahuje ankety i odpovědi",
			response.status === 200 &&
				backup.tables?.task_polls?.some((row) => row.id === restore.id) === true &&
				backup.tables?.task_poll_responses?.some((row) => row.poll_id === restore.id) === true,
			Object.keys(backup.tables ?? {}),
		);
		response = await request(ownerCookie, "/api/tasks/delete", "POST", {
			taskIds: [restoreTaskId],
			operationId: crypto.randomUUID(),
		});
		const deleted = (await response.json().catch(() => ({}))) as { batchId?: string };
		check("task delete s anketou uspěl", response.status === 200 && Boolean(deleted.batchId), deleted);
		response = await request(ownerCookie, "/api/tasks/restore", "POST", { batchId: deleted.batchId });
		const restoredPoll = (await db.select().from(taskPolls).where(eq(taskPolls.id, restore.id)))[0];
		const restoredResponse = (
			await db.select().from(taskPollResponses).where(eq(taskPollResponses.pollId, restore.id))
		)[0];
		check(
			"undo obnoví uzavřenou anketu i přesnou odpověď",
			response.status === 200 &&
				Boolean(restoredPoll?.closedAt) &&
				restoredResponse?.value === restoreOption.id,
			{ restoredPoll, restoredResponse },
		);

		response = await request(editorCookie, `/api/tasks/${taskId}/timeline`, "GET");
		const timeline = (await response.json().catch(() => ({}))) as {
			events?: { kind: string; excerpt?: string }[];
		};
		check(
			"časová osa obsahuje anketu i odpověď bez obsahu odpovědi",
			response.status === 200 &&
				timeline.events?.some(
					(event) => event.kind === "poll_created" && event.excerpt === "Půjdeme na večeři?",
				) === true &&
				timeline.events?.some(
					(event) =>
						event.kind === "poll_response_updated" && event.excerpt === "Půjdeme na večeři?",
				) === true,
			timeline,
		);
		const events = await db
			.select({
				entity: auditEvents.entity,
				action: auditEvents.action,
				before: auditEvents.before,
				diff: auditEvents.diff,
			})
			.from(auditEvents)
			.where(eq(auditEvents.workspaceId, workspace.id));
		check(
			"definice, odpovědi i lifecycle jsou auditované",
			events.some((event) => event.entity === "task_polls" && event.action === "create") &&
				events.some((event) => event.entity === "task_polls" && event.action === "close") &&
				events.some(
					(event) => event.entity === "task_poll_responses" && event.action === "create",
			),
			events,
		);
		const responseEvents = events.filter((event) => event.entity === "task_poll_responses");
		check(
			"audit odpovědí neukládá jejich obsah",
			responseEvents.length > 0 &&
				responseEvents.every(
					(event) =>
						!(event.before && "value" in event.before) &&
						!(event.diff && "value" in event.diff),
				),
			responseEvents,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
	}
	if (failed) throw new Error(`${failed} poll checks failed`);
	console.log("\nPoll checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
