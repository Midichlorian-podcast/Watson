/** Integrační důkaz: vlákna, stabilní @zmínky, reakce, role a tenant integrita. */
import "./src/env";
import {
	and,
	auditEvents,
	commentReactions,
	comments,
	eq,
	getDb,
	memberships,
	mentions,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { sqlstateOf } from "./src/powersync";

const API = process.env.COMMENT_COLLAB_API ?? "http://127.0.0.1:8790";
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
	const clientId = `comment-collab-${crypto.randomUUID()}`;
	let operation = 0;
	return (
		table: "comments" | "mentions" | "comment_reactions",
		op: "PUT" | "DELETE",
		id: string,
		data: Record<string, unknown> = {},
		previous?: Record<string, unknown>,
	) =>
		fetch(`${API}/api/sync/write`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:5173",
				Cookie: cookie,
			},
			body: JSON.stringify({
				op,
				table,
				id,
				data,
				previous,
				clientId,
				operationId: String(++operation),
			}),
		});
};

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [editor, commenter, outsider] = await db
		.insert(users)
		.values([
			{ id: crypto.randomUUID(), name: "Collab editor", email: `collab-editor-${suffix}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Collab commenter", email: `collab-commenter-${suffix}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Collab outsider", email: `collab-outsider-${suffix}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	if (!editor || !commenter || !outsider) throw new Error("collaboration users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Collaboration ${suffix}`, ownerId: editor.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("collaboration workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: editor.id, role: "manager" },
		{ workspaceId: workspace.id, userId: commenter.id, role: "member" },
		{ workspaceId: workspace.id, userId: outsider.id, role: "member" },
	]);
	const [projectA, projectB] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: editor.id, name: "Collaboration A" },
			{ workspaceId: workspace.id, ownerId: editor.id, name: "Collaboration B" },
		])
		.returning({ id: projects.id });
	if (!projectA || !projectB) throw new Error("collaboration projects missing");
	await db.insert(projectMembers).values([
		{ projectId: projectA.id, userId: editor.id, role: "editor" },
		{ projectId: projectA.id, userId: commenter.id, role: "commenter" },
		{ projectId: projectB.id, userId: editor.id, role: "editor" },
	]);
	const [taskA, taskB] = await db
		.insert(tasks)
		.values([
			{ projectId: projectA.id, name: "Thread A", createdBy: editor.id },
			{ projectId: projectB.id, name: "Thread B", createdBy: editor.id },
		])
		.returning({ id: tasks.id });
	if (!taskA || !taskB) throw new Error("collaboration tasks missing");

	try {
		const asEditor = writer(await login(editor.email));
		const asCommenter = writer(await login(commenter.email));
		const asOutsider = writer(await login(outsider.email));
		const rootId = crypto.randomUUID();
		let response = await asCommenter("comments", "PUT", rootId, {
			task_id: taskA.id,
			project_id: projectB.id,
			parent_id: null,
			body: "@Collab editor Prosím potvrď variantu A.",
		});
		let root = (await db.select().from(comments).where(eq(comments.id, rootId)))[0];
		check("commenter založí kořen komentářového vlákna", response.status === 200, response.status);
		check("server opravil project scope a autora komentáře", root?.projectId === projectA.id && root.authorId === commenter.id, root);

		const replyId = crypto.randomUUID();
		response = await asEditor("comments", "PUT", replyId, {
			task_id: taskA.id,
			project_id: projectA.id,
			parent_id: rootId,
			body: "Potvrzeno, pokračuj.",
		});
		check("editor odpoví ve vlákně", response.status === 200, response.status);
		check("odpověď drží parent vazbu", (await db.select().from(comments).where(eq(comments.id, replyId)))[0]?.parentId === rootId);

		const foreignRootId = crypto.randomUUID();
		await db.insert(comments).values({ taskId: taskB.id, projectId: projectB.id, authorId: editor.id, body: "Foreign", id: foreignRootId });
		response = await asCommenter("comments", "PUT", crypto.randomUUID(), {
			task_id: taskA.id,
			project_id: projectA.id,
			parent_id: foreignRootId,
			body: "Cross-project reply",
		});
		check("vlákno nelze propojit napříč projekty", response.status === 403, response.status);

		const mentionId = crypto.randomUUID();
		response = await asCommenter("mentions", "PUT", mentionId, {
			comment_id: rootId,
			task_id: taskA.id,
			project_id: projectB.id,
			user_id: editor.id,
			created_by: outsider.id,
		});
		const mention = (await db.select().from(mentions).where(eq(mentions.id, mentionId)))[0];
		check("stabilní zmínka člena projektu vznikne", response.status === 200, response.status);
		check("server odvodil tenant i autora zmínky", mention?.projectId === projectA.id && mention.createdBy === commenter.id, mention);
		response = await asCommenter("mentions", "PUT", crypto.randomUUID(), {
			comment_id: rootId,
			task_id: taskA.id,
			project_id: projectA.id,
			user_id: outsider.id,
		});
		check("nelze zmínit člověka mimo projekt", response.status === 403, response.status);

		const reactionId = crypto.randomUUID();
		response = await asEditor("comment_reactions", "PUT", reactionId, {
			comment_id: rootId,
			task_id: taskA.id,
			project_id: projectA.id,
			user_id: commenter.id,
			emoji: "👍",
		});
		const reaction = (await db.select().from(commentReactions).where(eq(commentReactions.id, reactionId)))[0];
		check("člen přidá reakci", response.status === 200, response.status);
		check("reakci nelze připsat jiné osobě", reaction?.userId === editor.id, reaction);
		response = await asEditor("comment_reactions", "PUT", crypto.randomUUID(), {
			comment_id: rootId,
			task_id: taskA.id,
			project_id: projectA.id,
			emoji: "👍",
		});
		check("stejnou reakci nelze zdvojit", response.status === 409, response.status);
		response = await asEditor("comment_reactions", "PUT", crypto.randomUUID(), {
			comment_id: rootId,
			task_id: taskA.id,
			project_id: projectA.id,
			emoji: "💣",
		});
		check("nepodporované emoji odmítne DB policy", response.status === 422, response.status);

		const reactionPrevious = {
			comment_id: rootId,
			task_id: taskA.id,
			project_id: projectA.id,
			user_id: editor.id,
			emoji: "👍",
		};
		response = await asCommenter("comment_reactions", "DELETE", reactionId, {}, reactionPrevious);
		check("cizí reakci nelze odebrat", response.status === 403, response.status);
		response = await asEditor("comment_reactions", "DELETE", reactionId, {}, reactionPrevious);
		check("autor reakci odebere", response.status === 200, response.status);

		response = await asOutsider("comments", "PUT", crypto.randomUUID(), {
			task_id: taskA.id,
			project_id: projectA.id,
			parent_id: null,
			body: "I should not see this task",
		});
		check("uživatel mimo restricted projekt komentář nevloží", response.status === 403, response.status);
		response = await asCommenter("comments", "PUT", crypto.randomUUID(), {
			task_id: taskA.id,
			project_id: projectA.id,
			parent_id: null,
			body: "x".repeat(10_001),
		});
		check("příliš dlouhý komentář je řízeně odmítnut", response.status === 422, response.status);

		let crossCode: string | null = null;
		try {
			await db.insert(commentReactions).values({
				commentId: foreignRootId,
				taskId: taskA.id,
				projectId: projectA.id,
				userId: editor.id,
				emoji: "👀",
			});
		} catch (error) {
			crossCode = sqlstateOf(error);
		}
		check("DB vynutí comment/task/project integritu i mimo API", crossCode === "23503", crossCode);

		root = (await db.select().from(comments).where(eq(comments.id, rootId)))[0];
		response = await asCommenter(
			"comments",
			"DELETE",
			rootId,
			{},
			{
				task_id: taskA.id,
				project_id: projectA.id,
				parent_id: null,
				body: root?.body,
			},
		);
		check("autor smaže vlastní kořen vlákna", response.status === 200, response.status);
		check(
			"smazání kořene atomicky uklidí odpovědi, zmínky i reakce",
			(await db.select().from(comments).where(eq(comments.id, replyId))).length === 0 &&
				(await db.select().from(mentions).where(eq(mentions.id, mentionId))).length === 0 &&
				(await db.select().from(commentReactions).where(eq(commentReactions.commentId, rootId))).length === 0,
		);

		const audits = await db
			.select({ entity: auditEvents.entity, action: auditEvents.action })
			.from(auditEvents)
			.where(and(eq(auditEvents.workspaceId, workspace.id)));
		check(
			"komentáře, zmínky a reakce mají autoritativní audit",
			["comments", "mentions", "comment_reactions"].every((entity) => audits.some((event) => event.entity === entity)),
			audits,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, outsider.id));
		await db.delete(users).where(eq(users.id, commenter.id));
		await db.delete(users).where(eq(users.id, editor.id));
	}

	if (failed) throw new Error(`${failed} comment collaboration checks failed`);
	console.log("\nComment collaboration checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
