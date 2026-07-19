/** Integrační kontrakt: rozhodnutí z komentáře, role, tenant scope a audit. */
import "./src/env";
import {
	and,
	auditEvents,
	commentDecisions,
	comments,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.DECISIONS_API ?? "http://127.0.0.1:8790";
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
	const clientId = `comment-decisions-${crypto.randomUUID()}`;
	let operation = 0;
	return (
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
				table: "comment_decisions",
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
	const [editor, commenter] = await db
		.insert(users)
		.values([
			{
				id: crypto.randomUUID(),
				name: "Decision editor",
				email: `decision-editor-${suffix}@watson.test`,
				emailVerified: true,
			},
			{
				id: crypto.randomUUID(),
				name: "Decision commenter",
				email: `decision-commenter-${suffix}@watson.test`,
				emailVerified: true,
			},
		])
		.returning({ id: users.id, email: users.email });
	if (!editor || !commenter) throw new Error("decision users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Decisions ${suffix}`, ownerId: editor.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("decision workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: editor.id, role: "manager" },
		{ workspaceId: workspace.id, userId: commenter.id, role: "member" },
	]);
	const [projectA, projectB] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: editor.id, name: "Decision A" },
			{ workspaceId: workspace.id, ownerId: editor.id, name: "Decision B" },
		])
		.returning({ id: projects.id });
	if (!projectA || !projectB) throw new Error("decision projects missing");
	await db.insert(projectMembers).values([
		{ projectId: projectA.id, userId: editor.id, role: "editor" },
		{ projectId: projectA.id, userId: commenter.id, role: "commenter" },
		{ projectId: projectB.id, userId: editor.id, role: "editor" },
	]);
	const [taskA, taskB] = await db
		.insert(tasks)
		.values([
			{ projectId: projectA.id, name: "Decision task A", createdBy: editor.id },
			{ projectId: projectB.id, name: "Decision task B", createdBy: editor.id },
		])
		.returning({ id: tasks.id });
	if (!taskA || !taskB) throw new Error("decision tasks missing");
	const [commentA, commentB] = await db
		.insert(comments)
		.values([
			{
				taskId: taskA.id,
				projectId: projectA.id,
				authorId: commenter.id,
				body: "Schválili jsme variantu A.",
			},
			{
				taskId: taskB.id,
				projectId: projectB.id,
				authorId: editor.id,
				body: "Cizí projekt.",
			},
		])
		.returning({ id: comments.id });
	if (!commentA || !commentB) throw new Error("decision comments missing");

	try {
		const asEditor = writer(await login(editor.email));
		const asCommenter = writer(await login(commenter.email));
		const deniedId = crypto.randomUUID();
		let response = await asCommenter("PUT", deniedId, {
			comment_id: commentA.id,
			task_id: taskA.id,
			project_id: projectA.id,
		});
		check("commenter nemůže vyhlásit týmové rozhodnutí", response.status === 403, response.status);
		check(
			"odmítnuté rozhodnutí nevzniklo",
			(await db.select().from(commentDecisions).where(eq(commentDecisions.id, deniedId))).length === 0,
		);

		const crossId = crypto.randomUUID();
		response = await asEditor("PUT", crossId, {
			comment_id: commentB.id,
			task_id: taskA.id,
			project_id: projectA.id,
		});
		check("komentář z jiného projektu nelze podstrčit", response.status === 403, response.status);

		const decisionId = crypto.randomUUID();
		response = await asEditor("PUT", decisionId, {
			comment_id: commentA.id,
			task_id: taskA.id,
			// pokus o spoof se musí přepsat projektem tasku
			project_id: projectB.id,
		});
		const stored = (
			await db.select().from(commentDecisions).where(eq(commentDecisions.id, decisionId))
		)[0];
		check("editor může komentář označit jako rozhodnutí", response.status === 200, response.status);
		check(
			"server určil autora a správný projekt",
			stored?.markedBy === editor.id && stored.projectId === projectA.id,
			stored,
		);

		const duplicateId = crypto.randomUUID();
		response = await asEditor("PUT", duplicateId, {
			comment_id: commentA.id,
			task_id: taskA.id,
			project_id: projectA.id,
		});
		check("jeden komentář nemůže mít dvě rozhodnutí", response.status === 409, response.status);

		const previous = {
			comment_id: stored?.commentId,
			task_id: stored?.taskId,
			project_id: stored?.projectId,
		};
		response = await asCommenter("DELETE", decisionId, {}, previous);
		check("commenter nemůže rozhodnutí zrušit", response.status === 403, response.status);
		response = await asEditor("DELETE", decisionId, {}, previous);
		check("editor může rozhodnutí zrušit", response.status === 200, response.status);
		check(
			"rozhodnutí je po zrušení pryč",
			(await db.select().from(commentDecisions).where(eq(commentDecisions.id, decisionId))).length === 0,
		);
		const audits = await db
			.select({ id: auditEvents.id })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.entity, "comment_decisions"),
				),
			);
		check("vytvoření i zrušení má serverový audit", audits.length === 2, audits.length);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, commenter.id));
		await db.delete(users).where(eq(users.id, editor.id));
	}

	if (failed) throw new Error(`${failed} comment decision checks failed`);
	console.log("\nComment decision checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
