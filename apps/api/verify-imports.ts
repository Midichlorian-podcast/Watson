/** Import wizard: dry-run, atomický import, idempotence, soubory, delete/undo a rollback. */
import "./src/env";
import {
	and,
	attachments,
	auditEvents,
	comments,
	eq,
	getDb,
	importAttachments,
	importBatches,
	importItems,
	labels,
	memberships,
	projectMembers,
	projects,
	sections,
	sql,
	statuses,
	taskRecurrencePrefixes,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.IMPORTS_API ?? "http://127.0.0.1:8790";
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

type ApiResult = { status: number; body: unknown };
async function request(cookie: string, path: string, method = "GET", payload?: unknown): Promise<ApiResult> {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: "http://localhost:5173",
			Cookie: cookie,
			...(payload === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: payload === undefined ? undefined : JSON.stringify(payload),
	});
	return { status: response.status, body: await response.json().catch(() => ({})) };
}
const asBody = <T>(result: ApiResult) => result.body as T;

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createdUsers = await db
		.insert(users)
		.values(
			["owner", "editor", "commenter", "assignee", "second", "outsider"].map((role) => ({
				name: `Import ${role}`,
				email: `import-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})),
		)
		.returning({ id: users.id, email: users.email });
	const [owner, editor, commenter, assignee, second, outsider] = createdUsers;
	if (!owner || !editor || !commenter || !assignee || !second || !outsider)
		throw new Error("users missing");
	const [workspace, otherWorkspace] = await db
		.insert(workspaces)
		.values([
			{ name: `Import ${stamp}`, ownerId: owner.id },
			{ name: `Import other ${stamp}`, ownerId: owner.id },
		])
		.returning({ id: workspaces.id });
	if (!workspace || !otherWorkspace) throw new Error("workspaces missing");
	await db.insert(memberships).values(
		[owner, editor, commenter, assignee, second].map((user) => ({
			workspaceId: workspace.id,
			userId: user.id,
			role: user.id === owner.id ? ("admin" as const) : ("member" as const),
		})),
	);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Target ${stamp}` },
			{ workspaceId: otherWorkspace.id, ownerId: owner.id, name: `Other ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: owner.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: project.id, userId: commenter.id, role: "commenter" },
		{ projectId: project.id, userId: assignee.id, role: "editor" },
		{ projectId: project.id, userId: second.id, role: "editor" },
		{ projectId: otherProject.id, userId: owner.id, role: "manager" },
	]);
	await db.insert(statuses).values([
		{ projectId: project.id, scope: "project", name: "Otevřeno", position: 0 },
		{ projectId: project.id, scope: "project", name: "Hotovo", position: 1, isDone: true },
		{ projectId: otherProject.id, scope: "project", name: "Otevřeno", position: 0 },
	]);

	const importId = crypto.randomUUID();
	const fingerprint = "a".repeat(64);
	const command = {
		importId,
		projectId: project.id,
		source: "asana",
		sourceName: "asana-export.csv",
		sourceFingerprint: fingerprint,
		items: [
			{
				sourceKey: "root",
				name: "Výzkumný podklad",
				description: "Studijní materiály",
				sectionName: "Studium",
				dueDate: "2026-08-20",
				priority: 1,
				assigneeIds: [assignee.id],
				labels: ["Výzkum"],
				attachmentNames: ["podklad.pdf"],
			},
			{
				sourceKey: "child",
				parentSourceKey: "root",
				name: "Zpracovat kapitolu",
				sectionName: "Studium",
				priority: 2,
				assigneeIds: [assignee.id, second.id],
				labels: ["Výzkum", "Čtení"],
			},
			{
				sourceKey: "grandchild",
				parentSourceKey: "child",
				name: "Hotový výpis",
				sectionName: "Archiv zdroje",
				completed: true,
			},
		],
	};

	try {
		const ownerCookie = await login(owner.email);
		const editorCookie = await login(editor.email);
		const commenterCookie = await login(commenter.email);
		const outsiderCookie = await login(outsider.email);
		let result = await request(editorCookie, "/api/imports/projects");
		check(
			"výběr cílů nabízí editorovi importovatelný projekt",
			result.status === 200 &&
				asBody<{ projects?: { id: string }[] }>(result).projects?.some(
					(item) => item.id === project.id,
				) === true,
			result,
		);
		result = await request(commenterCookie, "/api/imports/projects");
		check(
			"výběr cílů skryje projekt bez práva importovat",
			result.status === 200 && asBody<{ projects?: unknown[] }>(result).projects?.length === 0,
			result,
		);
		result = await request(commenterCookie, "/api/imports/preview", "POST", command);
		check("commenter import nepřipraví", result.status === 403, result);
		result = await request(outsiderCookie, "/api/imports/preview", "POST", command);
		check("cizí uživatel dostane fail-closed 404", result.status === 404, result);

		result = await request(editorCookie, "/api/imports/preview", "POST", {
			...command,
			items: [{ ...command.items[0], parentSourceKey: "missing" }],
		});
		let body = asBody<{ valid?: boolean; errors?: { code: string }[] }>(result);
		check(
			"dry-run zachytí chybějícího rodiče bez zápisu",
			result.status === 200 && body.valid === false && body.errors?.[0]?.code === "parent_missing",
			result,
		);
		result = await request(editorCookie, "/api/imports/preview", "POST", {
			...command,
			items: [{ ...command.items[0], assigneeIds: [outsider.id] }],
		});
		body = asBody(result);
		check(
			"dry-run odmítne řešitele mimo projekt",
			result.status === 200 && body.valid === false && body.errors?.[0]?.code === "assignee_not_member",
			result,
		);
		result = await request(editorCookie, "/api/imports/preview", "POST", command);
		const preview = asBody<{
			valid?: boolean;
			summary?: { items: number; attachments: number; sections: number };
		}>(result);
		check(
			"validní dry-run spočítá úkoly, strukturu a soubory",
			result.status === 200 && preview.valid === true && preview.summary?.items === 3 && preview.summary.attachments === 1 && preview.summary.sections === 2,
			result,
		);
		check("dry-run nevytvořil batch", (await db.select().from(importBatches).where(eq(importBatches.id, importId))).length === 0);

		result = await request(editorCookie, "/api/imports/execute", "POST", command);
		const executed = asBody<{
			replayed?: boolean;
			items?: { id: string; sourceKey: string; taskId: string }[];
		}>(result);
		check("editor provede atomický import", result.status === 201 && executed.items?.length === 3, result);
		const rootMap = executed.items?.find((item) => item.sourceKey === "root");
		if (!rootMap) throw new Error("root mapping missing");
		const importedTasks = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
		const root = importedTasks.find((task) => task.id === rootMap.taskId);
		const child = importedTasks.find((task) => task.name === "Zpracovat kapitolu");
		const grandchild = importedTasks.find((task) => task.name === "Hotový výpis");
		check("hierarchie tří úrovní zůstala zachována", child?.parentId === root?.id && grandchild?.parentId === child?.id);
		check("termín, priorita a popis se přenesly", root?.priority === 1 && root?.dueDate instanceof Date && root.description === "Studijní materiály");
		check("dokončený řádek používá done status", grandchild?.completedAt !== null && grandchild?.statusId != null);
		check(
			"sekce a štítky se vytvořily bez duplicit",
			(await db.select().from(sections).where(eq(sections.projectId, project.id))).length === 2 &&
				(await db.select().from(labels).where(eq(labels.workspaceId, workspace.id))).length === 2,
		);

		result = await request(editorCookie, "/api/imports/execute", "POST", command);
		check("přesný retry je idempotentní", result.status === 200 && asBody<{ replayed?: boolean }>(result).replayed === true, result);
		result = await request(editorCookie, "/api/imports/execute", "POST", {
			...command,
			items: [{ ...command.items[0], name: "Jiný obsah" }],
		});
		check("stejné import ID s jiným obsahem je konflikt", result.status === 409, result);
		result = await request(editorCookie, "/api/imports/execute", "POST", { ...command, importId: crypto.randomUUID() });
		check(
			"stejný soubor nelze omylem importovat dvakrát",
			result.status === 409 && asBody<{ error?: string }>(result).error === "source_already_imported",
			result,
		);

		let scopeState: string | null = null;
		try {
			await db.insert(importBatches).values({
				workspaceId: otherWorkspace.id,
				projectId: project.id,
				createdBy: owner.id,
				source: "csv",
				sourceName: "bad.csv",
				sourceFingerprint: "b".repeat(64),
				requestHash: "c".repeat(64),
				itemCount: 1,
			});
		} catch (error) {
			let current: unknown = error;
			for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
				const value = current as { code?: unknown; cause?: unknown };
				if (value.code === "23514") scopeState = "23514";
				current = value.cause;
			}
		}
		check("DB odmítne project/workspace mismatch", scopeState === "23514", scopeState);

		const [registeredAttachment] = await db
			.insert(attachments)
			.values({
				taskId: rootMap.taskId,
				projectId: project.id,
				url: "https://example.test/podklad.pdf",
				fileName: "podklad.pdf",
				sha256: "e".repeat(64),
				mime: "application/pdf",
				sizeBytes: 100,
				uploadedBy: editor.id,
			})
			.returning({ id: attachments.id });
		result = await request(editorCookie, `/api/imports/${importId}/register-attachment`, "POST", {
			itemId: rootMap.id,
			attachmentId: registeredAttachment?.id,
		});
		check("přenesený soubor se sváže s importem", result.status === 200, result);
		result = await request(editorCookie, `/api/imports/${importId}/register-attachment`, "POST", {
			itemId: rootMap.id,
			attachmentId: registeredAttachment?.id,
		});
		check("registrace souboru má přesný retry", result.status === 200 && asBody<{ replayed?: boolean }>(result).replayed === true, result);

		const timeline = await request(editorCookie, `/api/tasks/${rootMap.taskId}/timeline`);
		const timelineBody = asBody<{ events?: { kind: string }[] }>(timeline);
		check("časová osa označí původ úkolu jako import", timeline.status === 200 && timelineBody.events?.some((event) => event.kind === "task_imported") === true, timeline);

		const deleted = await request(editorCookie, "/api/tasks/delete", "POST", {
			taskIds: [rootMap.taskId],
			operationId: `import-delete-${stamp}`,
		});
		const deleteBody = asBody<{ batchId?: string }>(deleted);
		check("importovaný strom lze smazat autoritativním commandem", deleted.status === 200 && Boolean(deleteBody.batchId), deleted);
		check(
			"delete odpojil item i registraci souboru",
			(await db.select().from(importItems).where(eq(importItems.id, rootMap.id)))[0]?.taskId === null &&
				(await db.select().from(importAttachments).where(eq(importAttachments.batchId, importId))).length === 0,
		);
		result = await request(editorCookie, "/api/tasks/restore", "POST", { batchId: deleteBody.batchId });
		check("undo obnoví importovaný strom", result.status === 200, result);
		check(
			"undo obnoví item i registraci souboru",
			(await db.select().from(importItems).where(eq(importItems.id, rootMap.id)))[0]?.taskId === rootMap.taskId &&
				(await db.select().from(importAttachments).where(eq(importAttachments.batchId, importId))).length === 1,
		);

		const batch = (await db.select().from(importBatches).where(eq(importBatches.id, importId)))[0];
		if (!batch) throw new Error("batch missing");
		result = await request(editorCookie, `/api/imports/${importId}/rollback`, "POST", {
			confirmSourceName: "wrong.csv",
			expectedUpdatedAt: batch.updatedAt.toISOString(),
		});
		check("rollback vyžaduje přesný název zdroje", result.status === 409, result);
		await db.insert(comments).values({
			taskId: rootMap.taskId,
			projectId: project.id,
			authorId: editor.id,
			body: "Nová práce po importu",
		});
		result = await request(editorCookie, `/api/imports/${importId}/rollback`, "POST", {
			confirmSourceName: command.sourceName,
			expectedUpdatedAt: batch.updatedAt.toISOString(),
		});
		check(
			"rollback odmítne smazat pozdější práci",
			result.status === 409 && asBody<{ error?: string }>(result).error === "import_rollback_conflict",
			result,
		);
		await db.delete(comments).where(and(eq(comments.taskId, rootMap.taskId), eq(comments.authorId, editor.id)));
		const postImportPrefixId = crypto.randomUUID();
		await db.insert(taskRecurrencePrefixes).values({
			id: postImportPrefixId,
			taskId: rootMap.taskId,
			projectId: project.id,
			anchorDate: new Date("2026-08-01T00:00:00.000Z"),
			endDate: new Date("2026-08-10T00:00:00.000Z"),
			recurrenceRule: JSON.stringify({ kind: "daily", showAll: true }),
			createdBy: editor.id,
		});
		result = await request(editorCookie, `/api/imports/${importId}/rollback`, "POST", {
			confirmSourceName: command.sourceName,
			expectedUpdatedAt: batch.updatedAt.toISOString(),
		});
		check(
			"rollback nesmaže později oddělenou historii opakované řady",
			result.status === 409 && asBody<{ error?: string }>(result).error === "import_rollback_conflict",
			result,
		);
		await db
			.delete(taskRecurrencePrefixes)
			.where(eq(taskRecurrencePrefixes.id, postImportPrefixId));

		result = await request(ownerCookie, `/api/imports/${importId}/rollback`, "POST", {
			confirmSourceName: command.sourceName,
			expectedUpdatedAt: batch.updatedAt.toISOString(),
		});
		check("manager provede bezpečný rollback dávky", result.status === 200, result);
		check("rollback odstranil importovaný strom", (await db.select().from(tasks).where(eq(tasks.id, rootMap.taskId))).length === 0);
		check(
			"rollback zachoval historii a odpojil task reference",
			(await db.select().from(importItems).where(eq(importItems.batchId, importId))).every((item) => item.taskId === null),
		);
		check(
			"prázdné sekce a štítky se uklidily",
			(await db.select().from(sections).where(eq(sections.projectId, project.id))).length === 0 &&
				(await db.select().from(labels).where(eq(labels.workspaceId, workspace.id))).length === 0,
		);
		result = await request(ownerCookie, `/api/imports/${importId}/rollback`, "POST", {
			confirmSourceName: command.sourceName,
			expectedUpdatedAt: batch.updatedAt.toISOString(),
		});
		check("rollback retry je idempotentní", result.status === 200 && asBody<{ replayed?: boolean }>(result).replayed === true, result);

		const secondImportId = crypto.randomUUID();
		result = await request(editorCookie, "/api/imports/execute", "POST", { ...command, importId: secondImportId });
		check("po rollbacku lze stejný zdroj vědomě importovat znovu", result.status === 201, result);
		const secondBatch = (await db.select().from(importBatches).where(eq(importBatches.id, secondImportId)))[0];
		result = await request(ownerCookie, `/api/imports/${secondImportId}/rollback`, "POST", {
			confirmSourceName: command.sourceName,
			expectedUpdatedAt: secondBatch?.updatedAt.toISOString(),
		});
		check("opakovanou testovací dávku lze uklidit", result.status === 200, result);

		result = await request(editorCookie, `/api/projects/${project.id}/imports`);
		check("historie vrací obě vrácené dávky", result.status === 200 && asBody<{ imports?: unknown[] }>(result).imports?.length === 2, result);
		const audits = await db
			.select({ entity: auditEvents.entity, action: auditEvents.action })
			.from(auditEvents)
			.where(eq(auditEvents.workspaceId, workspace.id));
		check(
			"execute, task materializace a rollback mají audit",
			["import_batches:execute", "tasks:import_create", "import_batches:rollback"].every((key) =>
				audits.some((event) => `${event.entity}:${event.action}` === key),
			),
			audits,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
		for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
	}

	if (failed > 0) throw new Error(`${failed} import checks failed`);
	console.log("\nImport wizard checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
