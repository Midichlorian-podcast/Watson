/** Server-authoritative working hours, quiet hours, snooze and availability blocks. */
import {
	and,
	auditEvents,
	availabilityBlocks,
	availabilityProfiles,
	DEFAULT_QUIET_HOURS,
	DEFAULT_WORKING_HOURS,
	eq,
	getDb,
	isNull,
	memberships,
	sql,
	users,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import {
	availabilityKindSchema,
	isValidTimeZone,
	isWithinWorkingHours,
	normalizeQuietHours,
	normalizeWorkingHours,
	quietHoursHold,
	quietHoursSchema,
	workingHoursSchema,
} from "./availabilityPolicy";

export const availabilityRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const profileSchema = z
	.object({
		expectedVersion: z.number().int().min(0),
		timezone: z.string().min(1).max(64),
		workingHours: workingHoursSchema,
		quietHours: quietHoursSchema,
	})
	.strict();
const snoozeSchema = z
	.object({ expectedVersion: z.number().int().min(0), until: z.string().datetime({ offset: true }).nullable() })
	.strict();
const clearSnoozeSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
const rangeSchema = z
	.object({
		from: z.string().datetime({ offset: true }),
		to: z.string().datetime({ offset: true }),
	})
	.refine((value) => Date.parse(value.from) < Date.parse(value.to), "invalid_range")
	.refine(
		(value) => Date.parse(value.to) - Date.parse(value.from) <= 366 * 86_400_000,
		"range_too_large",
	);
const blockFields = {
	kind: availabilityKindSchema,
	startsAt: z.string().datetime({ offset: true }),
	endsAt: z.string().datetime({ offset: true }),
	timezone: z.string().min(1).max(64),
	label: z.string().trim().max(160).nullable().optional(),
	visibility: z.enum(["team", "private"]).default("team"),
} as const;
const validateBlockRange = (
	value: { startsAt: string; endsAt: string },
	ctx: z.RefinementCtx,
) => {
		const startsAt = Date.parse(value.startsAt);
		const endsAt = Date.parse(value.endsAt);
		if (endsAt <= startsAt) ctx.addIssue({ code: "custom", message: "invalid_range" });
		if (endsAt - startsAt > 366 * 86_400_000) {
			ctx.addIssue({ code: "custom", message: "block_too_long" });
		}
	};
const createBlockSchema = z.object({ ...blockFields, id: uuid }).strict().superRefine(validateBlockRange);
const updateBlockSchema = z
	.object({ ...blockFields, expectedVersion: z.number().int().min(1) })
	.strict()
	.superRefine(validateBlockRange);
const cancelBlockSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

type Db = ReturnType<typeof getDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function hasWorkspaceAccess(db: Db | DbTx, workspaceId: string, userId: string) {
	const rows = await db
		.select({ id: memberships.id })
		.from(memberships)
		.where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
	return rows.length > 0;
}

/** Serializuje první create i globální timezone zápis jednoho člověka. */
async function lockAvailabilityProfile(tx: DbTx, userId: string) {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`availability-profile:${userId}`}, 0))`,
	);
}

function defaultProfile(workspaceId: string, userId: string) {
	return {
		id: null,
		workspaceId,
		userId,
		workingHours: structuredClone(DEFAULT_WORKING_HOURS),
		quietHours: structuredClone(DEFAULT_QUIET_HOURS),
		manualSnoozeStartedAt: null,
		manualSnoozeUntil: null,
		version: 0,
		createdAt: null,
		updatedAt: null,
	};
}

function manualSnoozeActive(
	profile: Pick<
		typeof availabilityProfiles.$inferSelect,
		"manualSnoozeStartedAt" | "manualSnoozeUntil"
	>,
	now: Date,
) {
	return Boolean(
		profile.manualSnoozeStartedAt &&
		(!profile.manualSnoozeUntil || profile.manualSnoozeUntil.getTime() > now.getTime()),
	);
}

const BLOCK_PRIORITY = { focus: 4, absence: 3, unavailable: 2, holiday: 1 } as const;

/** Uvolní zadržené připomínky v prostoru; worker znovu ověří případný jiný aktivní hold. */
async function releaseHeldReminders(tx: DbTx, workspaceId: string, userId: string, now: Date) {
	const released = await tx.execute(sql`
		UPDATE reminders r
		SET delivery_state = 'pending', held_at = NULL, held_reason = NULL,
		    claimed_at = NULL, next_attempt_at = ${now.toISOString()}::timestamptz,
		    last_error_code = NULL
		FROM projects p
		WHERE p.id = r.project_id
		  AND p.workspace_id = ${workspaceId}
		  AND r.user_id = ${userId}
		  AND r.delivery_state = 'held'
		RETURNING r.id
	`);
	return released.length;
}

availabilityRoutes.get("/api/workspaces/:workspaceId/availability", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const now = new Date();
	const parsed = rangeSchema.safeParse({
		from: c.req.query("from") ?? new Date(now.getTime() - 7 * 86_400_000).toISOString(),
		to: c.req.query("to") ?? new Date(now.getTime() + 90 * 86_400_000).toISOString(),
	});
	if (!parsed.success) return c.json({ error: "invalid_availability_range" }, 422);
	const from = new Date(parsed.data.from);
	const to = new Date(parsed.data.to);
	const db = getDb();
	if (!(await hasWorkspaceAccess(db, workspaceId, session.user.id))) {
		return c.json({ error: "forbidden" }, 403);
	}

	const memberRows = await db
		.select({
			userId: users.id,
			name: users.name,
			image: users.image,
			timezone: users.timezone,
		})
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(eq(memberships.workspaceId, workspaceId));
	const profiles = await db
		.select()
		.from(availabilityProfiles)
		.where(eq(availabilityProfiles.workspaceId, workspaceId));
	const blocks = await db
		.select()
		.from(availabilityBlocks)
		.where(
			and(
				eq(availabilityBlocks.workspaceId, workspaceId),
				isNull(availabilityBlocks.cancelledAt),
				sql`${availabilityBlocks.startsAt} < ${to.toISOString()}::timestamptz`,
				sql`${availabilityBlocks.endsAt} > ${from.toISOString()}::timestamptz`,
			),
		);
	const profileByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
	const currentBlocks = blocks.filter(
		(block) => block.startsAt.getTime() <= now.getTime() && block.endsAt.getTime() > now.getTime(),
	);

	return c.json({
		generatedAt: now.toISOString(),
		range: parsed.data,
		members: memberRows.map((member) => {
			const profile = profileByUser.get(member.userId) ?? defaultProfile(workspaceId, member.userId);
			const activeBlock = currentBlocks
				.filter((block) => block.userId === member.userId)
				.sort(
					(left, right) =>
						BLOCK_PRIORITY[right.kind as keyof typeof BLOCK_PRIORITY] -
						BLOCK_PRIORITY[left.kind as keyof typeof BLOCK_PRIORITY] ||
						right.endsAt.getTime() - left.endsAt.getTime(),
				)[0];
			const manual = manualSnoozeActive(profile, now);
			const quiet = quietHoursHold(profile.quietHours, member.timezone, now);
			const status = manual
				? {
						kind: "manual_snooze" as const,
						until: profile.manualSnoozeUntil?.toISOString() ?? null,
						label: null,
					}
				: activeBlock
					? {
							kind: activeBlock.kind,
							until: activeBlock.endsAt.toISOString(),
							label:
								activeBlock.visibility === "team" || activeBlock.userId === session.user.id
									? activeBlock.label
									: null,
						}
					: quiet
						? { kind: quiet.reason, until: quiet.until?.toISOString() ?? null, label: null }
						: null;
			return {
				...member,
				profile,
				status,
				withinWorkingHours: isWithinWorkingHours(profile.workingHours, member.timezone, now),
			};
		}),
		blocks: blocks.map((block) => ({
			...block,
			label:
				block.visibility === "team" || block.userId === session.user.id ? block.label : null,
		})),
	});
});

availabilityRoutes.put("/api/workspaces/:workspaceId/availability/me", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !isValidTimeZone(parsed.data?.timezone ?? "")) {
		return c.json({ error: "invalid_availability_profile", issues: parsed.success ? undefined : parsed.error.issues }, 422);
	}
	const workingHours = normalizeWorkingHours(parsed.data.workingHours);
	const quietHours = normalizeQuietHours(parsed.data.quietHours);
	const db = getDb();
	const result = await db.transaction(async (tx) => {
		if (!(await hasWorkspaceAccess(tx, workspaceId, session.user.id))) return { error: "forbidden" as const };
		await lockAvailabilityProfile(tx, session.user.id);
		const [before] = await tx
			.select()
			.from(availabilityProfiles)
			.where(
				and(
					eq(availabilityProfiles.workspaceId, workspaceId),
					eq(availabilityProfiles.userId, session.user.id),
				),
			);
		if ((before?.version ?? 0) !== parsed.data.expectedVersion) {
			return { error: "stale_profile" as const, currentVersion: before?.version ?? 0 };
		}
		let profile: typeof availabilityProfiles.$inferSelect | undefined;
		if (before) {
			[profile] = await tx
				.update(availabilityProfiles)
				.set({ workingHours, quietHours, version: before.version + 1, updatedAt: new Date() })
				.where(
					and(eq(availabilityProfiles.id, before.id), eq(availabilityProfiles.version, before.version)),
				)
				.returning();
			if (!profile) return { error: "stale_profile" as const, currentVersion: before.version };
		} else {
			[profile] = await tx
				.insert(availabilityProfiles)
				.values({ workspaceId, userId: session.user.id, workingHours, quietHours })
				.returning();
		}
		await tx.update(users).set({ timezone: parsed.data.timezone, updatedAt: new Date() }).where(eq(users.id, session.user.id));
		const releasedReminders = await releaseHeldReminders(tx, workspaceId, session.user.id, new Date());
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "availability_profiles",
			entityId: profile?.id ?? session.user.id,
			action: before ? "update" : "create",
			before: before ? { timezone: session.user.timezone, ...before } : null,
			diff: {
				timezone: parsed.data.timezone,
				workingHours,
				quietHours,
				version: profile?.version,
				releasedReminders,
			},
			requestId: c.get("requestId"),
		});
		return { profile, timezone: parsed.data.timezone, releasedReminders };
	});
	if ("error" in result) {
		return c.json(result, result.error === "forbidden" ? 403 : 409);
	}
	return c.json(result);
});

availabilityRoutes.put("/api/workspaces/:workspaceId/availability/me/snooze", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const parsed = snoozeSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_snooze" }, 422);
	const now = new Date();
	const until = parsed.data.until ? new Date(parsed.data.until) : null;
	if (until && (until <= now || until.getTime() - now.getTime() > 366 * 86_400_000)) {
		return c.json({ error: "invalid_snooze_until" }, 422);
	}
	const db = getDb();
	const result = await db.transaction(async (tx) => {
		if (!(await hasWorkspaceAccess(tx, workspaceId, session.user.id))) return { error: "forbidden" as const };
		await lockAvailabilityProfile(tx, session.user.id);
		const [before] = await tx
			.select()
			.from(availabilityProfiles)
			.where(and(eq(availabilityProfiles.workspaceId, workspaceId), eq(availabilityProfiles.userId, session.user.id)));
		if ((before?.version ?? 0) !== parsed.data.expectedVersion) {
			return { error: "stale_profile" as const, currentVersion: before?.version ?? 0 };
		}
		let profile: typeof availabilityProfiles.$inferSelect | undefined;
		if (before) {
			[profile] = await tx
				.update(availabilityProfiles)
				.set({
					manualSnoozeStartedAt: now,
					manualSnoozeUntil: until,
					version: before.version + 1,
					updatedAt: now,
				})
				.where(and(eq(availabilityProfiles.id, before.id), eq(availabilityProfiles.version, before.version)))
				.returning();
		} else {
			[profile] = await tx
				.insert(availabilityProfiles)
				.values({
					workspaceId,
					userId: session.user.id,
					manualSnoozeStartedAt: now,
					manualSnoozeUntil: until,
				})
				.returning();
		}
		if (!profile) return { error: "stale_profile" as const, currentVersion: before?.version ?? 0 };
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "availability_profiles",
			entityId: profile.id,
			action: "snooze_start",
			before: before ? { manualSnoozeStartedAt: before.manualSnoozeStartedAt, manualSnoozeUntil: before.manualSnoozeUntil } : null,
			diff: { until: until?.toISOString() ?? null, version: profile.version },
			requestId: c.get("requestId"),
		});
		return { profile };
	});
	if ("error" in result) return c.json(result, result.error === "forbidden" ? 403 : 409);
	return c.json(result);
});

availabilityRoutes.delete("/api/workspaces/:workspaceId/availability/me/snooze", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const parsed = clearSnoozeSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_snooze_clear" }, 422);
	const db = getDb();
	const now = new Date();
	const result = await db.transaction(async (tx) => {
		if (!(await hasWorkspaceAccess(tx, workspaceId, session.user.id))) return { error: "forbidden" as const };
		await lockAvailabilityProfile(tx, session.user.id);
		const [before] = await tx
			.select()
			.from(availabilityProfiles)
			.where(and(eq(availabilityProfiles.workspaceId, workspaceId), eq(availabilityProfiles.userId, session.user.id)));
		if (!before) return { error: "profile_not_found" as const };
		if (before.version !== parsed.data.expectedVersion) {
			return { error: "stale_profile" as const, currentVersion: before.version };
		}
		const [profile] = await tx
			.update(availabilityProfiles)
			.set({ manualSnoozeStartedAt: null, manualSnoozeUntil: null, version: before.version + 1, updatedAt: now })
			.where(and(eq(availabilityProfiles.id, before.id), eq(availabilityProfiles.version, before.version)))
			.returning();
		if (!profile) return { error: "stale_profile" as const, currentVersion: before.version };
		const releasedReminders = await releaseHeldReminders(tx, workspaceId, session.user.id, now);
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "availability_profiles",
			entityId: profile.id,
			action: "snooze_stop",
			before: { manualSnoozeStartedAt: before.manualSnoozeStartedAt, manualSnoozeUntil: before.manualSnoozeUntil },
			diff: { version: profile.version, releasedReminders },
			requestId: c.get("requestId"),
		});
		return { profile, releasedReminders };
	});
	if ("error" in result) {
		const status = result.error === "forbidden" ? 403 : result.error === "profile_not_found" ? 404 : 409;
		return c.json(result, status);
	}
	return c.json(result);
});

availabilityRoutes.post("/api/workspaces/:workspaceId/availability/blocks", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const parsed = createBlockSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !isValidTimeZone(parsed.data?.timezone ?? "")) {
		return c.json({ error: "invalid_availability_block", issues: parsed.success ? undefined : parsed.error.issues }, 422);
	}
	if (new Date(parsed.data.endsAt) <= new Date()) return c.json({ error: "availability_block_already_ended" }, 422);
	const db = getDb();
	const result = await db.transaction(async (tx) => {
		if (!(await hasWorkspaceAccess(tx, workspaceId, session.user.id))) return { error: "forbidden" as const };
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`availability-block:${parsed.data.id}`}, 0))`,
		);
		const [existing] = await tx.select().from(availabilityBlocks).where(eq(availabilityBlocks.id, parsed.data.id));
		if (existing) {
			const same =
				existing.workspaceId === workspaceId &&
				existing.userId === session.user.id &&
				existing.kind === parsed.data.kind &&
				existing.startsAt.toISOString() === new Date(parsed.data.startsAt).toISOString() &&
				existing.endsAt.toISOString() === new Date(parsed.data.endsAt).toISOString() &&
				existing.timezone === parsed.data.timezone &&
				(existing.label ?? null) === (parsed.data.label || null) &&
				existing.visibility === parsed.data.visibility;
			return same ? { block: existing, replayed: true } : { error: "block_id_reused" as const };
		}
		const [block] = await tx
			.insert(availabilityBlocks)
			.values({
				id: parsed.data.id,
				workspaceId,
				userId: session.user.id,
				kind: parsed.data.kind,
				startsAt: new Date(parsed.data.startsAt),
				endsAt: new Date(parsed.data.endsAt),
				timezone: parsed.data.timezone,
				label: parsed.data.label || null,
				visibility: parsed.data.visibility,
				createdBy: session.user.id,
			})
			.returning();
		if (!block) throw new Error("availability_block_insert_failed");
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "availability_blocks",
			entityId: block.id,
			action: "create",
			diff: { ...parsed.data, source: "manual", userId: session.user.id },
			requestId: c.get("requestId"),
		});
		return { block, replayed: false };
	});
	if ("error" in result) return c.json(result, result.error === "forbidden" ? 403 : 409);
	return c.json(result, result.replayed ? 200 : 201);
});

availabilityRoutes.put("/api/workspaces/:workspaceId/availability/blocks/:blockId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	const blockId = c.req.param("blockId");
	if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(blockId).success) return c.json({ error: "invalid_id" }, 422);
	const parsed = updateBlockSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !isValidTimeZone(parsed.data?.timezone ?? "")) return c.json({ error: "invalid_availability_block" }, 422);
	if (new Date(parsed.data.endsAt) <= new Date()) {
		return c.json({ error: "availability_block_already_ended" }, 422);
	}
	const db = getDb();
	const result = await db.transaction(async (tx) => {
		if (!(await hasWorkspaceAccess(tx, workspaceId, session.user.id))) return { error: "forbidden" as const };
		const [before] = await tx.select().from(availabilityBlocks).where(eq(availabilityBlocks.id, blockId));
		if (!before || before.workspaceId !== workspaceId || before.userId !== session.user.id) return { error: "block_not_found" as const };
		if (before.source !== "manual" || before.cancelledAt) return { error: "block_not_editable" as const };
		if (before.version !== parsed.data.expectedVersion) return { error: "stale_block" as const, currentVersion: before.version };
		const [block] = await tx
			.update(availabilityBlocks)
			.set({
				kind: parsed.data.kind,
				startsAt: new Date(parsed.data.startsAt),
				endsAt: new Date(parsed.data.endsAt),
				timezone: parsed.data.timezone,
				label: parsed.data.label || null,
				visibility: parsed.data.visibility,
				version: before.version + 1,
				updatedAt: new Date(),
			})
			.where(and(eq(availabilityBlocks.id, blockId), eq(availabilityBlocks.version, before.version)))
			.returning();
		if (!block) return { error: "stale_block" as const, currentVersion: before.version };
		const releasedReminders = await releaseHeldReminders(tx, workspaceId, session.user.id, new Date());
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "availability_blocks",
			entityId: block.id,
			action: "update",
			before,
			diff: { ...parsed.data, version: block.version, releasedReminders },
			requestId: c.get("requestId"),
		});
		return { block, releasedReminders };
	});
	if ("error" in result) {
		const status = result.error === "forbidden" ? 403 : result.error === "block_not_found" ? 404 : 409;
		return c.json(result, status);
	}
	return c.json(result);
});

availabilityRoutes.delete("/api/workspaces/:workspaceId/availability/blocks/:blockId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("workspaceId");
	const blockId = c.req.param("blockId");
	if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(blockId).success) return c.json({ error: "invalid_id" }, 422);
	const parsed = cancelBlockSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_block_cancel" }, 422);
	const db = getDb();
	const now = new Date();
	const result = await db.transaction(async (tx) => {
		if (!(await hasWorkspaceAccess(tx, workspaceId, session.user.id))) return { error: "forbidden" as const };
		const [before] = await tx.select().from(availabilityBlocks).where(eq(availabilityBlocks.id, blockId));
		if (!before || before.workspaceId !== workspaceId || before.userId !== session.user.id) return { error: "block_not_found" as const };
		if (before.source !== "manual") return { error: "block_not_editable" as const };
		if (before.cancelledAt) return { block: before, releasedReminders: 0, replayed: true };
		if (before.version !== parsed.data.expectedVersion) return { error: "stale_block" as const, currentVersion: before.version };
		const [block] = await tx
			.update(availabilityBlocks)
			.set({ cancelledAt: now, version: before.version + 1, updatedAt: now })
			.where(and(eq(availabilityBlocks.id, blockId), eq(availabilityBlocks.version, before.version)))
			.returning();
		if (!block) return { error: "stale_block" as const, currentVersion: before.version };
		const releasedReminders = await releaseHeldReminders(tx, workspaceId, session.user.id, now);
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "availability_blocks",
			entityId: block.id,
			action: "cancel",
			before,
			diff: { cancelledAt: now.toISOString(), version: block.version, releasedReminders },
			requestId: c.get("requestId"),
		});
		return { block, releasedReminders, replayed: false };
	});
	if ("error" in result) {
		const status = result.error === "forbidden" ? 403 : result.error === "block_not_found" ? 404 : 409;
		return c.json(result, status);
	}
	return c.json(result);
});

/** Used by the reminder worker; kept here to make hold/release semantics one source of truth. */
export async function readNotificationHold(
	db: Db,
	workspaceId: string,
	userId: string,
	now: Date,
) {
	const [profile] = await db
		.select({
			manualSnoozeStartedAt: availabilityProfiles.manualSnoozeStartedAt,
			manualSnoozeUntil: availabilityProfiles.manualSnoozeUntil,
			quietHours: availabilityProfiles.quietHours,
			timezone: users.timezone,
		})
		.from(users)
		.leftJoin(
			availabilityProfiles,
			and(
				eq(availabilityProfiles.userId, users.id),
				eq(availabilityProfiles.workspaceId, workspaceId),
			),
		)
		.where(eq(users.id, userId));
	if (!profile) return null;
	if (
		profile.manualSnoozeStartedAt &&
		(!profile.manualSnoozeUntil || profile.manualSnoozeUntil.getTime() > now.getTime())
	) {
		return { reason: "manual_snooze" as const, until: profile.manualSnoozeUntil };
	}
	const activeBlocks = await db
		.select({ kind: availabilityBlocks.kind, endsAt: availabilityBlocks.endsAt })
		.from(availabilityBlocks)
		.where(
			and(
				eq(availabilityBlocks.workspaceId, workspaceId),
				eq(availabilityBlocks.userId, userId),
				isNull(availabilityBlocks.cancelledAt),
				sql`${availabilityBlocks.startsAt} <= ${now.toISOString()}::timestamptz`,
				sql`${availabilityBlocks.endsAt} > ${now.toISOString()}::timestamptz`,
			),
		);
	const block = activeBlocks.sort(
		(left, right) =>
			BLOCK_PRIORITY[right.kind as keyof typeof BLOCK_PRIORITY] -
				BLOCK_PRIORITY[left.kind as keyof typeof BLOCK_PRIORITY] ||
			right.endsAt.getTime() - left.endsAt.getTime(),
	)[0];
	if (block) {
		return {
			reason: block.kind as "focus" | "unavailable" | "absence" | "holiday",
			until: block.endsAt,
		};
	}
	return quietHoursHold(profile.quietHours ?? DEFAULT_QUIET_HOURS, profile.timezone, now);
}
