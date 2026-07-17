/** F6 integrační kontrakt kanonického Decision Logu proti reálnému API a PostgreSQL. */
import "./src/env";
import {
	and,
	auditEvents,
	commentDecisions,
	comments,
	decisionTaskLinks,
	decisions,
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

const API = process.env.DECISION_LOG_API ?? "http://127.0.0.1:8790";
const WEB_ORIGIN = process.env.DECISION_LOG_ORIGIN ?? "http://localhost:5173";
const db = getDb();
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
}

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
		body: JSON.stringify({ email, callbackURL: `${WEB_ORIGIN}/` }),
	});
	if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=${encodeURIComponent(`${WEB_ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const raw =
		verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error(`login ${email}: missing cookie`);
	return cookie;
}

async function request(cookie: string, path: string, method = "GET", body?: unknown) {
	return fetch(`${API}${path}`, {
		method,
		headers: {
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
			Origin: WEB_ORIGIN,
			Cookie: cookie,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const makeUser = async (slug: string) => {
		const [row] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `Decision Log ${slug}`,
				email: `decision-log-${slug}-${stamp}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		if (!row) throw new Error(`user ${slug} missing`);
		return row;
	};
	const editor = await makeUser("editor");
	const commenter = await makeUser("commenter");
	const outsider = await makeUser("outsider");
	const [workspace, otherWorkspace] = await db
		.insert(workspaces)
		.values([
			{ name: `Decision Log ${stamp}`, ownerId: editor.id, isPersonal: false },
			{ name: `Decision Log other ${stamp}`, ownerId: outsider.id, isPersonal: false },
		])
		.returning({ id: workspaces.id });
	if (!workspace || !otherWorkspace) throw new Error("workspaces missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: editor.id, role: "manager" },
		{ workspaceId: workspace.id, userId: commenter.id, role: "member" },
		{ workspaceId: workspace.id, userId: outsider.id, role: "member" },
		{ workspaceId: otherWorkspace.id, userId: outsider.id, role: "admin" },
	]);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: editor.id, name: "Decision project" },
			{ workspaceId: otherWorkspace.id, ownerId: outsider.id, name: "Other decision project" },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: project.id, userId: commenter.id, role: "commenter" },
		{ projectId: otherProject.id, userId: outsider.id, role: "manager" },
	]);
	const [task, otherTask] = await db
		.insert(tasks)
		.values([
			{ projectId: project.id, name: "Decision task", createdBy: editor.id },
			{ projectId: otherProject.id, name: "Other decision task", createdBy: outsider.id },
		])
		.returning({ id: tasks.id });
	if (!task || !otherTask) throw new Error("tasks missing");
	const [comment] = await db
		.insert(comments)
		.values({
			taskId: task.id,
			projectId: project.id,
			authorId: commenter.id,
			body: "Schvalujeme bezpečnou variantu Atlas.",
		})
		.returning({ id: comments.id });
	if (!comment) throw new Error("comment missing");

	try {
		const editorCookie = await login(editor.email);
		const commenterCookie = await login(commenter.email);
		const outsiderCookie = await login(outsider.email);

		const commentDecisionId = crypto.randomUUID();
		await db.insert(commentDecisions).values({
			id: commentDecisionId,
			commentId: comment.id,
			taskId: task.id,
			projectId: project.id,
			markedBy: editor.id,
		});
		let canonical = (
			await db.select().from(decisions).where(eq(decisions.sourceObjectId, commentDecisionId))
		)[0];
		check(
			"označený komentář atomicky vytvoří kanonický snapshot a task vazbu",
			canonical?.id === commentDecisionId &&
				canonical.title === "Schvalujeme bezpečnou variantu Atlas." &&
				(
					await db
						.select()
						.from(decisionTaskLinks)
						.where(eq(decisionTaskLinks.decisionId, commentDecisionId))
				).length === 1,
			canonical,
		);
		await db
			.update(comments)
			.set({ body: "Později změněný komentář" })
			.where(eq(comments.id, comment.id));
		canonical = (await db.select().from(decisions).where(eq(decisions.id, commentDecisionId)))[0];
		check(
			"snapshot rozhodnutí se změnou komentáře nepřepíše",
			canonical?.title.includes("Atlas") === true,
		);

		const secretRationale = `Citlivé odůvodnění ${crypto.randomUUID()}`;
		const manualId = crypto.randomUUID();
		const createOperation = crypto.randomUUID();
		const createBody = {
			id: manualId,
			operationId: createOperation,
			projectId: project.id,
			title: "Rozhodnutí Orbis",
			rationale: secretRationale,
			ownerUserId: commenter.id,
			relatedTaskIds: [task.id, task.id],
		};
		let response = await request(editorCookie, "/api/decisions", "POST", createBody);
		check("editor vytvoří ruční rozhodnutí", response.status === 201, await response.text());
		response = await request(editorCookie, "/api/decisions", "POST", createBody);
		const replay = (await response.json().catch(() => ({}))) as { replayed?: boolean };
		check(
			"stejný operation je přesný replay bez duplicity",
			response.status === 200 && replay.replayed === true,
			replay,
		);
		response = await request(editorCookie, "/api/decisions", "POST", {
			...createBody,
			id: crypto.randomUUID(),
			title: "Jiný payload",
		});
		check("operation ID s jiným payloadem je odmítnut", response.status === 409, response.status);
		response = await request(commenterCookie, "/api/decisions", "POST", {
			...createBody,
			id: crypto.randomUUID(),
			operationId: crypto.randomUUID(),
		});
		check("commenter nemůže zapisovat do Decision Logu", response.status === 404, response.status);
		response = await request(editorCookie, "/api/decisions", "POST", {
			...createBody,
			id: crypto.randomUUID(),
			operationId: crypto.randomUUID(),
			relatedTaskIds: [otherTask.id],
		});
		check("task z cizího projektu nelze připojit", response.status === 422, response.status);
		response = await request(editorCookie, "/api/decisions", "POST", {
			...createBody,
			id: crypto.randomUUID(),
			operationId: crypto.randomUUID(),
			ownerUserId: outsider.id,
		});
		check("vlastník rozhodnutí musí být člen projektu", response.status === 422, response.status);

		response = await request(editorCookie, `/api/decisions?workspaceId=${workspace.id}&q=Orbis`);
		const list = (await response.json().catch(() => ({}))) as {
			decisions?: Array<{ id: string; ownerName: string; relatedTasks: unknown[] }>;
		};
		check(
			"vyhledání vrátí obohacený read model bez duplicitních task vazeb",
			response.status === 200 &&
				list.decisions?.length === 1 &&
				list.decisions[0]?.ownerName === "Decision Log commenter" &&
				list.decisions[0]?.relatedTasks.length === 1,
			list,
		);
		response = await request(editorCookie, `/api/decisions?workspaceId=${workspace.id}&limit=1`);
		const firstPage = (await response.json().catch(() => ({}))) as {
			decisions?: Array<{ id: string }>;
			nextCursor?: string | null;
		};
		const firstId = firstPage.decisions?.[0]?.id;
		response = await request(
			editorCookie,
			`/api/decisions?workspaceId=${workspace.id}&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
		);
		const secondPage = (await response.json().catch(() => ({}))) as {
			decisions?: Array<{ id: string }>;
		};
		check(
			"cursor stránkuje stabilně bez opakování řádku",
			Boolean(firstPage.nextCursor) &&
				response.status === 200 &&
				Boolean(firstId) &&
				secondPage.decisions?.[0]?.id !== firstId,
			{ firstPage, secondPage },
		);
		response = await request(
			editorCookie,
			`/api/decisions?workspaceId=${workspace.id}&cursor=poškozený`,
		);
		check("poškozený cursor je odmítnut", response.status === 422, response.status);
		response = await request(outsiderCookie, `/api/decisions?workspaceId=${workspace.id}`);
		const outsiderList = (await response.json().catch(() => ({}))) as { decisions?: unknown[] };
		check(
			"člen workspace bez členství v projektu nevidí jeho rozhodnutí",
			response.status === 200 && outsiderList.decisions?.length === 0,
			outsiderList,
		);

		response = await request(editorCookie, `/api/decisions/${manualId}`, "PATCH", {
			operationId: crypto.randomUUID(),
			expectedVersion: 9,
			reviewAt: "2026-09-01T09:00:00.000Z",
		});
		check("stará verze revize je odmítnuta", response.status === 409, response.status);
		const reviewOperation = crypto.randomUUID();
		const reviewBody = {
			operationId: reviewOperation,
			expectedVersion: 1,
			reviewAt: "2026-09-01T09:00:00.000Z",
			effectiveAt: "2026-08-01T09:00:00.000Z",
		};
		response = await request(editorCookie, `/api/decisions/${manualId}`, "PATCH", reviewBody);
		const reviewed = (await response.json().catch(() => ({}))) as { version?: number };
		check(
			"CAS revize zvýší přesně verzi",
			response.status === 200 && reviewed.version === 2,
			reviewed,
		);
		response = await request(editorCookie, `/api/decisions/${manualId}`, "PATCH", reviewBody);
		const reviewReplay = (await response.json().catch(() => ({}))) as { replayed?: boolean };
		check(
			"retry revize je idempotentní",
			response.status === 200 && reviewReplay.replayed === true,
			reviewReplay,
		);

		const priorId = crypto.randomUUID();
		response = await request(editorCookie, "/api/decisions", "POST", {
			id: priorId,
			operationId: crypto.randomUUID(),
			projectId: project.id,
			title: "Původní směr",
		});
		check("setup nahrazovaného rozhodnutí uspěje", response.status === 201, response.status);
		const supersede = (title: string) =>
			request(editorCookie, "/api/decisions", "POST", {
				id: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
				projectId: project.id,
				title,
				supersedesId: priorId,
			});
		const concurrent = await Promise.all([supersede("Nový směr A"), supersede("Nový směr B")]);
		check(
			"souběžné nahrazení dovolí právě jednoho vítěze",
			concurrent
				.map((item) => item.status)
				.sort()
				.join(",") === "201,409",
			concurrent.map((item) => item.status),
		);
		const prior = (await db.select().from(decisions).where(eq(decisions.id, priorId)))[0];
		check("původní rozhodnutí je terminálně superseded", prior?.status === "superseded", prior);

		const meetingId = crypto.randomUUID();
		await db.insert(meetings).values({
			id: meetingId,
			workspaceId: workspace.id,
			title: "Porada bez nahrávání",
			transcript: "Vložený holý přepis",
			status: "extracted",
			createdBy: editor.id,
		});
		response = await request(editorCookie, `/api/meetings/${meetingId}/commit`, "POST", {
			defaultProjectId: project.id,
			proposals: [
				{
					title: "Rozhodli jsme o variantě C",
					note: "Platí od srpna",
					kind: "decision",
					keep: true,
				},
			],
		});
		const meetingCommit = (await response.json().catch(() => ({}))) as { decisionIds?: string[] };
		const meetingDecision = (
			await db.select().from(decisions).where(eq(decisions.sourceObjectId, meetingId))
		)[0];
		check(
			"detached porada materializuje schválené rozhodnutí bez hub tasku",
			response.status === 200 &&
				meetingCommit.decisionIds?.[0] === meetingDecision?.id &&
				meetingDecision?.projectId === project.id,
			{ status: response.status, body: meetingCommit, meetingDecision },
		);

		let dbGuarded = false;
		try {
			await db.insert(decisions).values({
				id: crypto.randomUUID(),
				workspaceId: otherWorkspace.id,
				projectId: project.id,
				sourceType: "manual",
				sourceKey: "manual",
				title: "Nesmí projít",
				createdBy: editor.id,
			});
		} catch (error) {
			const code =
				(error as { code?: string; cause?: { code?: string } }).code ??
				(error as { cause?: { code?: string } }).cause?.code;
			dbGuarded = code === "23514";
		}
		check("DB trigger odmítne cross-workspace podvrh", dbGuarded);

		await db.delete(commentDecisions).where(eq(commentDecisions.id, commentDecisionId));
		canonical = (await db.select().from(decisions).where(eq(decisions.id, commentDecisionId)))[0];
		check(
			"zrušené označení je historicky dohledatelné a task vazba zůstane",
			canonical?.status === "withdrawn" &&
				(
					await db
						.select()
						.from(decisionTaskLinks)
						.where(eq(decisionTaskLinks.decisionId, commentDecisionId))
				).length === 1,
			canonical,
		);
		response = await request(
			editorCookie,
			`/api/decisions?workspaceId=${workspace.id}&status=withdrawn`,
		);
		const withdrawn = (await response.json().catch(() => ({}))) as {
			decisions?: Array<{ id: string; sourceExists: boolean; sourceTaskId: string | null }>;
		};
		const withdrawnComment = withdrawn.decisions?.find((row) => row.id === commentDecisionId);
		check(
			"historický komentářový snapshot zachová deep-link na úkol i po odznačení",
			response.status === 200 &&
				withdrawnComment?.sourceExists === false &&
				withdrawnComment.sourceTaskId === task.id,
			withdrawnComment,
		);

		const linksBeforeDelete = await db
			.select()
			.from(decisionTaskLinks)
			.where(eq(decisionTaskLinks.taskId, task.id));
		response = await request(editorCookie, "/api/tasks/delete", "POST", {
			taskIds: [task.id],
			operationId: crypto.randomUUID(),
		});
		const deleted = (await response.json().catch(() => ({}))) as { batchId?: string };
		const linksAfterDelete = await db
			.select()
			.from(decisionTaskLinks)
			.where(eq(decisionTaskLinks.taskId, task.id));
		check(
			"delete úkolu odstraní jen vazby, ne historická rozhodnutí",
			response.status === 200 && linksBeforeDelete.length === 2 && linksAfterDelete.length === 0,
			{ status: response.status, before: linksBeforeDelete.length, after: linksAfterDelete.length },
		);
		response = await request(editorCookie, "/api/tasks/restore", "POST", {
			batchId: deleted.batchId,
		});
		const linksAfterRestore = await db
			.select()
			.from(decisionTaskLinks)
			.where(eq(decisionTaskLinks.taskId, task.id));
		check(
			"Undo úkolu obnoví ruční i historickou decision vazbu",
			response.status === 200 && linksAfterRestore.length === linksBeforeDelete.length,
			{ status: response.status, restored: linksAfterRestore.length },
		);

		const auditRows = await db
			.select({ diff: auditEvents.diff })
			.from(auditEvents)
			.where(and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.entity, "decisions")));
		check(
			"audit ukládá metadata, ne obsah rozhodnutí ani odůvodnění",
			!JSON.stringify(auditRows).includes(secretRationale) &&
				!JSON.stringify(auditRows).includes("Rozhodnutí Orbis"),
			auditRows,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
		await db.delete(users).where(eq(users.id, commenter.id));
		await db.delete(users).where(eq(users.id, outsider.id));
		await db.delete(users).where(eq(users.id, editor.id));
	}

	if (failed) throw new Error(`${failed} Decision Log checks failed`);
	console.log("\nDecision Log checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
