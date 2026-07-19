/** Availability integration proof: ACL, privacy, CAS, idempotence, holds and DB guards. */
import "./src/env";
import {
	and,
	assignments,
	auditEvents,
	availabilityBlocks,
	availabilityProfiles,
	availabilityTaskOverrides,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	reminders,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { quietHoursHold } from "./src/availabilityPolicy";
import { scanAndSendDue } from "./src/push";

const API = process.env.AVAILABILITY_API ?? "http://127.0.0.1:8790";
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

async function request(cookie: string, path: string, method = "GET", body?: unknown) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: "http://localhost:5173",
			Cookie: cookie,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return {
		status: response.status,
		body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
	};
}

function errorCode(error: unknown) {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; cause?: unknown };
		if (typeof value.code === "string") return value.code;
		current = value.cause;
	}
	return null;
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [manager, member, workspaceManager, outsider] = await db
		.insert(users)
		.values([
			{ id: crypto.randomUUID(), name: "Availability manager", email: `availability-manager-${stamp}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Availability member", email: `availability-member-${stamp}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Availability workspace manager", email: `availability-workspace-manager-${stamp}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Availability outsider", email: `availability-outsider-${stamp}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	if (!manager || !member || !workspaceManager || !outsider) throw new Error("availability users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Availability ${stamp}`, ownerId: manager.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("availability workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
		{ workspaceId: workspace.id, userId: workspaceManager.id, role: "manager" },
	]);
	const [project] = await db
		.insert(projects)
		.values({ workspaceId: workspace.id, ownerId: manager.id, name: `Availability ${stamp}` })
		.returning({ id: projects.id });
	if (!project) throw new Error("availability project missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: member.id, role: "editor" },
	]);
	const [task] = await db
		.insert(tasks)
		.values({ projectId: project.id, name: "Availability reminder", createdBy: manager.id })
		.returning({ id: tasks.id });
	if (!task) throw new Error("availability task missing");
	const [restrictedProject] = await db
		.insert(projects)
		.values({
			workspaceId: workspace.id,
			ownerId: manager.id,
			name: `Restricted availability ${stamp}`,
			visibility: "restricted",
		})
		.returning({ id: projects.id });
	if (!restrictedProject) throw new Error("restricted availability project missing");
	await db.insert(projectMembers).values({
		projectId: restrictedProject.id,
		userId: manager.id,
		role: "manager",
	});
	const [restrictedTask] = await db
		.insert(tasks)
		.values({ projectId: restrictedProject.id, name: "Restricted Focus task", createdBy: manager.id })
		.returning({ id: tasks.id });
	if (!restrictedTask) throw new Error("restricted availability task missing");

	try {
		const managerCookie = await login(manager.email);
		const memberCookie = await login(member.email);
		const workspaceManagerCookie = await login(workspaceManager.email);
		const outsiderCookie = await login(outsider.email);

		let response = await request(outsiderCookie, `/api/workspaces/${workspace.id}/availability`);
		check("cizí uživatel nevidí dostupnost prostoru", response.status === 403, response);
		response = await request(
			outsiderCookie,
			`/api/tasks/${task.id}/availability/preflight`,
			"POST",
			{},
		);
		check("cizímu uživateli preflight neprozradí existenci úkolu", response.status === 404, response);
		response = await request(
			workspaceManagerCookie,
			`/api/tasks/${restrictedTask.id}/availability/preflight`,
			"POST",
			{},
		);
		check("restricted úkol se neprozradí vedení mimo projekt", response.status === 404, response);
		response = await request(
			workspaceManagerCookie,
			`/api/tasks/${task.id}/availability/preflight`,
			"POST",
			{},
		);
		check("workspace manager bez projektové role nemůže úkol přeplánovat", response.status === 403, response);

		const defaultProfileBody = {
			expectedVersion: 0,
			timezone: "Europe/Prague",
			workingHours: { enabled: false, days: [] },
			quietHours: { enabled: false, days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1320, endMinute: 420 },
		};
		const concurrentProfiles = await Promise.all([
			request(workspaceManagerCookie, `/api/workspaces/${workspace.id}/availability/me`, "PUT", defaultProfileBody),
			request(workspaceManagerCookie, `/api/workspaces/${workspace.id}/availability/me`, "PUT", defaultProfileBody),
		]);
		check(
			"souběžný první save profilu skončí jedním zápisem a čistým CAS konfliktem",
			concurrentProfiles.map((entry) => entry.status).sort().join(",") === "200,409",
			concurrentProfiles,
		);
		const concurrentBlockId = crypto.randomUUID();
		const concurrentBlockBody = {
			id: concurrentBlockId,
			kind: "unavailable",
			startsAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
			endsAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
			timezone: "Europe/Prague",
			label: "Souběžný blok",
			visibility: "team",
		};
		const concurrentBlocks = await Promise.all([
			request(workspaceManagerCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", concurrentBlockBody),
			request(workspaceManagerCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", concurrentBlockBody),
		]);
		check(
			"souběžný create bloku je jeden zápis a jeden idempotentní replay",
			concurrentBlocks.map((entry) => entry.status).sort().join(",") === "200,201",
			concurrentBlocks,
		);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability`);
		const initialMembers = response.body.members as Array<Record<string, unknown>> | undefined;
		const initialMine = initialMembers?.find((entry) => entry.userId === member.id);
		check(
			"člen dostane bezpečný výchozí profil bez skrytého zápisu",
			response.status === 200 && (initialMine?.profile as { version?: number })?.version === 0,
			response,
		);

		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/me`, "PUT", {
			expectedVersion: 0,
			timezone: "Europe/Prague",
			workingHours: {
				enabled: true,
				days: [{ day: 1, intervals: [{ startMinute: 540, endMinute: 1020 }, { startMinute: 1000, endMinute: 1100 }] }],
			},
			quietHours: { enabled: false, days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1320, endMinute: 420 },
		});
		check("překrývající se pracovní intervaly API odmítne", response.status === 422, response);

		const workingHours = {
			enabled: true,
			days: [
				{ day: 5, intervals: [{ startMinute: 540, endMinute: 1020 }] },
				{ day: 1, intervals: [{ startMinute: 540, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }] },
			],
		};
		const quietHours = { enabled: true, days: [7, 6, 5, 4, 3, 2, 1], startMinute: 1320, endMinute: 420 };
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/me`, "PUT", {
			expectedVersion: 0,
			timezone: "Europe/Prague",
			workingHours,
			quietHours,
		});
		check("člen uloží vlastní rozvrh přes CAS", response.status === 200, response);
		const [profile] = await db
			.select()
			.from(availabilityProfiles)
			.where(and(eq(availabilityProfiles.workspaceId, workspace.id), eq(availabilityProfiles.userId, member.id)));
		check(
			"server rozvrh deterministicky normalizoval a zvýšil verzi",
			profile?.version === 1 && profile.workingHours.days[0]?.day === 1 && profile.quietHours.days[0] === 1,
			profile,
		);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/me`, "PUT", {
			expectedVersion: 0,
			timezone: "Europe/Prague",
			workingHours,
			quietHours,
		});
		check("stará verze profilu je odmítnuta", response.status === 409, response);

		const blockId = crypto.randomUUID();
		const startsAt = new Date(Date.now() - 5 * 60_000).toISOString();
		const endsAt = new Date(Date.now() + 60 * 60_000).toISOString();
		const privateBlock = {
			id: blockId,
			kind: "focus",
			startsAt,
			endsAt,
			timezone: "Europe/Prague",
			label: "Citlivá příprava rozpočtu",
			visibility: "private",
		};
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", privateBlock);
		check("člen vytvoří vlastní Focus Time", response.status === 201, response);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", privateBlock);
		check("opakovaný create se stejným id je idempotentní", response.status === 200, response);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", {
			...privateBlock,
			label: "Jiný obsah pod stejným id",
		});
		check("reuse id s jiným obsahem je konflikt", response.status === 409, response);

		response = await request(managerCookie, `/api/workspaces/${workspace.id}/availability`);
		const managerBlocks = response.body.blocks as Array<Record<string, unknown>> | undefined;
		check(
			"soukromý popisek se kolegovi neprozradí",
			response.status === 200 && managerBlocks?.find((block) => block.id === blockId)?.label === null,
			response,
		);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability`);
		const ownerBlocks = response.body.blocks as Array<Record<string, unknown>> | undefined;
		check(
			"autor svůj soukromý popisek vidí",
			ownerBlocks?.find((block) => block.id === blockId)?.label === privateBlock.label,
			response,
		);

		const scheduledStart = new Date(Date.now() + 10 * 60_000).toISOString();
		const [scheduledTask] = await db
			.insert(tasks)
			.values({
				projectId: project.id,
				name: "Focus guarded task",
				startDate: new Date(scheduledStart),
				startTimezone: "Europe/Prague",
				durationMin: 30,
				createdBy: manager.id,
			})
			.returning({ id: tasks.id });
		if (!scheduledTask) throw new Error("scheduled availability task missing");
		response = await request(
			managerCookie,
			`/api/tasks/${scheduledTask.id}/availability/preflight`,
			"POST",
			{ startsAt: scheduledStart, durationMin: 30, assigneeIds: [member.id] },
		);
		const focusPreflight = response.body as {
			canSchedule?: boolean;
			conflicts?: Array<{ blockId?: string; label?: string | null; blocking?: boolean }>;
		};
		check(
			"Focus preflight úkol zablokuje a neprozradí soukromý popisek",
			response.status === 200 &&
				focusPreflight.canSchedule === false &&
				focusPreflight.conflicts?.some(
					(conflict) => conflict.blockId === blockId && conflict.blocking && conflict.label === null,
				),
			response,
		);
		const overrideId = crypto.randomUUID();
		const overrideBody = {
			id: overrideId,
			blockId,
			assigneeId: member.id,
			reason: "Naléhavý produkční incident v integračním testu",
			startsAt: scheduledStart,
			durationMin: 30,
		};
		response = await request(
			managerCookie,
			`/api/tasks/${scheduledTask.id}/availability-overrides`,
			"POST",
			overrideBody,
		);
		check("editor vytvoří auditovanou nouzovou výjimku", response.status === 201, response);
		response = await request(
			managerCookie,
			`/api/tasks/${scheduledTask.id}/availability-overrides`,
			"POST",
			overrideBody,
		);
		check("nouzová výjimka je idempotentní", response.status === 200, response);
		response = await request(
			managerCookie,
			`/api/tasks/${scheduledTask.id}/availability-overrides`,
			"POST",
			{ ...overrideBody, startsAt: new Date(Date.parse(scheduledStart) + 60_000).toISOString() },
		);
		check("stejné override ID s jiným plánem není falešný replay", response.status === 409, response);
		response = await request(
			managerCookie,
			`/api/tasks/${scheduledTask.id}/availability-overrides`,
			"POST",
			{ ...overrideBody, id: crypto.randomUUID() },
		);
		check("nové ID nepřepíše již schválený override scope", response.status === 409, response);
		await db.insert(assignments).values({
			taskId: scheduledTask.id,
			projectId: project.id,
			userId: member.id,
		});
		const [savedOverride] = await db
			.select()
			.from(availabilityTaskOverrides)
			.where(eq(availabilityTaskOverrides.id, overrideId));
		check(
			"DB dovolí přiřazení přesně pro schválený task/block/user scope",
			savedOverride?.taskId === scheduledTask.id && savedOverride.assigneeId === member.id,
			savedOverride,
		);
		response = await request(managerCookie, `/api/tasks/${scheduledTask.id}/timeline`);
		const timelineEvents = response.body.events as Array<{ kind?: string; excerpt?: string }> | undefined;
		check(
			"důvod nouzové výjimky je vidět v historii úkolu",
			response.status === 200 &&
				timelineEvents?.some(
					(event) =>
						event.kind === "availability_override" && event.excerpt === overrideBody.reason,
				),
			response,
		);

		const secondFocusId = crypto.randomUUID();
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", {
			...privateBlock,
			id: secondFocusId,
			label: "Druhý Focus Time",
			visibility: "team",
		});
		check("druhý Focus Time vznikl pro DB guard", response.status === 201, response);
		const [batchOverrideTask] = await db
			.insert(tasks)
			.values({
				projectId: project.id,
				name: "Atomic emergency override batch",
				startDate: new Date(scheduledStart),
				startTimezone: "Europe/Prague",
				durationMin: 30,
				createdBy: manager.id,
			})
			.returning({ id: tasks.id });
		if (!batchOverrideTask) throw new Error("batch override task missing");
		const batchOverrideIds = [crypto.randomUUID(), crypto.randomUUID()];
		const batchOverrideBody = {
			overrides: [
				{ id: batchOverrideIds[0], blockId, assigneeId: member.id },
				{ id: batchOverrideIds[1], blockId: crypto.randomUUID(), assigneeId: member.id },
			],
			reason: "Naléhavý zásah přes oba Focus bloky",
			startsAt: scheduledStart,
			durationMin: 30,
		};
		response = await request(
			managerCookie,
			`/api/tasks/${batchOverrideTask.id}/availability-overrides/batch`,
			"POST",
			batchOverrideBody,
		);
		const failedBatchRows = await db
			.select({ id: availabilityTaskOverrides.id })
			.from(availabilityTaskOverrides)
			.where(
				sql`${availabilityTaskOverrides.id} IN (${sql.join(
					batchOverrideIds.map((id) => sql`${id}`),
					sql`, `,
				)})`,
			);
		check(
			"neplatná vícenásobná výjimka je atomická a nezanechá první oprávnění",
			response.status === 422 && failedBatchRows.length === 0,
			{ response, failedBatchRows },
		);
		batchOverrideBody.overrides[1] = {
			id: batchOverrideIds[1] as string,
			blockId: secondFocusId,
			assigneeId: member.id,
		};
		response = await request(
			managerCookie,
			`/api/tasks/${batchOverrideTask.id}/availability-overrides/batch`,
			"POST",
			batchOverrideBody,
		);
		const savedBatchRows = await db
			.select({ id: availabilityTaskOverrides.id })
			.from(availabilityTaskOverrides)
			.where(
				sql`${availabilityTaskOverrides.id} IN (${sql.join(
					batchOverrideIds.map((id) => sql`${id}`),
					sql`, `,
				)})`,
			);
		check(
			"platná vícenásobná nouzová výjimka se uloží celá",
			response.status === 201 && savedBatchRows.length === 2,
			{ response, savedBatchRows },
		);
		response = await request(
			managerCookie,
			`/api/tasks/${batchOverrideTask.id}/availability-overrides/batch`,
			"POST",
			batchOverrideBody,
		);
		check("celá dávka nouzových výjimek má přesný idempotentní replay", response.status === 200, response);
		const [bulkTask] = await db
			.insert(tasks)
			.values({
				projectId: project.id,
				name: "Availability bulk guard",
				startDate: new Date(scheduledStart),
				startTimezone: "Europe/Prague",
				durationMin: 30,
				createdBy: manager.id,
			})
			.returning({ id: tasks.id });
		if (!bulkTask) throw new Error("availability bulk task missing");
		response = await request(managerCookie, "/api/tasks/bulk/preview", "POST", {
			taskIds: [bulkTask.id],
			action: { kind: "assign", userId: member.id },
		});
		const bulkConflicts = response.body.conflicts as Array<{ code?: string }> | undefined;
		check(
			"hromadné přiřazení vrátí srozumitelný Focus konflikt už v náhledu",
			response.status === 200 &&
				bulkConflicts?.some((conflict) => conflict.code === "assignee_availability_conflict"),
			response,
		);
		response = await request(managerCookie, "/api/sync/write", "POST", {
			op: "PUT",
			table: "assignments",
			id: crypto.randomUUID(),
			data: { task_id: bulkTask.id, project_id: project.id, user_id: member.id, completed_at: null },
			clientId: `availability-${stamp}`,
			operationId: String(Date.now()),
		});
		check(
			"offline sync gateway vrátí strukturovaný 409 místo tichého obejití",
			response.status === 409 && response.body.error === "availability_conflict",
			response,
		);
		response = await request(managerCookie, "/api/meetings/plan", "POST", {
			meetingId: crypto.randomUUID(),
			hubTaskId: crypto.randomUUID(),
			workspaceId: workspace.id,
			projectId: project.id,
			title: "Focus protected meeting",
			dueDate: scheduledStart.slice(0, 10),
			startAt: scheduledStart,
			startTimezone: "Europe/Prague",
			durationMin: 30,
			participantIds: [member.id],
		});
		check(
			"plánování porady vrátí Focus konflikt bez částečně založených dat",
			response.status === 409 && response.body.error === "availability_conflict",
			response,
		);
		let focusDbRejected = false;
		try {
			await db.update(tasks).set({ durationMin: 31 }).where(eq(tasks.id, scheduledTask.id));
		} catch (error) {
			focusDbRejected = errorCode(error) === "23514";
		}
		check("DB odmítne přeplánování přes Focus bez konkrétní výjimky", focusDbRejected);
		response = await request(
			memberCookie,
			`/api/workspaces/${workspace.id}/availability/blocks/${secondFocusId}`,
			"DELETE",
			{ expectedVersion: 1 },
		);
		check("testovací Focus Time byl bezpečně zrušen", response.status === 200, response);

		const unavailableId = crypto.randomUUID();
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", {
			...privateBlock,
			id: unavailableId,
			kind: "unavailable",
			label: "Mimo kancelář",
			visibility: "team",
		});
		check("nedostupnost vznikla pro policy test", response.status === 201, response);
		response = await request(
			managerCookie,
			`/api/tasks/${scheduledTask.id}/availability/preflight`,
			"POST",
			{ startsAt: scheduledStart, durationMin: 30 },
		);
		check(
			"warning politika nedostupnost ukáže, ale plánování dovolí",
			response.status === 200 && response.body.canSchedule === true,
			response,
		);
		response = await request(
			managerCookie,
			`/api/workspaces/${workspace.id}/task-conflict-policy`,
			"PATCH",
			{ policy: "strict" },
		);
		check("workspace lze přepnout na striktní politiku", response.status === 200, response);
		let strictDbRejected = false;
		try {
			await db.update(tasks).set({ durationMin: 32 }).where(eq(tasks.id, scheduledTask.id));
		} catch (error) {
			strictDbRejected = errorCode(error) === "23514";
		}
		check("DB v strict politice odmítne nedostupnost", strictDbRejected);
		await db.update(workspaces).set({ taskConflictPolicy: "warning" }).where(eq(workspaces.id, workspace.id));
		response = await request(
			memberCookie,
			`/api/workspaces/${workspace.id}/availability/blocks/${unavailableId}`,
			"DELETE",
			{ expectedVersion: 1 },
		);
		check("testovací nedostupnost byla zrušena", response.status === 200, response);

		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/me/snooze`, "PUT", {
			expectedVersion: 1,
			until: null,
		});
		check("ruční snooze může být bez časového omezení", response.status === 200, response);
		const [reminder] = await db
			.insert(reminders)
			.values({
				taskId: task.id,
				projectId: project.id,
				userId: member.id,
				type: "time",
				remindAt: new Date(Date.now() - 60_000),
				channel: "push",
			})
			.returning({ id: reminders.id });
		if (!reminder) throw new Error("availability reminder missing");
		await scanAndSendDue();
		let [held] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
		check(
			"snooze zadrží splatnou připomínku bez falešného delivery pokusu",
			held?.deliveryState === "held" && held.heldReason === "manual_snooze" && held.attempts === 0 && held.nextAttemptAt === null,
			held,
		);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/me/snooze`, "DELETE", {
			expectedVersion: 2,
		});
		check("vypnutí snooze vrátí zadržené připomínky do fronty", response.status === 200 && response.body.releasedReminders === 1, response);
		[held] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
		check("uvolněná připomínka je znovu pending bez hold metadat", held?.deliveryState === "pending" && !held.heldAt && !held.heldReason, held);

		await scanAndSendDue();
		[held] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
		check("aktivní Focus Time připomínku znovu korektně podrží", held?.deliveryState === "held" && held.heldReason === "focus" && held.attempts === 0, held);
		await db
			.update(reminders)
			.set({ attempts: 3, nextAttemptAt: new Date(Date.now() - 1_000) })
			.where(eq(reminders.id, reminder.id));
		await scanAndSendDue();
		[held] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
		check(
			"přechod mezi navazujícími holdy nesnižuje počet skutečných provider pokusů",
			held?.deliveryState === "held" && held.heldReason === "focus" && held.attempts === 3,
			held,
		);

		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks/${blockId}`, "PUT", {
			expectedVersion: 1,
			kind: "focus",
			startsAt,
			endsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
			timezone: "Europe/Prague",
			label: "Upravený focus",
			visibility: "private",
		});
		check(
			"autor upraví blok přes CAS a reminder se hned vrátí k novému vyhodnocení",
			response.status === 200 && response.body.releasedReminders === 1,
			response,
		);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks/${blockId}`, "DELETE", { expectedVersion: 1 });
		check("stará verze bloku se nezruší", response.status === 409, response);
		response = await request(memberCookie, `/api/workspaces/${workspace.id}/availability/blocks/${blockId}`, "DELETE", { expectedVersion: 2 });
		check("zrušení bloku je soft-delete a reminder zůstává uvolněný", response.status === 200, response);

		const spring = quietHoursHold(
			{ enabled: true, days: [7], startMinute: 0, endMinute: 150 },
			"Europe/Prague",
			new Date("2026-03-29T00:30:00.000Z"),
		);
		check(
			"quiet hours přes jarní DST mezeru skončí v první existující minutě",
			spring?.until?.toISOString() === "2026-03-29T01:00:00.000Z",
			spring,
		);

		let crossMembershipRejected = false;
		try {
			await db.insert(availabilityBlocks).values({
				workspaceId: workspace.id,
				userId: outsider.id,
				kind: "absence",
				startsAt: new Date(),
				endsAt: new Date(Date.now() + 60_000),
				timezone: "UTC",
			});
		} catch (error) {
			crossMembershipRejected = errorCode(error) === "23503";
		}
		check("DB nepřijme dostupnost člověka mimo workspace", crossMembershipRejected);
		let invalidJsonRejected = false;
		try {
			await db.execute(sql`
				UPDATE availability_profiles
				SET working_hours = ${JSON.stringify({ enabled: true, days: [{ day: 1, intervals: [{ startMinute: 800, endMinute: 700 }] }] })}::jsonb
				WHERE workspace_id = ${workspace.id} AND user_id = ${member.id}
			`);
		} catch (error) {
			invalidJsonRejected = errorCode(error) === "23514";
		}
		check("DB trigger odmítne neplatný rozvrh i mimo API", invalidJsonRejected);

		const audits = await db
			.select({ action: auditEvents.action })
			.from(auditEvents)
			.where(and(eq(auditEvents.workspaceId, workspace.id), sql`${auditEvents.entity} in ('availability_profiles', 'availability_blocks', 'availability_task_overrides')`));
		check(
			"profil, snooze, blok i nouzová výjimka mají audit",
			["create", "snooze_start", "snooze_stop", "update", "cancel", "emergency_override"].every((action) =>
				audits.some((audit) => audit.action === action),
			),
			audits,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, outsider.id));
		await db.delete(users).where(eq(users.id, workspaceManager.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, manager.id));
	}

	if (failed) throw new Error(`${failed} availability checks failed`);
	console.log("\nAvailability checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
