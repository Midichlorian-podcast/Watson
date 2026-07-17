/** F6 — end-to-end contract Rules & Automation Engine. */
import "./src/env";
import {
	auditEvents,
	automationRuleVersions,
	automationRules,
	automationRuns,
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
import { runAutomationCycleOnce } from "./src/automation";

const API = process.env.AUTOMATION_API ?? "http://127.0.0.1:8790";
const WEB_ORIGIN = process.env.AUTOMATION_ORIGIN ?? "http://localhost:5173";
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
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
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
		headers: { Origin: WEB_ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const makeUser = async (slug: string) => {
		const [row] = await db.insert(users).values({
			id: crypto.randomUUID(),
			name: `Automation ${slug}`,
			email: `automation-${slug}-${stamp}@watson.test`,
			emailVerified: true,
		}).returning({ id: users.id, email: users.email });
		if (!row) throw new Error(`user ${slug} missing`);
		return row;
	};
	const manager = await makeUser("manager");
	const editor = await makeUser("editor");
	const outsider = await makeUser("outsider");
	const [workspace, otherWorkspace] = await db.insert(workspaces).values([
		{ name: `Automation ${stamp}`, ownerId: manager.id, isPersonal: false },
		{ name: `Automation other ${stamp}`, ownerId: outsider.id, isPersonal: false },
	]).returning({ id: workspaces.id });
	if (!workspace || !otherWorkspace) throw new Error("workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: editor.id, role: "member" },
		{ workspaceId: otherWorkspace.id, userId: outsider.id, role: "admin" },
	]);
	const [project, otherProject] = await db.insert(projects).values([
		{ workspaceId: workspace.id, ownerId: manager.id, name: "Automation delivery" },
		{ workspaceId: otherWorkspace.id, ownerId: outsider.id, name: "Other scope" },
	]).returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("project missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: otherProject.id, userId: outsider.id, role: "manager" },
	]);
	const [task, mismatchTask, pausedTask] = await db.insert(tasks).values([
		{ projectId: project.id, name: "Publish campaign", priority: 2, createdBy: editor.id },
		{ projectId: project.id, name: "Mismatch campaign", priority: 3, createdBy: editor.id },
		{ projectId: project.id, name: "Paused campaign", priority: 2, createdBy: editor.id },
	]).returning({ id: tasks.id });
	if (!task || !mismatchTask || !pausedTask) throw new Error("task missing");

	const ruleId = crypto.randomUUID();
	const createOperation = crypto.randomUUID();
	const config = {
		timezone: "UTC",
		trigger: { type: "task_completed" as const },
		conditions: [{ field: "priority" as const, operator: "equals" as const, value: 2 }],
		actions: [
			{ type: "set_priority" as const, value: 1 },
			{ type: "set_due_offset" as const, days: 2, overwrite: false },
			{ type: "add_comment" as const, body: "Automaticky: připravte závěrečný report." },
		],
	};

	try {
		const managerCookie = await login(manager.email);
		const editorCookie = await login(editor.email);
		const createBody = {
			id: ruleId,
			projectId: project.id,
			name: "Po dokončení připrav report",
			description: "Ověřená automatizace",
			config,
			operationId: createOperation,
		};
		const created = await request(managerCookie, "/api/automation/rules", "POST", createBody);
		check("manager vytvoří pouze draft", created.status === 201, await created.text());
		const replay = await request(managerCookie, "/api/automation/rules", "POST", createBody);
		const replayJson = await replay.json() as { replay?: boolean };
		check("create retry je idempotentní", replay.status === 200 && replayJson.replay === true, replayJson);
		const reused = await request(managerCookie, "/api/automation/rules", "POST", { ...createBody, name: "Jiný payload" });
		check("stejné operation ID s jiným payloadem je konflikt", reused.status === 409);
		const denied = await request(editorCookie, "/api/automation/rules", "POST", { ...createBody, id: crypto.randomUUID(), operationId: crypto.randomUUID() });
		check("editor nemůže založit pravidlo s hromadným dopadem", denied.status === 403);

		const listed = await request(editorCookie, `/api/automation/rules?workspaceId=${workspace.id}`);
		const listedJson = await listed.json() as { rules?: Array<{ id: string; can_manage: boolean }> };
		check("projektový člen pravidlo vidí, ale nemůže jej spravovat", listed.status === 200 && listed.headers.get("cache-control")?.includes("no-store") === true && listedJson.rules?.some((rule) => rule.id === ruleId && rule.can_manage === false) === true, listedJson);

		const preview = await request(managerCookie, `/api/automation/rules/${ruleId}/preview`, "POST", { taskId: task.id });
		const previewJson = await preview.json() as { matched?: boolean; changes?: unknown[]; warning?: string };
		const taskBefore = await db.select({ priority: tasks.priority, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, task.id));
		check("preview vysvětlí tři změny, ale nic nezapíše", preview.status === 200 && previewJson.matched === true && previewJson.changes?.length === 3 && previewJson.warning?.includes("nic nezměnil") === true && taskBefore[0]?.priority === 2 && taskBefore[0]?.dueDate == null, previewJson);

		const publishOperation = crypto.randomUUID();
		const published = await request(managerCookie, `/api/automation/rules/${ruleId}/publish`, "POST", { expectedRevision: 1, operationId: publishOperation });
		const publishedJson = await published.json() as { version?: number; versionId?: string; replay?: boolean };
		check("Draft → Publish vytvoří verzi 1", published.status === 200 && publishedJson.version === 1 && publishedJson.replay === false, publishedJson);
		const publishReplay = await request(managerCookie, `/api/automation/rules/${ruleId}/publish`, "POST", { expectedRevision: 1, operationId: publishOperation });
		check("publish retry nevytvoří novou verzi", publishReplay.status === 200 && (await publishReplay.json() as { replay?: boolean }).replay === true);
		const concurrentStyleReplay = await request(managerCookie, `/api/automation/rules/${ruleId}/publish`, "POST", { expectedRevision: 1, operationId: crypto.randomUUID() });
		const concurrentStyleReplayJson = await concurrentStyleReplay.json() as { replay?: boolean; error?: string };
		check("stejná draft revize se ani s jiným operation ID nepublikuje dvakrát", concurrentStyleReplay.status === 200 && concurrentStyleReplayJson.replay === true, { status: concurrentStyleReplay.status, body: concurrentStyleReplayJson });

		const changedDraft = await request(managerCookie, `/api/automation/rules/${ruleId}`, "PATCH", {
			name: "Po dokončení připrav report",
			description: "Draft verze 2",
			config: { ...config, actions: [{ type: "set_priority", value: 4 }] },
			expectedRevision: 1,
		});
		check("editace po publikaci mění jen draft", changedDraft.status === 200);
		const versionsBefore = await db.select().from(automationRuleVersions).where(eq(automationRuleVersions.ruleId, ruleId));
		check("publikovaný snapshot zůstává připnutý na původní akce", versionsBefore.length === 1 && versionsBefore[0]?.config.actions.length === 3 && versionsBefore[0]?.config.actions[0]?.type === "set_priority" && versionsBefore[0]?.config.actions[0]?.value === 1, versionsBefore);

		let immutable = false;
		try {
			await db.execute(sql`UPDATE automation_rule_versions SET version = 9 WHERE rule_id = ${ruleId}`);
		} catch {
			immutable = true;
		}
		check("publikovanou verzi odmítá měnit i databáze", immutable);

		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, task.id));
		const [event] = await db.insert(auditEvents).values({
			workspaceId: workspace.id,
			actorUserId: editor.id,
			entity: "tasks",
			entityId: task.id,
			action: "patch",
			before: { completed_at: null },
			diff: { completed_at: new Date().toISOString() },
		}).returning({ id: auditEvents.id });
		if (!event) throw new Error("event missing");
		await runAutomationCycleOnce();
		const appliedTask = await db.select({ priority: tasks.priority, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, task.id));
		const appliedComments = await db.select().from(comments).where(eq(comments.taskId, task.id));
		const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, event.id));
		check("publikovaná verze atomicky provede všechny akce", appliedTask[0]?.priority === 1 && appliedTask[0]?.dueDate != null && appliedComments.length === 1 && run?.status === "succeeded" && run.result?.changes.length === 3, { appliedTask, appliedComments: appliedComments.length, run });
		check("běh je připnutý na verzi 1, ne na novější draft", run?.ruleVersionId === publishedJson.versionId);
		await runAutomationCycleOnce();
		const duplicateRuns = await db.select().from(automationRuns).where(eq(automationRuns.eventId, event.id));
		check("opakovaný dispatcher nevytvoří duplicitní běh", duplicateRuns.length === 1);
		const systemAudit = (await db.execute(sql`
			SELECT actor_type, diff FROM audit_events WHERE entity = 'tasks' AND entity_id = ${task.id} AND action = 'automation_apply'
		`)) as unknown as Array<{ actor_type: string; diff: Record<string, unknown> }>;
		check("automatický zápis má systémový, redigovaný audit", systemAudit.length === 1 && systemAudit[0]?.actor_type === "system" && !JSON.stringify(systemAudit).includes("závěrečný report"), systemAudit);

		if (!run) throw new Error("run missing");
		const undone = await request(managerCookie, `/api/automation/runs/${run.id}/undo`, "POST", { operationId: crypto.randomUUID() });
		const afterUndo = await db.select({ priority: tasks.priority, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, task.id));
		const commentsAfterUndo = await db.select().from(comments).where(eq(comments.taskId, task.id));
		check("Undo vrátí přesný stav a odstraní jen nezměněný komentář", undone.status === 200 && afterUndo[0]?.priority === 2 && afterUndo[0]?.dueDate == null && commentsAfterUndo.length === 0);
		const undoReplay = await request(managerCookie, `/api/automation/runs/${run.id}/undo`, "POST", { operationId: crypto.randomUUID() });
		check("Undo retry je idempotentní", undoReplay.status === 200 && (await undoReplay.json() as { replay?: boolean }).replay === true);

		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, mismatchTask.id));
		const [mismatchEvent] = await db.insert(auditEvents).values({
			workspaceId: workspace.id,
			actorUserId: editor.id,
			entity: "tasks",
			entityId: mismatchTask.id,
			action: "patch",
			before: { completed_at: null },
			diff: { completed_at: new Date().toISOString() },
		}).returning({ id: auditEvents.id });
		await runAutomationCycleOnce();
		const mismatchRun = mismatchEvent ? await db.select().from(automationRuns).where(eq(automationRuns.eventId, mismatchEvent.id)) : [];
		check("nesplněná podmínka je viditelně skipped a nic nemění", mismatchRun[0]?.status === "skipped" && mismatchRun[0]?.errorCode === "conditions_not_met" && (await db.select({ priority: tasks.priority }).from(tasks).where(eq(tasks.id, mismatchTask.id)))[0]?.priority === 3, mismatchRun);

		const paused = await request(managerCookie, `/api/automation/rules/${ruleId}/state`, "POST", { state: "paused", operationId: crypto.randomUUID() });
		check("manager může pravidlo pozastavit", paused.status === 200);
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, pausedTask.id));
		const [pausedEvent] = await db.insert(auditEvents).values({
			workspaceId: workspace.id,
			actorUserId: editor.id,
			entity: "tasks",
			entityId: pausedTask.id,
			action: "patch",
			before: { completed_at: null },
			diff: { completed_at: new Date().toISOString() },
		}).returning({ id: auditEvents.id });
		await runAutomationCycleOnce();
		const pausedRuns = pausedEvent ? await db.select().from(automationRuns).where(eq(automationRuns.eventId, pausedEvent.id)) : [];
		check("pozastavené pravidlo nové běhy vůbec nefrontuje", pausedRuns.length === 0);

		let crossScope = false;
		try {
			await db.insert(automationRules).values({
				workspaceId: workspace.id,
				projectId: otherProject.id,
				name: "Cross scope",
				draftConfig: config,
				createdBy: manager.id,
				createOperationId: crypto.randomUUID(),
				createRequestHash: "a".repeat(64),
			});
		} catch {
			crossScope = true;
		}
		check("DB odmítá cross-workspace pravidlo", crossScope);
		let invalidTransition = false;
		try {
			await db.execute(sql`UPDATE automation_runs SET status = 'succeeded' WHERE id = ${run.id}`);
		} catch {
			invalidTransition = true;
		}
		check("DB odmítá návrat terminálního běhu do staršího stavu", invalidTransition);

		const detail = await request(managerCookie, `/api/automation/rules/${ruleId}`);
		const detailJson = await detail.json() as { rule?: Record<string, unknown>; versions?: unknown[]; runs?: unknown[] };
		check("detail vrací verzovanou historii a procesní běhy", detail.status === 200 && detail.headers.get("cache-control")?.includes("no-store") === true && detailJson.versions?.length === 1 && (detailJson.runs?.length ?? 0) >= 2, detailJson);
		check("detail neodhaluje interní idempotency údaje", detailJson.rule?.create_operation_id == null && detailJson.rule?.create_request_hash == null, detailJson.rule);

		await db.transaction(async (tx) => {
			await tx.update(automationRules).set({ state: "enabled" }).where(eq(automationRules.id, ruleId));
			await tx.update(projectMembers).set({ role: "manager" }).where(sql`${projectMembers.projectId} = ${project.id} AND ${projectMembers.userId} = ${editor.id}`);
			await tx.delete(projectMembers).where(sql`${projectMembers.projectId} = ${project.id} AND ${projectMembers.userId} = ${manager.id}`);
		});
		await runAutomationCycleOnce();
		const revokedRun = pausedEvent ? await db.select().from(automationRuns).where(eq(automationRuns.eventId, pausedEvent.id)) : [];
		const pausedTaskAfterRevoke = await db.select({ priority: tasks.priority }).from(tasks).where(eq(tasks.id, pausedTask.id));
		check("worker znovu ověří oprávnění autora a po odebrání nic nezmění", revokedRun[0]?.status === "failed" && revokedRun[0]?.errorCode === "publisher_permission_revoked" && pausedTaskAfterRevoke[0]?.priority === 2, { revokedRun, pausedTaskAfterRevoke });
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
	}

	if (failed) throw new Error(`${failed} automation checks failed`);
	console.log("\nRules & Automation Engine: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
