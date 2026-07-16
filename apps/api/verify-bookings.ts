/** Internal booking proof: ACL, atomic reservation, conflicts, CAS, privacy and audit. */
import "./src/env";
import {
	and,
	assignments,
	auditEvents,
	bookingPages,
	bookingReservations,
	bookingSlots,
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

const API = process.env.BOOKING_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};
function sqlState(error: unknown) {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; cause?: unknown };
		if (typeof value.code === "string") return value.code;
		current = value.cause;
	}
	return null;
}
async function login(email: string) {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as unknown as Array<{ identifier: string }>;
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

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createdUsers = await db
		.insert(users)
		.values([
			{ name: "Booking manager", email: `booking-manager-${stamp}@watson.test`, emailVerified: true },
			{ name: "Booking Alice", email: `booking-alice-${stamp}@watson.test`, emailVerified: true },
			{ name: "Booking Bob", email: `booking-bob-${stamp}@watson.test`, emailVerified: true },
			{ name: "Booking no project", email: `booking-no-project-${stamp}@watson.test`, emailVerified: true },
			{ name: "Booking outsider", email: `booking-outsider-${stamp}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	const [manager, alice, bob, noProject, outsider] = createdUsers;
	if (!manager || !alice || !bob || !noProject || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Booking ${stamp}`, ownerId: manager.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: alice.id, role: "member" },
		{ workspaceId: workspace.id, userId: bob.id, role: "member" },
		{ workspaceId: workspace.id, userId: noProject.id, role: "manager" },
	]);
	const [project] = await db
		.insert(projects)
		.values({ workspaceId: workspace.id, ownerId: manager.id, name: `Booking project ${stamp}` })
		.returning({ id: projects.id });
	if (!project) throw new Error("project missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: manager.id, role: "manager" },
		{ projectId: project.id, userId: alice.id, role: "editor" },
		{ projectId: project.id, userId: bob.id, role: "editor" },
	]);

	try {
		const managerCookie = await login(manager.email);
		const aliceCookie = await login(alice.email);
		const bobCookie = await login(bob.email);
		const noProjectCookie = await login(noProject.email);
		const outsiderCookie = await login(outsider.email);
		const startMs = Date.now() + 3 * 86_400_000;
		const startsAt = new Date(Math.ceil(startMs / 3_600_000) * 3_600_000).toISOString();
		const pageId = crypto.randomUUID();
		const slotId = crypto.randomUUID();
		const createBody = {
			id: pageId,
			title: "Interní konzultace",
			description: "Vyberte si jeden z nabízených časů.",
			durationMin: 30,
			timezone: "Europe/Prague",
			organizerId: manager.id,
			participantIds: [manager.id],
			slots: [{ id: slotId, startsAt }],
		};
		let response = await request(aliceCookie, `/api/projects/${project.id}/bookings`, "POST", {
			...createBody,
			id: crypto.randomUUID(),
			slots: [{ id: crypto.randomUUID(), startsAt }],
		});
		check("běžný editor nevytvoří týmovou nabídku", response.status === 403, response);
		response = await request(noProjectCookie, `/api/projects/${project.id}/bookings`, "POST", {
			...createBody,
			id: crypto.randomUUID(),
			slots: [{ id: crypto.randomUUID(), startsAt }],
		});
		check(
			"workspace manager bez role v restricted projektu nabídku nevytvoří",
			response.status === 404,
			response,
		);
		response = await request(managerCookie, `/api/projects/${project.id}/bookings`, "POST", {
			...createBody,
			timezone: "Mars/Olympus",
		});
		check("neexistující IANA zóna je odmítnuta", response.status === 422, response);
		response = await request(managerCookie, `/api/projects/${project.id}/bookings`, "POST", createBody);
		check("manager atomicky vytvoří nabídku i slot", response.status === 201, response);
		response = await request(managerCookie, `/api/projects/${project.id}/bookings`, "POST", createBody);
		check("create nabídky má přesný replay", response.status === 200, response);
		response = await request(managerCookie, `/api/projects/${project.id}/bookings`, "POST", {
			...createBody,
			title: "Jiný význam stejného ID",
		});
		check("ID nabídky nelze znovu použít s jiným obsahem", response.status === 409, response);
		response = await request(outsiderCookie, `/api/workspaces/${workspace.id}/bookings`);
		check("uživatel mimo workspace nabídky neuvidí", response.status === 403, response);
		response = await request(noProjectCookie, `/api/workspaces/${workspace.id}/bookings`);
		check(
			"člen bez projektového přístupu nabídku nedostane",
			response.status === 200 && Array.isArray(response.body.pages) && response.body.pages.length === 0,
			response,
		);

		const focusId = crypto.randomUUID();
		response = await request(managerCookie, `/api/workspaces/${workspace.id}/availability/blocks`, "POST", {
			id: focusId,
			kind: "focus",
			startsAt,
			endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
			timezone: "Europe/Prague",
			label: "Soukromý Focus",
			visibility: "private",
		});
		check("Focus fixture vznikla", response.status === 201, response);
		response = await request(aliceCookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", {
			reservationId: crypto.randomUUID(),
			meetingId: crypto.randomUUID(),
			hubTaskId: crypto.randomUUID(),
		});
		check(
			"rezervace respektuje Focus Time",
			response.status === 409 && response.body.error === "availability_conflict",
			response,
		);
		await request(managerCookie, `/api/workspaces/${workspace.id}/availability/blocks/${focusId}`, "DELETE", {
			expectedVersion: 1,
		});
		const [busyTask] = await db
			.insert(tasks)
			.values({
				projectId: project.id,
				name: "Kolizní práce",
				startDate: new Date(startsAt),
				startTimezone: "Europe/Prague",
				durationMin: 30,
				createdBy: manager.id,
			})
			.returning({ id: tasks.id });
		if (!busyTask) throw new Error("busy task missing");
		await db.insert(assignments).values({ taskId: busyTask.id, projectId: project.id, userId: manager.id });
		response = await request(aliceCookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", {
			reservationId: crypto.randomUUID(),
			meetingId: crypto.randomUUID(),
			hubTaskId: crypto.randomUUID(),
		});
		check(
			"rezervace nepřepíše obsazený kalendář",
			response.status === 409 && response.body.error === "schedule_conflict",
			response,
		);
		await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, busyTask.id));

		const commands = [alice, bob].map((user) => ({
			cookie: user.id === alice.id ? aliceCookie : bobCookie,
			body: {
				reservationId: crypto.randomUUID(),
				meetingId: crypto.randomUUID(),
				hubTaskId: crypto.randomUUID(),
			},
			userId: user.id,
		}));
		const concurrent = await Promise.all(
			commands.map((command) =>
				request(command.cookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", command.body),
			),
		);
		check(
			"dva souběžné kliky vytvoří právě jednu rezervaci",
			concurrent.map((entry) => entry.status).sort().join(",") === "201,409",
			concurrent,
		);
		const winnerIndex = concurrent.findIndex((entry) => entry.status === 201);
		const winner = commands[winnerIndex];
		const loser = commands[winnerIndex === 0 ? 1 : 0];
		if (!winner || !loser) throw new Error("winner missing");
		response = await request(winner.cookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", winner.body);
		check("rezervační command má přesný replay", response.status === 200, response);
		response = await request(winner.cookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", {
			...winner.body,
			meetingId: crypto.randomUUID(),
		});
		check("reservation ID s jiným payloadem je konflikt", response.status === 409, response);

		const active = await db
			.select()
			.from(bookingReservations)
			.where(and(eq(bookingReservations.slotId, slotId), sql`${bookingReservations.cancelledAt} is null`));
		const booked = active[0];
		const meeting = booked?.meetingId
			? (await db.select().from(meetings).where(eq(meetings.id, booked.meetingId)))[0]
			: undefined;
		const task = booked?.hubTaskId
			? (await db.select().from(tasks).where(eq(tasks.id, booked.hubTaskId)))[0]
			: undefined;
		const assignees = booked?.hubTaskId
			? await db.select().from(assignments).where(eq(assignments.taskId, booked.hubTaskId))
			: [];
		check(
			"reservation, meeting, hub a účastníci vzniknou atomicky",
			active.length === 1 && meeting?.hubTaskId === task?.id && task?.startDate?.toISOString() === startsAt && assignees.length === 2,
			{ active, meeting, task, assignees },
		);
		response = await request(loser.cookie, `/api/workspaces/${workspace.id}/bookings`);
		const loserPage = (response.body.pages as Array<Record<string, unknown>> | undefined)?.find(
			(page) => page.id === pageId,
		);
		const loserSlot = (loserPage?.slots as Array<Record<string, unknown>> | undefined)?.find(
			(slot) => slot.id === slotId,
		);
		check(
			"obsazený slot neprozradí cizímu členovi rezervujícího",
			loserSlot?.booked === true && loserSlot.reservation === null,
			response,
		);
		response = await request(managerCookie, `/api/workspaces/${workspace.id}/bookings`);
		const managerPage = (response.body.pages as Array<Record<string, unknown>> | undefined)?.find(
			(page) => page.id === pageId,
		);
		const managerSlot = (managerPage?.slots as Array<Record<string, unknown>> | undefined)?.find(
			(slot) => slot.id === slotId,
		);
		check(
			"správce vidí řízený detail rezervace",
			(managerSlot?.reservation as Record<string, unknown> | null)?.bookedBy === winner.userId,
			response,
		);
		response = await request(managerCookie, "/api/tasks/delete", "POST", {
			taskIds: [String(booked?.hubTaskId)],
			operationId: crypto.randomUUID(),
		});
		check(
			"aktivní rezervovaný meet nelze obejít obecným smazáním úkolu",
			response.status === 409 && response.body.error === "cancel_booking_first",
			response,
		);
		response = await request(loser.cookie, `/api/booking-reservations/${booked?.id}/cancel`, "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: 1,
		});
		check("jiný člen nezruší cizí rezervaci", response.status === 403, response);
		response = await request(managerCookie, `/api/bookings/${pageId}/slots/${slotId}`, "DELETE", {
			operationId: crypto.randomUUID(),
			expectedVersion: 1,
		});
		check("rezervovaný slot nelze stáhnout", response.status === 409, response);
		response = await request(managerCookie, "/api/meetings/plan", "POST", {
			meetingId: crypto.randomUUID(),
			hubTaskId: crypto.randomUUID(),
			workspaceId: workspace.id,
			projectId: project.id,
			title: "Kolizní ruční meet",
			dueDate: startsAt.slice(0, 10),
			startAt: startsAt,
			startTimezone: "Europe/Prague",
			durationMin: 30,
			participantIds: [manager.id],
		});
		check(
			"ruční meeting sdílí busy guard s bookingem",
			response.status === 409 && response.body.error === "schedule_conflict",
			response,
		);

		const cancelOperationId = crypto.randomUUID();
		const cancelBody = { operationId: cancelOperationId, expectedVersion: 1 };
		response = await request(winner.cookie, `/api/booking-reservations/${booked?.id}/cancel`, "POST", cancelBody);
		check("rezervující může budoucí rezervaci zrušit", response.status === 200, response);
		response = await request(winner.cookie, `/api/booking-reservations/${booked?.id}/cancel`, "POST", cancelBody);
		check("zrušení rezervace má přesný replay", response.status === 200, response);
		const cancelledMeeting = booked?.meetingId
			? (await db.select().from(meetings).where(eq(meetings.id, booked.meetingId)))[0]
			: undefined;
		const cancelledTask = booked?.hubTaskId
			? (await db.select().from(tasks).where(eq(tasks.id, booked.hubTaskId)))[0]
			: undefined;
		check(
			"zrušení zachová historii a deaktivuje meet",
			cancelledMeeting?.status === "cancelled" && cancelledTask?.completedAt != null,
			{ cancelledMeeting, cancelledTask },
		);
		const rebookBody = {
			reservationId: crypto.randomUUID(),
			meetingId: crypto.randomUUID(),
			hubTaskId: crypto.randomUUID(),
		};
		response = await request(loser.cookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", rebookBody);
		check("zrušený termín je znovu rezervovatelný", response.status === 201, response);
		const rebooked = response.body.reservation as Record<string, unknown> | undefined;
		response = await request(managerCookie, `/api/booking-reservations/${String(rebooked?.id)}/cancel`, "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: 1,
		});
		check("správce může zrušit rezervaci za účastníka", response.status === 200, response);

		const secondSlotId = crypto.randomUUID();
		const secondStartsAt = new Date(Date.parse(startsAt) + 2 * 3_600_000).toISOString();
		const addBody = {
			operationId: crypto.randomUUID(),
			expectedVersion: 1,
			slots: [{ id: secondSlotId, startsAt: secondStartsAt }],
		};
		response = await request(managerCookie, `/api/bookings/${pageId}/slots`, "POST", addBody);
		check("správce přidá slot přes CAS", response.status === 201, response);
		response = await request(managerCookie, `/api/bookings/${pageId}/slots`, "POST", addBody);
		check("přidání slotu má operation replay", response.status === 200, response);
		const cancelSlotBody = { operationId: crypto.randomUUID(), expectedVersion: 1 };
		response = await request(
			managerCookie,
			`/api/bookings/${pageId}/slots/${secondSlotId}`,
			"DELETE",
			cancelSlotBody,
		);
		check("neobsazený slot lze stáhnout", response.status === 200, response);
		response = await request(
			managerCookie,
			`/api/bookings/${pageId}/slots/${secondSlotId}`,
			"DELETE",
			cancelSlotBody,
		);
		check("stažení slotu má operation replay", response.status === 200, response);
		const archiveBody = { operationId: crypto.randomUUID(), expectedVersion: 2, archived: true };
		response = await request(managerCookie, `/api/bookings/${pageId}`, "PATCH", archiveBody);
		check("nabídku lze ukončit přes CAS", response.status === 200, response);
		response = await request(managerCookie, `/api/bookings/${pageId}`, "PATCH", archiveBody);
		check("update nabídky má operation replay", response.status === 200, response);
		response = await request(aliceCookie, `/api/bookings/${pageId}/slots/${slotId}/book`, "POST", {
			reservationId: crypto.randomUUID(),
			meetingId: crypto.randomUUID(),
			hubTaskId: crypto.randomUUID(),
		});
		check(
			"ukončená nabídka nevytvoří nový meet",
			response.status === 409 && response.body.error === "booking_slot_closed",
			response,
		);

		let rejectedTimezone = false;
		try {
			await db.insert(bookingPages).values({
				workspaceId: workspace.id,
				projectId: project.id,
				title: "Bad timezone",
				durationMin: 30,
				timezone: "Mars/Olympus",
				organizerId: manager.id,
				createdBy: manager.id,
			});
		} catch (error) {
			rejectedTimezone = sqlState(error) === "23514";
		}
		check("DB odmítne neexistující timezone i mimo API", rejectedTimezone);
		let rejectedDuration = false;
		try {
			await db.insert(bookingSlots).values({
				pageId,
				startsAt: new Date(Date.parse(startsAt) + 8 * 3_600_000),
				endsAt: new Date(Date.parse(startsAt) + 8 * 3_600_000 + 45 * 60_000),
			});
		} catch (error) {
			rejectedDuration = sqlState(error) === "23514";
		}
		check("DB odmítne slot s jinou délkou", rejectedDuration);

		response = await request(managerCookie, "/api/export");
		const exported = response.body.tables as Record<string, unknown[]> | undefined;
		check(
			"export obsahuje nabídky, sloty i historii rezervací",
			response.status === 200 &&
				(exported?.booking_pages?.length ?? 0) >= 1 &&
				(exported?.booking_slots?.length ?? 0) >= 2 &&
				(exported?.booking_reservations?.length ?? 0) >= 2,
			response,
		);
		const audit = await db
			.select({ action: auditEvents.action })
			.from(auditEvents)
			.where(eq(auditEvents.workspaceId, workspace.id));
		check(
			"create, book, cancel, sloty i update mají audit",
			["create", "book", "cancel", "add_slots", "update"].every((action) =>
				audit.some((row) => row.action === action),
			),
			audit,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db
			.delete(users)
			.where(
				sql`${users.id} IN (${sql.join(
					createdUsers.map((user) => sql`${user.id}`),
					sql`, `,
				)})`,
			);
	}
	if (failed > 0) {
		console.error(`\nBooking checks failed: ${failed}`);
		process.exit(1);
	}
	console.log("\nBooking checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
