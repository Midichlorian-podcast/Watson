/** Atomické delete+undo: meeting sidecar, descendants, podřízená data, ACL a retry. */
import "./src/env";
import {
	and,
	assignments,
	attachmentBlobs,
	attachments,
	auditEvents,
	commentDecisions,
	commentReactions,
	comments,
	entityLinks,
	eq,
	getDb,
	meetings,
	memberships,
	mentions,
	projectMembers,
	projects,
	sql,
	taskActivity,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.TASK_DELETE_API ?? "http://127.0.0.1:8790";
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

async function command(cookie: string, path: string, body: unknown): Promise<Response> {
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
	const [owner, editor] = await db
		.insert(users)
		.values([
			{
				id: crypto.randomUUID(),
				name: "Delete owner",
				email: `delete-owner-${stamp}@watson.test`,
				emailVerified: true,
			},
			{
				id: crypto.randomUUID(),
				name: "Delete editor",
				email: `delete-editor-${stamp}@watson.test`,
				emailVerified: true,
			},
		])
		.returning({ id: users.id, email: users.email });
	if (!owner || !editor) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Delete ${stamp}`, ownerId: owner.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: owner.id, role: "manager" },
		{ workspaceId: workspace.id, userId: editor.id, role: "member" },
	]);
	const [project] = await db
		.insert(projects)
		.values({ workspaceId: workspace.id, ownerId: owner.id, name: `Delete project ${stamp}` })
		.returning({ id: projects.id });
	if (!project) throw new Error("project missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: owner.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
	]);
	const meetingId = crypto.randomUUID();
	const hubId = crypto.randomUUID();
	const childId = crypto.randomUUID();
	const actionId = crypto.randomUUID();
	const assignmentId = crypto.randomUUID();
	const commentId = crypto.randomUUID();
	const decisionId = crypto.randomUUID();
	const mentionId = crypto.randomUUID();
	const reactionId = crypto.randomUUID();
	const activityId = crypto.randomUUID();
	const linkId = crypto.randomUUID();
	const attachmentId = crypto.randomUUID();
	const attachmentBytes = new TextEncoder().encode("undo must restore this attachment");
	await db.transaction(async (tx) => {
		await tx.insert(tasks).values([
			{
				id: hubId,
				projectId: project.id,
				name: "Atomic meeting",
				kind: "meeting",
				meetingId,
				createdBy: owner.id,
			},
			{
				id: childId,
				projectId: project.id,
				parentId: hubId,
				name: "Preparation child",
				createdBy: owner.id,
			},
			{
				id: actionId,
				projectId: project.id,
				name: "Committed action survives meeting deletion",
				meetingId,
				createdBy: owner.id,
			},
		]);
		await tx.insert(meetings).values({
			id: meetingId,
			workspaceId: workspace.id,
			title: "Secret meeting transcript",
			transcript: "Sensitive notes",
			status: "committed",
			hubTaskId: hubId,
			createdBy: owner.id,
		});
	});
	await db.insert(assignments).values({
		id: assignmentId,
		taskId: hubId,
		projectId: project.id,
		userId: owner.id,
	});
	await db.insert(comments).values({
		id: commentId,
		taskId: childId,
		projectId: project.id,
		authorId: owner.id,
		body: "Child detail",
	});
	await db.insert(commentDecisions).values({
		id: decisionId,
		commentId,
		taskId: childId,
		projectId: project.id,
		markedBy: owner.id,
	});
	await db.insert(mentions).values({
		id: mentionId,
		commentId,
		taskId: childId,
		projectId: project.id,
		userId: editor.id,
		createdBy: owner.id,
	});
	await db.insert(commentReactions).values({
		id: reactionId,
		commentId,
		taskId: childId,
		projectId: project.id,
		userId: editor.id,
		emoji: "👍",
	});
	await db.insert(taskActivity).values({
		id: activityId,
		taskId: hubId,
		projectId: project.id,
		userId: owner.id,
		field: "created",
		newValue: "Atomic meeting",
	});
	await db.insert(entityLinks).values({
		id: linkId,
		workspaceId: workspace.id,
		fromType: "meeting",
		fromId: meetingId,
		toType: "task",
		toId: actionId,
		relation: "derived_from",
	});
	await db.insert(attachments).values({
		id: attachmentId,
		taskId: childId,
		projectId: project.id,
		url: `/api/attachments/${attachmentId}/content`,
		fileName: "undo-proof.txt",
		sha256: "1".repeat(64),
		mime: "text/plain",
		sizeBytes: attachmentBytes.byteLength,
		uploadedBy: owner.id,
	});
	await db.insert(attachmentBlobs).values({ attachmentId, data: attachmentBytes });

	try {
		const ownerCookie = await login(owner.email);
		const editorCookie = await login(editor.email);
		const denied = await command(editorCookie, "/api/tasks/delete", {
			taskIds: [hubId],
			operationId: "editor-not-participant",
		});
		check("project editor bez účasti nesmí smazat citlivou poradu", denied.status === 403, denied.status);
		check(
			"odmítnutí nezanechá half-delete",
			(await db.select().from(tasks).where(eq(tasks.id, hubId))).length === 1 &&
				(await db.select().from(meetings).where(eq(meetings.id, meetingId))).length === 1,
		);

		const operationId = crypto.randomUUID();
		let response = await command(ownerCookie, "/api/tasks/delete", {
			// Záměrně parent i child: server musí snapshot deduplikovat a obnovit v pořadí.
			taskIds: [childId, hubId],
			operationId,
		});
		const deleted = (await response.json().catch(() => ({}))) as {
			batchId?: string;
			replay?: boolean;
		};
		check("atomický delete uspěl", response.status === 200 && Boolean(deleted.batchId), {
			status: response.status,
			deleted,
		});
		check(
			"hub, child a sidecar zmizely společně",
			(await db.select().from(tasks).where(eq(tasks.id, hubId))).length === 0 &&
				(await db.select().from(tasks).where(eq(tasks.id, childId))).length === 0 &&
				(await db.select().from(meetings).where(eq(meetings.id, meetingId))).length === 0,
		);
		check(
			"podřízená data a lineage nezůstaly jako sirotci",
			(await db.select().from(comments).where(eq(comments.id, commentId))).length === 0 &&
				(await db.select().from(commentDecisions).where(eq(commentDecisions.id, decisionId)))
					.length === 0 &&
				(await db.select().from(mentions).where(eq(mentions.id, mentionId))).length === 0 &&
				(await db.select().from(commentReactions).where(eq(commentReactions.id, reactionId)))
					.length === 0 &&
				(await db.select().from(assignments).where(eq(assignments.id, assignmentId))).length === 0 &&
				(await db.select().from(attachments).where(eq(attachments.id, attachmentId))).length === 0 &&
				(await db.select().from(attachmentBlobs).where(eq(attachmentBlobs.attachmentId, attachmentId)))
					.length === 0 &&
				(await db.select().from(taskActivity).where(eq(taskActivity.id, activityId))).length === 0 &&
				(await db.select().from(entityLinks).where(eq(entityLinks.id, linkId))).length === 0,
		);
		check(
			"samostatný akční bod přežil bez dangling meeting reference",
			(await db.select().from(tasks).where(eq(tasks.id, actionId)))[0]?.meetingId === null,
		);

		response = await command(ownerCookie, "/api/tasks/delete", {
			taskIds: [childId, hubId],
			operationId,
		});
		const replay = (await response.json().catch(() => ({}))) as { replay?: boolean };
		check("exact delete retry je idempotentní", response.status === 200 && replay.replay === true, {
			status: response.status,
			replay,
		});
		response = await command(ownerCookie, "/api/tasks/delete", {
			taskIds: [actionId],
			operationId,
		});
		check("stejné operationId s jiným payloadem končí 409", response.status === 409, response.status);

		response = await command(ownerCookie, "/api/tasks/restore", { batchId: deleted.batchId });
		check("restore command uspěl", response.status === 200, response.status);
		check(
			"restore vrátí celý task strom, meeting i podřízená data",
			(await db.select().from(tasks).where(eq(tasks.id, hubId))).length === 1 &&
				(await db.select().from(tasks).where(eq(tasks.id, childId))).length === 1 &&
				(await db.select().from(meetings).where(eq(meetings.id, meetingId))).length === 1 &&
				(await db.select().from(comments).where(eq(comments.id, commentId))).length === 1 &&
				(await db.select().from(commentDecisions).where(eq(commentDecisions.id, decisionId)))
					.length === 1 &&
				(await db.select().from(mentions).where(eq(mentions.id, mentionId))).length === 1 &&
				(await db.select().from(commentReactions).where(eq(commentReactions.id, reactionId)))
					.length === 1 &&
				(await db.select().from(assignments).where(eq(assignments.id, assignmentId))).length === 1 &&
				(await db.select().from(attachments).where(eq(attachments.id, attachmentId))).length === 1 &&
				new TextDecoder().decode(
					(await db.select().from(attachmentBlobs).where(eq(attachmentBlobs.attachmentId, attachmentId)))[0]
						?.data,
				) === "undo must restore this attachment" &&
				(await db.select().from(taskActivity).where(eq(taskActivity.id, activityId))).length === 1 &&
				(await db.select().from(entityLinks).where(eq(entityLinks.id, linkId))).length === 1 &&
				(await db.select().from(tasks).where(eq(tasks.id, actionId)))[0]?.meetingId === meetingId,
		);
		response = await command(ownerCookie, "/api/tasks/restore", { batchId: deleted.batchId });
		const restoreReplay = (await response.json().catch(() => ({}))) as { replay?: boolean };
		check(
			"exact restore retry nevytvoří duplicity",
			response.status === 200 && restoreReplay.replay === true &&
				(await db.select().from(tasks).where(eq(tasks.id, hubId))).length === 1,
			{ status: response.status, restoreReplay },
		);
		const events = await db
			.select({ action: auditEvents.action, diff: auditEvents.diff })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.entity, "task_delete_batch"),
				),
			);
		check(
			"delete i restore mají workspace-scoped audit",
			events.filter((event) => event.action === "delete").length === 1 &&
				events.filter((event) => event.action === "restore").length === 1,
			events,
		);
		const restoreAudit = events.find((event) => event.action === "restore")?.diff as
			| { rootTaskIds?: unknown }
			| undefined;
		check(
			"restore audit zachová vazbu na obnovený kořen časové osy",
			Array.isArray(restoreAudit?.rootTaskIds) && restoreAudit.rootTaskIds.includes(hubId),
			restoreAudit,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, editor.id));
		await db.delete(users).where(eq(users.id, owner.id));
	}

	if (failed) throw new Error(`${failed} task delete checks failed`);
	console.log("\nTask delete checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
