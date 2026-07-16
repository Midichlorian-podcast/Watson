/** Typovaná vlastní pole: ACL, typy, DB invarianty, audit, timeline a task undo. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	getDb,
	memberships,
	projectCustomFields,
	projectMembers,
	projects,
	sql,
	taskCustomFieldValues,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.CUSTOM_FIELDS_API ?? "http://127.0.0.1:8790";
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

async function createField(
	cookie: string,
	projectId: string,
	name: string,
	fieldType: string,
	options?: string[],
) {
	const id = crypto.randomUUID();
	const response = await request(cookie, `/api/projects/${projectId}/custom-fields`, "POST", {
		id,
		name,
		fieldType,
		...(options ? { options } : {}),
	});
	return { id, response, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createdUsers = await db
		.insert(users)
		.values(
			["owner", "editor", "commenter", "outsider"].map((role) => ({
				id: crypto.randomUUID(),
				name: `Custom ${role}`,
				email: `custom-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})),
		)
		.returning({ id: users.id, email: users.email });
	const [owner, editor, commenter, outsider] = createdUsers;
	if (!owner || !editor || !commenter || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Custom ${stamp}`, ownerId: owner.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values(
		createdUsers.map((user) => ({
			workspaceId: workspace.id,
			userId: user.id,
			role: user.id === owner.id ? ("manager" as const) : ("member" as const),
		})),
	);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Fields ${stamp}` },
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Other ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: owner.id, role: "manager" },
		{ projectId: project.id, userId: editor.id, role: "editor" },
		{ projectId: project.id, userId: commenter.id, role: "commenter" },
		{ projectId: otherProject.id, userId: owner.id, role: "manager" },
		{ projectId: otherProject.id, userId: outsider.id, role: "editor" },
	]);
	const taskId = crypto.randomUUID();
	const restoreTaskId = crypto.randomUUID();
	const otherTaskId = crypto.randomUUID();
	await db.insert(tasks).values([
		{ id: taskId, projectId: project.id, name: "Typed task", createdBy: editor.id },
		{ id: restoreTaskId, projectId: project.id, name: "Restore typed task", createdBy: owner.id },
		{ id: otherTaskId, projectId: otherProject.id, name: "Other task", createdBy: owner.id },
	]);

	try {
		const ownerCookie = await login(owner.email);
		const editorCookie = await login(editor.email);
		const commenterCookie = await login(commenter.email);
		const outsiderCookie = await login(outsider.email);

		let denied = await createField(commenterCookie, project.id, "Denied", "text");
		check("commenter nemůže měnit projektové schéma", denied.response.status === 403, denied.body);
		denied = await createField(outsiderCookie, project.id, "Hidden", "text");
		check("projekt se uživateli mimo něj neprozradí", denied.response.status === 404, denied.body);

		const text = await createField(editorCookie, project.id, "Poznámka", "text");
		const number = await createField(editorCookie, project.id, "Rozpočet", "number");
		const select = await createField(editorCookie, project.id, "Rozhodnutí", "select", ["Ano", "Ne"]);
		const date = await createField(editorCookie, project.id, "Datum akce", "date");
		const checkbox = await createField(editorCookie, project.id, "Schváleno", "checkbox");
		const url = await createField(editorCookie, project.id, "Podklady", "url");
		const person = await createField(editorCookie, project.id, "Garant", "person");
		check(
			"editor vytvoří všech sedm typů polí",
			[text, number, select, date, checkbox, url, person].every((field) => field.response.status === 201),
			[text, number, select, date, checkbox, url, person].map((field) => field.response.status),
		);
		let response = await request(editorCookie, `/api/projects/${project.id}/custom-fields`, "POST", {
			id: crypto.randomUUID(),
			name: "poznámka",
			fieldType: "text",
		});
		check("název pole je unikátní bez ohledu na velikost písmen", response.status === 409, response.status);

		response = await request(
			commenterCookie,
			`/api/tasks/${taskId}/custom-fields/${text.id}`,
			"PUT",
			{ value: "tajný přepis" },
		);
		check("commenter nemůže měnit hodnoty úkolu", response.status === 403, response.status);
		const setValue = (fieldId: string, value: unknown) =>
			request(editorCookie, `/api/tasks/${taskId}/custom-fields/${fieldId}`, "PUT", { value });
		response = await setValue(text.id, "Kontext k úkolu");
		check("textová hodnota projde", response.status === 200, response.status);
		response = await setValue(number.id, "42");
		check("číslo se nesmí podstrčit jako text", response.status === 422, response.status);
		response = await setValue(number.id, 42.5);
		check("číselná hodnota projde", response.status === 200, response.status);

		const selectRow = (
			await db.select().from(projectCustomFields).where(eq(projectCustomFields.id, select.id))
		)[0];
		const yesOption = selectRow?.options[0];
		if (!yesOption) throw new Error("select option missing");
		response = await setValue(select.id, crypto.randomUUID());
		check("výběr odmítne možnost mimo definici", response.status === 422, response.status);
		response = await setValue(select.id, yesOption.id);
		check("výběrová hodnota používá stabilní option ID", response.status === 200, response.status);
		response = await setValue(date.id, "2026-02-31");
		check("neexistující datum je odmítnuto", response.status === 422, response.status);
		response = await setValue(date.id, "2026-08-17");
		check("datum projde", response.status === 200, response.status);
		response = await setValue(checkbox.id, false);
		check("checkbox zachová i false jako skutečnou hodnotu", response.status === 200, response.status);
		response = await setValue(url.id, "javascript:alert(1)");
		check("odkaz přijímá pouze HTTP(S)", response.status === 422, response.status);
		response = await setValue(url.id, "https://example.com/podklady?q=watson");
		check("bezpečný odkaz projde", response.status === 200, response.status);
		response = await setValue(person.id, outsider.id);
		check("osoba musí být členem projektu", response.status === 422, response.status);
		response = await setValue(person.id, commenter.id);
		check("person hodnota člena projektu projde", response.status === 200, response.status);

		response = await request(editorCookie, `/api/custom-fields/${select.id}`, "PATCH", {
			options: ["Ne", "Možná"],
		});
		check("použitou select možnost nelze odstranit", response.status === 409, response.status);
		response = await request(editorCookie, `/api/custom-fields/${select.id}`, "PATCH", {
			name: "Výsledek hlasování",
			options: ["Ano", "Ne", "Možná"],
		});
		check("definici lze bezpečně přejmenovat a rozšířit", response.status === 200, response.status);
		const updatedSelect = (
			await db.select().from(projectCustomFields).where(eq(projectCustomFields.id, select.id))
		)[0];
		check(
			"existující option ID se při rozšíření zachová",
			updatedSelect?.options.find((option) => option.label === "Ano")?.id === yesOption.id,
			updatedSelect?.options,
		);

		let dbRejected = false;
		try {
			await db.insert(taskCustomFieldValues).values({
				fieldId: number.id,
				taskId: restoreTaskId,
				projectId: project.id,
				value: "not a number",
			});
		} catch {
			dbRejected = true;
		}
		check("DB trigger odmítne hodnotu špatného typu i mimo API", dbRejected);
		dbRejected = false;
		try {
			await db.insert(taskCustomFieldValues).values({
				fieldId: text.id,
				taskId: otherTaskId,
				projectId: otherProject.id,
				value: "cross project",
			});
		} catch {
			dbRejected = true;
		}
		check("DB odmítne cross-project hodnotu", dbRejected);

		response = await request(
			editorCookie,
			`/api/custom-fields/${select.id}?confirm=Výsledek%20hlasování`,
			"DELETE",
		);
		check("editor nesmaže používané projektové pole", response.status === 403, response.status);
		response = await request(ownerCookie, `/api/custom-fields/${select.id}?confirm=jiný%20název`, "DELETE");
		check("delete vyžaduje přesné druhé potvrzení názvu", response.status === 409, response.status);
		response = await request(
			ownerCookie,
			`/api/custom-fields/${select.id}?confirm=${encodeURIComponent("Výsledek hlasování")}`,
			"DELETE",
		);
		check("manager může potvrzeně odstranit používané pole", response.status === 200, response.status);
		check(
			"delete kaskádou odstranil jeho hodnotu",
			(
				await db
					.select()
					.from(taskCustomFieldValues)
					.where(eq(taskCustomFieldValues.fieldId, select.id))
			).length === 0,
		);

		response = await request(
			ownerCookie,
			`/api/tasks/${restoreTaskId}/custom-fields/${text.id}`,
			"PUT",
			{ value: "obnovit přes undo" },
		);
		check("hodnota pro restore fixture vznikla", response.status === 200, response.status);
		response = await request(ownerCookie, "/api/tasks/bulk/preview", "POST", {
			taskIds: [restoreTaskId],
			action: { kind: "move", projectId: otherProject.id },
		});
		const movePreview = (await response.json().catch(() => ({}))) as {
			conflicts?: { code: string }[];
		};
		check(
			"přesun mezi projekty nesmí potichu zahodit vlastní hodnotu",
			response.status === 200 &&
				movePreview.conflicts?.some((conflict) => conflict.code === "custom_fields_block_move") === true,
			movePreview,
		);
		response = await request(ownerCookie, "/api/export", "GET");
		const backup = (await response.json().catch(() => ({}))) as {
			tables?: Record<string, Record<string, unknown>[]>;
		};
		check(
			"autoritativní export obsahuje definice i hodnoty",
			response.status === 200 &&
				backup.tables?.project_custom_fields?.some((row) => row.id === text.id) === true &&
				backup.tables?.task_custom_field_values?.some((row) => row.task_id === restoreTaskId) === true,
			Object.keys(backup.tables ?? {}),
		);
		response = await request(ownerCookie, "/api/tasks/delete", "POST", {
			taskIds: [restoreTaskId],
			operationId: crypto.randomUUID(),
		});
		const deleted = (await response.json().catch(() => ({}))) as { batchId?: string };
		check("task delete s vlastní hodnotou uspěl", response.status === 200 && Boolean(deleted.batchId), deleted);
		check(
			"smazání úkolu odstranilo hodnotu",
			(
				await db
					.select()
					.from(taskCustomFieldValues)
					.where(eq(taskCustomFieldValues.taskId, restoreTaskId))
			).length === 0,
		);
		response = await request(ownerCookie, "/api/tasks/restore", "POST", { batchId: deleted.batchId });
		const restoredValue = (
			await db
				.select()
				.from(taskCustomFieldValues)
				.where(eq(taskCustomFieldValues.taskId, restoreTaskId))
		)[0];
		check(
			"undo obnoví typovanou hodnotu přesně",
			response.status === 200 && restoredValue?.value === "obnovit přes undo",
			restoredValue,
		);

		response = await request(editorCookie, `/api/tasks/${taskId}/timeline`, "GET");
		const timeline = (await response.json().catch(() => ({}))) as {
			events?: { kind: string; excerpt?: string }[];
		};
		check(
			"změny vlastních polí jsou dohledatelné v časové ose úkolu",
			response.status === 200 &&
				timeline.events?.some(
					(event) => event.kind === "custom_field_updated" && event.excerpt === "Poznámka",
				) === true,
			timeline,
		);
		const events = await db
			.select({ entity: auditEvents.entity, action: auditEvents.action })
			.from(auditEvents)
			.where(and(eq(auditEvents.workspaceId, workspace.id)));
		check(
			"definice i hodnoty mají autoritativní audit",
			events.some((event) => event.entity === "project_custom_fields" && event.action === "create") &&
				events.some(
					(event) => event.entity === "task_custom_field_values" && event.action === "create",
				),
			events,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
	}
	if (failed) throw new Error(`${failed} custom field checks failed`);
	console.log("\nCustom field checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
