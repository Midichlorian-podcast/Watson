/** Integrační důkaz: occurrence preview, DST, ACL, Focus conflict, idempotence a bezpečné undo. */
import "./src/env";
import {
	assignments,
	availabilityBlocks,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	taskOccurrenceOverrides,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.RECURRENCE_API ?? "http://127.0.0.1:8790";
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

async function post(cookie: string, path: string, body: unknown) {
	const response = await fetch(`${API}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:5173",
			Cookie: cookie,
		},
		body: JSON.stringify(body),
	});
	return {
		status: response.status,
		body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
	};
}

function sqlState(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const direct = "code" in error ? String(error.code) : undefined;
	const cause = "cause" in error ? error.cause : undefined;
	return direct ??
		(cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined);
}

const recurrenceInput = (
	occurrenceDate: string,
	date: string,
	time: string | null,
	timeZone: string | null,
	durationMin: number | null,
	dstPolicy: "reject" | "next_valid" = "reject",
) => ({
	occurrenceDate,
	scope: "this_occurrence",
	schedule: { date, time, timeZone, durationMin },
	dstPolicy,
});

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [manager, assignee, workspaceManager, outsider] = await db
		.insert(users)
		.values([
			{
				name: "Recurrence manager",
				email: `recurrence-manager-${stamp}@watson.test`,
				emailVerified: true,
			},
			{
				name: "Recurrence assignee",
				email: `recurrence-assignee-${stamp}@watson.test`,
				emailVerified: true,
			},
			{
				name: "Recurrence workspace manager",
				email: `recurrence-ws-manager-${stamp}@watson.test`,
				emailVerified: true,
			},
			{
				name: "Recurrence outsider",
				email: `recurrence-outsider-${stamp}@watson.test`,
				emailVerified: true,
			},
		])
		.returning({ id: users.id, email: users.email });
	if (!manager || !assignee || !workspaceManager || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Recurrence ${stamp}`, ownerId: manager.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: assignee.id, role: "member" },
		{ workspaceId: workspace.id, userId: workspaceManager.id, role: "manager" },
	]);
	const [project, restrictedProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, name: "Recurrence project", ownerId: manager.id },
			{
				workspaceId: workspace.id,
				name: "Restricted recurrence",
				ownerId: manager.id,
				visibility: "restricted",
			},
		])
		.returning({ id: projects.id });
	if (!project || !restrictedProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: assignee.id, role: "editor" },
		{ projectId: restrictedProject.id, userId: manager.id, role: "manager" },
	]);
	const rule = JSON.stringify({ kind: "daily", endKind: "never", showAll: true });
	const [task, restrictedTask] = await db
		.insert(tasks)
		.values([
			{
				projectId: project.id,
				name: "Daily recurrence",
				dueDate: new Date("2026-03-27T00:00:00.000Z"),
				startDate: new Date("2026-03-27T00:30:00.000Z"),
				startTimezone: "Europe/Prague",
				durationMin: 60,
				recurrenceRule: rule,
				createdBy: manager.id,
			},
			{
				projectId: restrictedProject.id,
				name: "Restricted daily recurrence",
				dueDate: new Date("2026-03-27T00:00:00.000Z"),
				recurrenceRule: rule,
				createdBy: manager.id,
			},
		])
		.returning({ id: tasks.id });
	if (!task || !restrictedTask) throw new Error("tasks missing");
	await db.insert(assignments).values({
		taskId: task.id,
		projectId: project.id,
		userId: assignee.id,
	});

	let invariantCode: string | undefined;
	try {
		await db.insert(taskOccurrenceOverrides).values({
			taskId: task.id,
			projectId: project.id,
			occDate: "2026-03-31",
			done: true,
			skipped: true,
		});
	} catch (error) {
		invariantCode = sqlState(error);
	}
	check("DB odmítne současné done i skipped", invariantCode === "23514", invariantCode);

	invariantCode = undefined;
	try {
		await db.insert(taskOccurrenceOverrides).values({
			taskId: task.id,
			projectId: project.id,
			occDate: "2026-04-01",
			overrideDueDate: new Date("2026-04-05T00:00:00.000Z"),
			overrideStartDate: new Date("2026-04-05T10:00:00.000Z"),
		});
	} catch (error) {
		invariantCode = sqlState(error);
	}
	check("DB odmítne plánovací instant bez IANA zóny", invariantCode === "23514", invariantCode);

	invariantCode = undefined;
	try {
		await db.insert(taskOccurrenceOverrides).values({
			taskId: task.id,
			projectId: restrictedProject.id,
			occDate: "2026-04-03",
		});
	} catch (error) {
		invariantCode = sqlState(error);
	}
	check("DB odmítne denormalizovaný project z jiného projektu", invariantCode === "23503", invariantCode);

	try {
		const managerCookie = await login(manager.email);
		const workspaceManagerCookie = await login(workspaceManager.email);
		const outsiderCookie = await login(outsider.email);
		const path = `/api/tasks/${task.id}/recurrence`;

		let response = await post(
			outsiderCookie,
			`${path}/preview`,
			recurrenceInput("2026-03-28", "2026-04-02", null, null, null),
		);
		check("uživateli mimo workspace se úkol neprozradí", response.status === 404, response);
		response = await post(
			workspaceManagerCookie,
			`/api/tasks/${restrictedTask.id}/recurrence/preview`,
			recurrenceInput("2026-03-28", "2026-04-02", null, null, null),
		);
		check("restricted projekt se vedení mimo projekt neprozradí", response.status === 404, response);

		response = await post(managerCookie, `${path}/preview`, {
			...recurrenceInput("2026-03-28", "2026-04-02", null, null, null),
			scope: "this_and_future",
		});
		check(
			"dosud nezapojený scope failuje explicitně, ne částečnou změnou",
			response.status === 422 && response.body.error === "recurrence_scope_not_available_yet",
			response,
		);

		response = await post(
			managerCookie,
			`${path}/preview`,
			recurrenceInput(
				"2026-03-29",
				"2026-03-29",
				"02:30",
				"Europe/Prague",
				60,
				"reject",
			),
		);
		check(
			"neexistující lokální čas se bez výslovné DST politiky odmítne",
			response.status === 422 && response.body.error === "invalid_or_nonexistent_local_time",
			response,
		);
		response = await post(
			managerCookie,
			`${path}/preview`,
			recurrenceInput(
				"2026-03-29",
				"2026-03-29",
				"02:30",
				"Europe/Prague",
				60,
				"next_valid",
			),
		);
		const dstProposed = response.body.proposed as Record<string, unknown> | undefined;
		check(
			"výslovná DST politika ukáže efektivní 03:00 i varování",
			response.status === 200 &&
				dstProposed?.time === "03:00" &&
				dstProposed?.dstAdjusted === true &&
				(response.body.warnings as string[] | undefined)?.includes("dst_time_adjusted") === true,
			response,
		);

		await db.insert(availabilityBlocks).values({
			workspaceId: workspace.id,
			userId: assignee.id,
			kind: "focus",
			startsAt: new Date("2026-04-02T08:00:00.000Z"),
			endsAt: new Date("2026-04-02T10:00:00.000Z"),
			timezone: "Europe/Prague",
			label: "Verifier Focus",
			createdBy: assignee.id,
		});
		response = await post(
			managerCookie,
			`${path}/preview`,
			recurrenceInput("2026-03-28", "2026-04-02", "10:30", "Europe/Prague", 60),
		);
		check(
			"Focus Time zablokuje přesun konkrétního výskytu",
			response.status === 200 && response.body.canExecute === false,
			response,
		);

		const validInput = recurrenceInput(
			"2026-03-28",
			"2026-04-02",
			"13:00",
			"Europe/Prague",
			45,
		);
		response = await post(managerCookie, `${path}/preview`, validInput);
		check(
			"bezpečný přesun vrátí current/proposed diff a upozorní na další denní výskyt",
			response.status === 200 &&
				response.body.canExecute === true &&
				(response.body.warnings as string[] | undefined)?.includes(
					"target_contains_series_occurrence",
				) === true,
			response,
		);
		const previewHash = String(response.body.previewHash);
		const operationId = crypto.randomUUID();
		response = await post(managerCookie, `${path}/execute`, {
			...validInput,
			previewHash,
			operationId,
		});
		check("atomický přesun vznikne s undo oknem", response.status === 201, response);
		const batchId = String(response.body.batchId);
		const override = (
			await db
				.select()
				.from(taskOccurrenceOverrides)
				.where(eq(taskOccurrenceOverrides.taskId, task.id))
		)[0];
		check(
			"DB zachová původní identitu výskytu a uloží nový instant",
			override?.occDate === "2026-03-28" &&
				override.overrideDueDate?.toISOString().slice(0, 10) === "2026-04-02" &&
				override.overrideStartDate?.toISOString() === "2026-04-02T11:00:00.000Z" &&
				override.version === 1,
			override,
		);
		response = await post(managerCookie, `${path}/execute`, {
			...validInput,
			previewHash,
			operationId,
		});
		check(
			"opakovaný operationId je idempotentní replay",
			response.status === 200 && response.body.replayed === true,
			response,
		);
		response = await post(managerCookie, `${path}/execute`, {
			...validInput,
			previewHash,
			operationId,
			schedule: { ...validInput.schedule, time: "14:00" },
		});
		check(
			"stejný operationId nelze znovu použít pro jiný payload",
			response.status === 409 && response.body.error === "operation_id_reused",
			response,
		);

		if (!override) throw new Error("override missing");
		await db
			.update(taskOccurrenceOverrides)
			.set({ done: true })
			.where(eq(taskOccurrenceOverrides.id, override.id));
		response = await post(managerCookie, `${path}/undo`, { batchId });
		check("undo přesunu uspěje i po označení výskytu hotovo", response.status === 200, response);
		const afterUndo = (
			await db
				.select()
				.from(taskOccurrenceOverrides)
				.where(eq(taskOccurrenceOverrides.id, override.id))
		)[0];
		check(
			"undo nesmaže novější done stav a odstraní jen plánovací výjimku",
			afterUndo?.done === true &&
				afterUndo.overrideDueDate === null &&
				afterUndo.overrideStartDate === null &&
				afterUndo.version === 2,
			afterUndo,
		);
		response = await post(managerCookie, `${path}/undo`, { batchId });
		check(
			"opakované undo je čistý replay",
			response.status === 200 && response.body.replayed === true,
			response,
		);

		const allDayInput = recurrenceInput("2026-03-31", "2026-04-06", null, null, null);
		response = await post(managerCookie, `${path}/preview`, allDayInput);
		const allDayPreviewHash = String(response.body.previewHash);
		response = await post(managerCookie, `${path}/execute`, {
			...allDayInput,
			previewHash: allDayPreviewHash,
			operationId: crypto.randomUUID(),
		});
		check("časovaný výskyt lze změnit na celodenní", response.status === 201, response);
		const allDayBatchId = String(response.body.batchId);
		response = await post(managerCookie, `${path}/preview`, allDayInput);
		check(
			"celodenní výjimka v preview nezdědí čas ani délku řady",
			response.status === 200 &&
				(response.body.current as Record<string, unknown> | undefined)?.startsAt === null &&
				(response.body.current as Record<string, unknown> | undefined)?.durationMin === null &&
				(response.body.warnings as string[] | undefined)?.includes("no_schedule_change") === true,
			response,
		);
		response = await post(managerCookie, `${path}/undo`, { batchId: allDayBatchId });
		check("undo celodenní výjimku bezpečně odstraní", response.status === 200, response);

		const staleInput = recurrenceInput("2026-03-30", "2026-04-04", null, null, null);
		response = await post(managerCookie, `${path}/preview`, staleInput);
		const staleHash = String(response.body.previewHash);
		await db.update(tasks).set({ name: "Daily recurrence renamed" }).where(eq(tasks.id, task.id));
		response = await post(managerCookie, `${path}/execute`, {
			...staleInput,
			previewHash: staleHash,
			operationId: crypto.randomUUID(),
		});
		check(
			"změna úkolu po preview způsobí čistý stale konflikt",
			response.status === 409 && response.body.error === "preview_stale",
			response,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db
			.delete(users)
			.where(sql`${users.id} IN (${manager.id}, ${assignee.id}, ${workspaceManager.id}, ${outsider.id})`);
	}

	if (failed) throw new Error(`${failed} recurrence checks failed`);
	console.log("\nRecurrence command checks passed.");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
