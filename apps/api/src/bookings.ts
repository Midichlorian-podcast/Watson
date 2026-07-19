import {
	and,
	assignments,
	auditEvents,
	bookingPageParticipants,
	bookingPages,
	bookingReservations,
	bookingSlots,
	eq,
	getDb,
	inArray,
	meetings,
	projectMembers,
	sql,
	tasks,
} from "@watson/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { lockMeetingSchedule, readMeetingBusyConflicts } from "./meetingScheduling";
import { readTaskAvailabilityConflicts } from "./taskAvailability";

export const bookingRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const slotInput = z.object({ id: uuid, startsAt: z.string().datetime({ offset: true }) }).strict();
const slotList = z
	.array(slotInput)
	.min(1)
	.max(100)
	.superRefine((slots, ctx) => {
		const ids = new Set<string>();
		const instants = new Set<number>();
		for (const [index, slot] of slots.entries()) {
			if (ids.has(slot.id))
				ctx.addIssue({ code: "custom", path: [index, "id"], message: "duplicate_slot_id" });
			ids.add(slot.id);
			const instant = Date.parse(slot.startsAt);
			if (instants.has(instant))
				ctx.addIssue({ code: "custom", path: [index, "startsAt"], message: "duplicate_slot" });
			instants.add(instant);
		}
	});
const createSchema = z
	.object({
		id: uuid,
		title: z.string().trim().min(1).max(200),
		description: z.string().trim().max(2000).nullable().optional(),
		durationMin: z.number().int().min(5).max(1440),
		timezone: z.string().min(1).max(64),
		organizerId: uuid,
		participantIds: z.array(uuid).min(1).max(100),
		slots: slotList,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (new Set(value.participantIds).size !== value.participantIds.length) {
			ctx.addIssue({ code: "custom", path: ["participantIds"], message: "duplicate_participant" });
		}
		if (!value.participantIds.includes(value.organizerId)) {
			ctx.addIssue({ code: "custom", path: ["organizerId"], message: "organizer_required" });
		}
	});
const pagePatchSchema = z
	.object({
		operationId: uuid,
		expectedVersion: z.number().int().positive(),
		title: z.string().trim().min(1).max(200).optional(),
		description: z.string().trim().max(2000).nullable().optional(),
		archived: z.boolean().optional(),
	})
	.strict()
	.refine(
		(value) => value.title !== undefined || value.description !== undefined || value.archived !== undefined,
		"nothing_to_update",
	);
const addSlotsSchema = z
	.object({ operationId: uuid, expectedVersion: z.number().int().positive(), slots: slotList })
	.strict();
const slotCancelSchema = z
	.object({ operationId: uuid, expectedVersion: z.number().int().positive() })
	.strict();
const bookSchema = z
	.object({ reservationId: uuid, meetingId: uuid, hubTaskId: uuid })
	.strict();
const reservationCancelSchema = z
	.object({ operationId: uuid, expectedVersion: z.number().int().positive() })
	.strict();

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = Record<string, unknown>;

class BookingError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422,
		readonly detail?: unknown,
	) {
		super(code);
	}
}

function respondError(c: Context, error: unknown) {
	if (error instanceof BookingError) {
		return c.json(
			error.detail === undefined ? { error: error.code } : { error: error.code, detail: error.detail },
			error.status,
		);
	}
	throw error;
}

function validTimezone(timezone: string) {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(0);
		return true;
	} catch {
		return false;
	}
}

function validateFutureSlots(slots: z.infer<typeof slotList>, durationMin: number) {
	const now = Date.now() + 60_000;
	const horizon = Date.now() + 2 * 366 * 86_400_000;
	for (const slot of slots) {
		const start = Date.parse(slot.startsAt);
		const end = start + durationMin * 60_000;
		if (!Number.isFinite(start) || start < now || end > horizon) {
			throw new BookingError("invalid_booking_slot_time", 422);
		}
	}
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

async function commandHash(value: unknown) {
	const bytes = new TextEncoder().encode(canonical(value));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function operationReplay(
	tx: Tx,
	input: { entity: string; entityId: string; action: string; operationId: string; commandHash: string },
) {
	const rows = (await tx.execute(sql`
		SELECT diff FROM audit_events
		WHERE entity = ${input.entity} AND entity_id = ${input.entityId} AND action = ${input.action}
		  AND diff->>'operationId' = ${input.operationId}
		ORDER BY created_at DESC LIMIT 1
	`)) as unknown as Array<{ diff: Record<string, unknown> }>;
	if (!rows[0]) return false;
	if (rows[0].diff.commandHash !== input.commandHash) {
		throw new BookingError("operation_id_reused", 409);
	}
	return true;
}

type PageAccess = {
	id: string;
	workspace_id: string;
	project_id: string;
	title: string;
	description: string | null;
	duration_min: number;
	timezone: string;
	organizer_id: string;
	created_by: string | null;
	archived_at: Date | null;
	version: number;
	project_role: string | null;
	workspace_role: string | null;
	workspace_owner: boolean;
};

async function pageAccess(tx: Tx, pageId: string, userId: string): Promise<PageAccess> {
	const rows = (await tx.execute(sql`
		SELECT bp.*, pm.role::text AS project_role, wm.role::text AS workspace_role,
		       (w.owner_id = ${userId}) AS workspace_owner
		FROM booking_pages bp
		JOIN projects p ON p.id = bp.project_id
		JOIN workspaces w ON w.id = bp.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = bp.project_id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = bp.workspace_id AND wm.user_id = ${userId}
		WHERE bp.id = ${pageId}
		  AND (w.owner_id = ${userId} OR wm.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as PageAccess[];
	const page = rows[0];
	if (!page || page.project_role == null || page.workspace_role === "guest") {
		throw new BookingError("booking_not_found", 404);
	}
	return page;
}

function canManage(page: PageAccess, userId: string) {
	return (
		page.workspace_owner ||
		page.workspace_role === "admin" ||
		page.workspace_role === "manager" ||
		page.project_role === "manager" ||
		page.organizer_id === userId ||
		page.created_by === userId
	);
}

async function projectManagement(tx: Tx, projectId: string, userId: string) {
	const rows = (await tx.execute(sql`
		SELECT p.id AS project_id, p.workspace_id, pm.role::text AS project_role,
		       wm.role::text AS workspace_role, (w.owner_id = ${userId}) AS workspace_owner
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE p.id = ${projectId} AND (w.owner_id = ${userId} OR wm.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as Array<{
		project_id: string;
		workspace_id: string;
		project_role: string | null;
		workspace_role: string | null;
		workspace_owner: boolean;
	}>;
	const row = rows[0];
	if (!row) throw new BookingError("project_not_found", 404);
	// Workspace role sama nesmí odemknout restricted projekt. UI nabízí jen projekty,
	// kde má vedení současně právo editovat; server drží stejný fail-closed kontrakt.
	if (row.project_role !== "editor" && row.project_role !== "manager") {
		throw new BookingError("project_not_found", 404);
	}
	if (
		!(
			row.workspace_owner ||
			row.workspace_role === "admin" ||
			row.workspace_role === "manager" ||
			row.project_role === "manager"
		)
	) {
		throw new BookingError("forbidden", 403);
	}
	return row;
}

async function assertProjectMembers(tx: Tx, projectId: string, userIds: string[]) {
	const unique = [...new Set(userIds)];
	const rows = await tx
		.select({ userId: projectMembers.userId })
		.from(projectMembers)
		.where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, unique)));
	if (rows.length !== unique.length) throw new BookingError("participant_not_project_member", 422);
}

function dateInZone(date: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}

bookingRoutes.get("/api/workspaces/:workspaceId/bookings", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const db = getDb();
	const membership = (await db.execute(sql`
		SELECT m.role::text AS role FROM memberships m
		WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${session.user.id}
		UNION ALL
		SELECT 'owner' WHERE EXISTS (
			SELECT 1 FROM workspaces w WHERE w.id = ${workspaceId} AND w.owner_id = ${session.user.id}
		)
		LIMIT 1
	`)) as unknown as Array<{ role: string }>;
	if (!membership[0] || membership[0].role === "guest") return c.json({ error: "forbidden" }, 403);
	const pages = (await db.execute(sql`
		SELECT bp.*, p.name AS project_name,
		       COALESCE(NULLIF(trim(u.name), ''), u.email) AS organizer_name,
		       pm.role::text AS project_role, wm.role::text AS workspace_role,
		       (w.owner_id = ${session.user.id}) AS workspace_owner
		FROM booking_pages bp
		JOIN projects p ON p.id = bp.project_id
		JOIN users u ON u.id = bp.organizer_id
		JOIN workspaces w ON w.id = bp.workspace_id
		JOIN project_members pm ON pm.project_id = bp.project_id AND pm.user_id = ${session.user.id}
		LEFT JOIN memberships wm ON wm.workspace_id = bp.workspace_id AND wm.user_id = ${session.user.id}
		WHERE bp.workspace_id = ${workspaceId}
		ORDER BY bp.archived_at NULLS FIRST, bp.created_at DESC
	`)) as unknown as Array<PageAccess & { project_name: string; organizer_name: string }>;
	if (pages.length === 0) return c.json({ pages: [] });
	const pageIds = pages.map((page) => page.id);
	const participants = (await db.execute(sql`
		SELECT bpp.page_id, bpp.user_id,
		       COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
		FROM booking_page_participants bpp JOIN users u ON u.id = bpp.user_id
		WHERE bpp.page_id = ANY(${sql`ARRAY[${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})
		ORDER BY u.name, bpp.user_id
	`)) as unknown as Array<{ page_id: string; user_id: string; name: string }>;
	const slots = (await db.execute(sql`
		SELECT bs.*, br.id AS reservation_id, br.booked_by, br.version AS reservation_version,
		       br.meeting_id, COALESCE(NULLIF(trim(bu.name), ''), bu.email) AS booked_by_name
		FROM booking_slots bs
		LEFT JOIN booking_reservations br ON br.slot_id = bs.id AND br.cancelled_at IS NULL
		LEFT JOIN users bu ON bu.id = br.booked_by
		WHERE bs.page_id = ANY(${sql`ARRAY[${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})
		  AND bs.cancelled_at IS NULL
		ORDER BY bs.starts_at
	`)) as unknown as Array<Row>;
	return c.json({
		pages: pages.map((page) => {
			const manage = canManage(page, session.user.id);
			return {
				id: page.id,
				workspaceId: page.workspace_id,
				projectId: page.project_id,
				projectName: page.project_name,
				title: page.title,
				description: page.description,
				durationMin: page.duration_min,
				timezone: page.timezone,
				organizerId: page.organizer_id,
				organizerName: page.organizer_name,
				archivedAt: page.archived_at,
				version: page.version,
				canManage: manage,
				participants: participants
					.filter((participant) => participant.page_id === page.id)
					.map((participant) => ({ id: participant.user_id, name: participant.name })),
				slots: slots
					.filter((slot) => slot.page_id === page.id)
					.map((slot) => {
						const mine = slot.booked_by === session.user.id;
						return {
							id: String(slot.id),
							startsAt: new Date(String(slot.starts_at)).toISOString(),
							endsAt: new Date(String(slot.ends_at)).toISOString(),
							version: Number(slot.version),
							booked: slot.reservation_id != null,
							reservation:
								mine || manage
									? {
										id: slot.reservation_id,
										version: slot.reservation_version,
										bookedBy: slot.booked_by,
										bookedByName: slot.booked_by_name,
										meetingId: slot.meeting_id,
									}
									: null,
						};
					}),
			};
		}),
	});
});

bookingRoutes.post("/api/projects/:projectId/bookings", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const projectId = c.req.param("projectId");
	if (!uuid.safeParse(projectId).success) return c.json({ error: "invalid_project_id" }, 422);
	const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_booking" }, 422);
	if (!validTimezone(parsed.data.timezone)) return c.json({ error: "invalid_timezone" }, 422);
	try {
		validateFutureSlots(parsed.data.slots, parsed.data.durationMin);
		const participantIds = [...parsed.data.participantIds].sort();
		const hash = await commandHash({ ...parsed.data, participantIds, slots: [...parsed.data.slots].sort((a, b) => a.id.localeCompare(b.id)) });
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-page:${parsed.data.id}`}, 0))`);
			const access = await projectManagement(tx, projectId, session.user.id);
			for (const slotId of parsed.data.slots.map((slot) => slot.id).sort()) {
				await tx.execute(
					sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-slot-id:${slotId}`}, 0))`,
				);
			}
			const existing = await tx.select().from(bookingPages).where(eq(bookingPages.id, parsed.data.id)).limit(1);
			if (existing[0]) {
				const audit = (await tx.execute(sql`
					SELECT diff FROM audit_events WHERE entity = 'booking_pages'
					  AND entity_id = ${parsed.data.id} AND action = 'create'
					ORDER BY created_at DESC LIMIT 1
				`)) as unknown as Array<{ diff: Record<string, unknown> }>;
				if (audit[0]?.diff.commandHash !== hash) throw new BookingError("booking_id_reused", 409);
				return { page: existing[0], replayed: true };
			}
			const reusedSlots = (await tx.execute(sql`
				SELECT id FROM booking_slots
				WHERE id = ANY(${sql`ARRAY[${sql.join(parsed.data.slots.map((slot) => sql`${slot.id}`), sql`, `)}]::uuid[]`})
				LIMIT 1
			`)) as unknown as Row[];
			if (reusedSlots[0]) throw new BookingError("booking_slot_id_reused", 409);
			await assertProjectMembers(tx, projectId, participantIds);
			const [page] = await tx
				.insert(bookingPages)
				.values({
					id: parsed.data.id,
					workspaceId: access.workspace_id,
					projectId,
					title: parsed.data.title,
					description: parsed.data.description ?? null,
					durationMin: parsed.data.durationMin,
					timezone: parsed.data.timezone,
					organizerId: parsed.data.organizerId,
					createdBy: session.user.id,
				})
				.returning();
			if (!page) throw new Error("booking_page_insert_failed");
			await tx.insert(bookingPageParticipants).values(
				participantIds.map((userId) => ({ pageId: page.id, projectId, userId })),
			);
			await tx.insert(bookingSlots).values(
				parsed.data.slots.map((slot) => ({
					id: slot.id,
					pageId: page.id,
					startsAt: new Date(slot.startsAt),
					endsAt: new Date(Date.parse(slot.startsAt) + page.durationMin * 60_000),
				})),
			);
			await tx.insert(auditEvents).values({
				workspaceId: page.workspaceId,
				actorUserId: session.user.id,
				entity: "booking_pages",
				entityId: page.id,
				action: "create",
				diff: { commandHash: hash, projectId, participantCount: participantIds.length, slotCount: parsed.data.slots.length },
				requestId: c.get("requestId"),
			});
			return { page, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		return respondError(c, error);
	}
});

bookingRoutes.patch("/api/bookings/:pageId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pageId = c.req.param("pageId");
	if (!uuid.safeParse(pageId).success) return c.json({ error: "invalid_booking_id" }, 422);
	const parsed = pagePatchSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_booking_patch" }, 422);
	try {
		const hash = await commandHash(parsed.data);
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-page:${pageId}`}, 0))`);
			const access = await pageAccess(tx, pageId, session.user.id);
			if (!canManage(access, session.user.id)) throw new BookingError("forbidden", 403);
			if (await operationReplay(tx, { entity: "booking_pages", entityId: pageId, action: "update", operationId: parsed.data.operationId, commandHash: hash })) {
				return { replayed: true };
			}
			if (access.version !== parsed.data.expectedVersion) throw new BookingError("stale_booking", 409);
			const [page] = await tx
				.update(bookingPages)
				.set({
					...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
					...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
					...(parsed.data.archived === undefined ? {} : { archivedAt: parsed.data.archived ? new Date() : null }),
					version: access.version + 1,
				})
				.where(and(eq(bookingPages.id, pageId), eq(bookingPages.version, access.version)))
				.returning();
			if (!page) throw new BookingError("stale_booking", 409);
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorUserId: session.user.id,
				entity: "booking_pages",
				entityId: pageId,
				action: "update",
				diff: { operationId: parsed.data.operationId, commandHash: hash, version: page.version, archived: parsed.data.archived ?? null },
				requestId: c.get("requestId"),
			});
			return { page, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		return respondError(c, error);
	}
});

bookingRoutes.post("/api/bookings/:pageId/slots", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pageId = c.req.param("pageId");
	if (!uuid.safeParse(pageId).success) return c.json({ error: "invalid_booking_id" }, 422);
	const parsed = addSlotsSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_booking_slots" }, 422);
	try {
		const hash = await commandHash(parsed.data);
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-page:${pageId}`}, 0))`);
			const access = await pageAccess(tx, pageId, session.user.id);
			if (!canManage(access, session.user.id)) throw new BookingError("forbidden", 403);
			for (const slotId of parsed.data.slots.map((slot) => slot.id).sort()) {
				await tx.execute(
					sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-slot-id:${slotId}`}, 0))`,
				);
			}
			if (await operationReplay(tx, { entity: "booking_pages", entityId: pageId, action: "add_slots", operationId: parsed.data.operationId, commandHash: hash })) {
				return { replayed: true };
			}
			if (access.archived_at) throw new BookingError("booking_archived", 409);
			if (access.version !== parsed.data.expectedVersion) throw new BookingError("stale_booking", 409);
			validateFutureSlots(parsed.data.slots, access.duration_min);
			const reusedSlots = (await tx.execute(sql`
				SELECT id FROM booking_slots
				WHERE id = ANY(${sql`ARRAY[${sql.join(parsed.data.slots.map((slot) => sql`${slot.id}`), sql`, `)}]::uuid[]`})
				LIMIT 1
			`)) as unknown as Row[];
			if (reusedSlots[0]) throw new BookingError("booking_slot_id_reused", 409);
			await tx.insert(bookingSlots).values(parsed.data.slots.map((slot) => ({ id: slot.id, pageId, startsAt: new Date(slot.startsAt), endsAt: new Date(Date.parse(slot.startsAt) + access.duration_min * 60_000) })));
			await tx.update(bookingPages).set({ version: access.version + 1 }).where(eq(bookingPages.id, pageId));
			await tx.insert(auditEvents).values({ workspaceId: access.workspace_id, actorUserId: session.user.id, entity: "booking_pages", entityId: pageId, action: "add_slots", diff: { operationId: parsed.data.operationId, commandHash: hash, slotCount: parsed.data.slots.length, version: access.version + 1 }, requestId: c.get("requestId") });
			return { replayed: false, version: access.version + 1 };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		return respondError(c, error);
	}
});

bookingRoutes.delete("/api/bookings/:pageId/slots/:slotId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pageId = c.req.param("pageId");
	const slotId = c.req.param("slotId");
	if (!uuid.safeParse(pageId).success || !uuid.safeParse(slotId).success) return c.json({ error: "invalid_booking_slot_id" }, 422);
	const parsed = slotCancelSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_booking_slot_cancel" }, 422);
	try {
		const hash = await commandHash(parsed.data);
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-slot:${slotId}`}, 0))`);
			const access = await pageAccess(tx, pageId, session.user.id);
			if (!canManage(access, session.user.id)) throw new BookingError("forbidden", 403);
			if (await operationReplay(tx, { entity: "booking_slots", entityId: slotId, action: "cancel", operationId: parsed.data.operationId, commandHash: hash })) return { replayed: true };
			const [slot] = await tx.select().from(bookingSlots).where(and(eq(bookingSlots.id, slotId), eq(bookingSlots.pageId, pageId))).limit(1);
			if (!slot) throw new BookingError("booking_slot_not_found", 404);
			if (slot.version !== parsed.data.expectedVersion) throw new BookingError("stale_booking_slot", 409);
			const active = await tx.select({ id: bookingReservations.id }).from(bookingReservations).where(and(eq(bookingReservations.slotId, slotId), sql`${bookingReservations.cancelledAt} is null`)).limit(1);
			if (active[0]) throw new BookingError("booking_slot_reserved", 409);
			await tx.update(bookingSlots).set({ cancelledAt: new Date(), version: slot.version + 1 }).where(eq(bookingSlots.id, slotId));
			await tx.insert(auditEvents).values({ workspaceId: access.workspace_id, actorUserId: session.user.id, entity: "booking_slots", entityId: slotId, action: "cancel", diff: { operationId: parsed.data.operationId, commandHash: hash, pageId }, requestId: c.get("requestId") });
			return { replayed: false };
		});
		return c.json(result);
	} catch (error) {
		return respondError(c, error);
	}
});

bookingRoutes.post("/api/bookings/:pageId/slots/:slotId/book", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pageId = c.req.param("pageId");
	const slotId = c.req.param("slotId");
	if (!uuid.safeParse(pageId).success || !uuid.safeParse(slotId).success) return c.json({ error: "invalid_booking_slot_id" }, 422);
	const parsed = bookSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_booking_reservation" }, 422);
	try {
		const hash = await commandHash({ ...parsed.data, pageId, slotId, bookedBy: session.user.id });
		const result = await getDb().transaction(async (tx) => {
			const access = await pageAccess(tx, pageId, session.user.id);
			const [slot] = await tx.select().from(bookingSlots).where(and(eq(bookingSlots.id, slotId), eq(bookingSlots.pageId, pageId))).limit(1);
			if (!slot) throw new BookingError("booking_slot_not_found", 404);
			const participantRows = await tx.select({ userId: bookingPageParticipants.userId }).from(bookingPageParticipants).where(eq(bookingPageParticipants.pageId, pageId));
			const participantIds = [...new Set([...participantRows.map((row) => row.userId), session.user.id])].sort();
			await lockMeetingSchedule(tx, { workspaceId: access.workspace_id, meetingId: parsed.data.meetingId, participantIds, startsAt: slot.startsAt, endsAt: slot.endsAt, extraKeys: [`booking-reservation:${parsed.data.reservationId}`, `booking-slot:${slotId}`, `task-id:${parsed.data.hubTaskId}`] });
			const [existing] = await tx.select().from(bookingReservations).where(eq(bookingReservations.id, parsed.data.reservationId)).limit(1);
			if (existing) {
				const audit = (await tx.execute(sql`SELECT diff FROM audit_events WHERE entity = 'booking_reservations' AND entity_id = ${existing.id} AND action = 'book' ORDER BY created_at DESC LIMIT 1`)) as unknown as Array<{ diff: Record<string, unknown> }>;
				if (existing.pageId !== pageId || existing.slotId !== slotId || existing.bookedBy !== session.user.id || existing.meetingId !== parsed.data.meetingId || existing.hubTaskId !== parsed.data.hubTaskId || audit[0]?.diff.commandHash !== hash) throw new BookingError("reservation_id_reused", 409);
				return { reservation: existing, replayed: true };
			}
			const reusedCommandIds = (await tx.execute(sql`
				SELECT 1 FROM meetings WHERE id = ${parsed.data.meetingId}
				UNION ALL SELECT 1 FROM tasks WHERE id = ${parsed.data.hubTaskId}
				UNION ALL SELECT 1 FROM booking_reservations
				WHERE meeting_id = ${parsed.data.meetingId} OR hub_task_id = ${parsed.data.hubTaskId}
				LIMIT 1
			`)) as unknown as Row[];
			if (reusedCommandIds[0]) throw new BookingError("booking_command_id_reused", 409);
			if (access.archived_at || slot.cancelledAt) throw new BookingError("booking_slot_closed", 409);
			if (slot.startsAt.getTime() <= Date.now()) throw new BookingError("booking_slot_expired", 409);
			const active = await tx.select({ id: bookingReservations.id }).from(bookingReservations).where(and(eq(bookingReservations.slotId, slotId), sql`${bookingReservations.cancelledAt} is null`)).limit(1);
			if (active[0]) throw new BookingError("booking_slot_taken", 409);
			await assertProjectMembers(tx, access.project_id, participantIds);
			const policy = (await tx.execute(sql`SELECT task_conflict_policy FROM workspaces WHERE id = ${access.workspace_id} LIMIT 1`)) as unknown as Array<{ task_conflict_policy: string }>;
			const availability = await readTaskAvailabilityConflicts(tx, { workspaceId: access.workspace_id, policy: policy[0]?.task_conflict_policy === "strict" ? "strict" : "warning", actorUserId: session.user.id, taskId: parsed.data.hubTaskId, startsAt: slot.startsAt, durationMin: access.duration_min, assigneeIds: participantIds });
			if (!availability.canSchedule) throw new BookingError("availability_conflict", 409, { availability });
			const busy = await readMeetingBusyConflicts(tx, { workspaceId: access.workspace_id, participantIds, startsAt: slot.startsAt, endsAt: slot.endsAt, excludeTaskId: parsed.data.hubTaskId });
			if (busy.length > 0) throw new BookingError("schedule_conflict", 409, { conflicts: busy });
			await tx.insert(tasks).values({ id: parsed.data.hubTaskId, projectId: access.project_id, name: access.title, priority: 4, dueDate: new Date(`${dateInZone(slot.startsAt, access.timezone)}T00:00:00.000Z`), startDate: slot.startsAt, startTimezone: access.timezone, durationMin: access.duration_min, assignmentMode: participantIds.length > 1 ? "shared_all" : "single", kind: "meeting", meetingId: parsed.data.meetingId, createdBy: session.user.id });
			await tx.insert(meetings).values({ id: parsed.data.meetingId, workspaceId: access.workspace_id, title: access.title, status: "scheduled", hubTaskId: parsed.data.hubTaskId, createdBy: session.user.id });
			await tx.insert(assignments).values(participantIds.map((userId) => ({ taskId: parsed.data.hubTaskId, projectId: access.project_id, userId })));
			const [reservation] = await tx.insert(bookingReservations).values({ id: parsed.data.reservationId, pageId, slotId, projectId: access.project_id, bookedBy: session.user.id, meetingId: parsed.data.meetingId, hubTaskId: parsed.data.hubTaskId }).returning();
			if (!reservation) throw new Error("booking_reservation_insert_failed");
			await tx.insert(auditEvents).values([
				{ workspaceId: access.workspace_id, actorUserId: session.user.id, entity: "meetings", entityId: parsed.data.meetingId, action: "plan_from_booking", diff: { bookingPageId: pageId, bookingSlotId: slotId, participantCount: participantIds.length }, requestId: c.get("requestId") },
				{ workspaceId: access.workspace_id, actorUserId: session.user.id, entity: "booking_reservations", entityId: reservation.id, action: "book", diff: { commandHash: hash, pageId, slotId, meetingId: parsed.data.meetingId, hubTaskId: parsed.data.hubTaskId, participantCount: participantIds.length }, requestId: c.get("requestId") },
			]);
			return { reservation, replayed: false, warnings: availability.conflicts.filter((conflict) => !conflict.blocking) };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		return respondError(c, error);
	}
});

bookingRoutes.post("/api/booking-reservations/:reservationId/cancel", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const reservationId = c.req.param("reservationId");
	if (!uuid.safeParse(reservationId).success) return c.json({ error: "invalid_reservation_id" }, 422);
	const parsed = reservationCancelSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_reservation_cancel" }, 422);
	try {
		const hash = await commandHash(parsed.data);
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-reservation:${reservationId}`}, 0))`);
			const [reservation] = await tx.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId)).limit(1);
			if (!reservation) throw new BookingError("reservation_not_found", 404);
			const access = await pageAccess(tx, reservation.pageId, session.user.id);
			if (reservation.bookedBy !== session.user.id && !canManage(access, session.user.id)) throw new BookingError("forbidden", 403);
			if (await operationReplay(tx, { entity: "booking_reservations", entityId: reservationId, action: "cancel", operationId: parsed.data.operationId, commandHash: hash })) return { replayed: true };
			if (reservation.version !== parsed.data.expectedVersion || reservation.cancelledAt) throw new BookingError("stale_reservation", 409);
			const [slot] = await tx.select().from(bookingSlots).where(eq(bookingSlots.id, reservation.slotId)).limit(1);
			if (!slot || slot.startsAt.getTime() <= Date.now()) throw new BookingError("reservation_already_started", 409);
			if (reservation.meetingId) {
				const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, reservation.meetingId)).limit(1);
				if (meeting && meeting.status !== "scheduled" && meeting.status !== "new") throw new BookingError("meeting_already_processed", 409);
				await tx.update(meetings).set({ status: "cancelled" }).where(eq(meetings.id, reservation.meetingId));
			}
			if (reservation.hubTaskId) await tx.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, reservation.hubTaskId));
			const [cancelled] = await tx.update(bookingReservations).set({ cancelledAt: new Date(), cancelledBy: session.user.id, version: reservation.version + 1 }).where(and(eq(bookingReservations.id, reservationId), eq(bookingReservations.version, reservation.version))).returning();
			if (!cancelled) throw new BookingError("stale_reservation", 409);
			await tx.insert(auditEvents).values({ workspaceId: access.workspace_id, actorUserId: session.user.id, entity: "booking_reservations", entityId: reservationId, action: "cancel", diff: { operationId: parsed.data.operationId, commandHash: hash, slotId: reservation.slotId, meetingId: reservation.meetingId }, requestId: c.get("requestId") });
			return { reservation: cancelled, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		return respondError(c, error);
	}
});
