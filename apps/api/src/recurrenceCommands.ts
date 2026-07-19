import { getDb, sql } from "@watson/db";
import {
	calendarDayDistance,
	dateInTimeZone,
	expandOccurrences,
	nextValidZonedDateTimeToIso,
	parseRecurrenceRule,
	previousRecurrenceDate,
	RECURRENCE_EDIT_SCOPES,
	recurrenceIndexOfDate,
	shiftCalendarDate,
	transformRecurrenceRule,
	wallTimeFromInstant,
	zonedDateTimeToIso,
} from "@watson/shared";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { readTaskAvailabilityConflicts } from "./taskAvailability";

export const recurrenceCommandRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleSchema = z
	.object({
		date: calendarDate,
		time: wallTime.nullable(),
		timeZone: z.string().min(1).max(64).nullable(),
		durationMin: z.number().int().min(1).max(10_080).nullable(),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.time === null) !== (value.timeZone === null)) {
			context.addIssue({ code: "custom", path: ["timeZone"], message: "time_zone_pair" });
		}
		if (value.time === null && value.durationMin !== null) {
			context.addIssue({ code: "custom", path: ["durationMin"], message: "all_day_duration" });
		}
	});
const previewSchema = z
	.object({
		occurrenceDate: calendarDate,
		scope: z.enum(RECURRENCE_EDIT_SCOPES),
		schedule: scheduleSchema,
		dstPolicy: z.enum(["reject", "next_valid"]).default("reject"),
	})
	.strict();
const executeSchema = previewSchema
	.extend({ operationId: z.string().min(1).max(128), previewHash: z.string().length(64) })
	.strict();
const undoSchema = z.object({ batchId: uuid }).strict();

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Rows = Record<string, unknown>[];
type PreviewInput = z.infer<typeof previewSchema>;

type TaskContext = {
	id: string;
	name: string;
	projectId: string;
	workspaceId: string;
	policy: "warning" | "strict";
	dueDate: string | null;
	startDate: string | null;
	startTimezone: string | null;
	durationMin: number | null;
	deadline: string | null;
	recurrenceRule: string;
	updatedAt: string;
};

type OverrideSnapshot = {
	exists: boolean;
	id: string | null;
	overrideDueDate: string | null;
	overrideStartDate: string | null;
	overrideStartTimezone: string | null;
	overrideDurationMin: number | null;
	version: number;
};

type EffectiveSchedule = {
	date: string;
	time: string | null;
	timeZone: string | null;
	startsAt: string | null;
	durationMin: number | null;
};

type TaskScheduleSnapshot = {
	dueDate: string | null;
	startDate: string | null;
	startTimezone: string | null;
	durationMin: number | null;
	recurrenceRule: string;
	updatedAt: string;
};

type PrefixSnapshot = {
	id: string;
	anchorDate: string;
	endDate: string;
	recurrenceRule: string;
	startDate: string | null;
	startTimezone: string | null;
	durationMin: number | null;
	version: number;
};

type PrefixDraft = Omit<PrefixSnapshot, "id" | "version">;

type SeriesMutation = {
	nextTask: Omit<TaskScheduleSnapshot, "updatedAt">;
	prefix: PrefixDraft | null;
	affectedFrom: string;
	preservedPrefixOccurrences: number;
};

type SeriesBatchSnapshot = {
	kind: "series";
	task: TaskScheduleSnapshot;
	prefix: PrefixSnapshot | null;
	occurrenceOverridesHash: string;
};

type OccurrenceBatchSnapshot = { kind: "occurrence"; override: OverrideSnapshot };

type SeriesOccurrenceSnapshot = OverrideSnapshot & {
	occurrenceDate: string;
	done: boolean;
	skipped: boolean;
	updatedAt: string;
};

class RecurrenceCommandError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 410 | 422 = 422,
	) {
		super(code);
	}
}

function asIso(value: unknown): string | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asDate(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return String(value).slice(0, 10);
}

function isCalendarDate(value: string): boolean {
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function sha256(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function snapshot(row: Record<string, unknown> | undefined): OverrideSnapshot {
	if (!row) {
		return {
			exists: false,
			id: null,
			overrideDueDate: null,
			overrideStartDate: null,
			overrideStartTimezone: null,
			overrideDurationMin: null,
			version: 0,
		};
	}
	return {
		exists: true,
		id: String(row.id),
		overrideDueDate: asDate(row.override_due_date),
		overrideStartDate: asIso(row.override_start_date),
		overrideStartTimezone:
			row.override_start_timezone == null ? null : String(row.override_start_timezone),
		overrideDurationMin:
			row.override_duration_min == null ? null : Number(row.override_duration_min),
		version: Number(row.version ?? 1),
	};
}

function taskScheduleSnapshot(task: TaskContext): TaskScheduleSnapshot {
	return {
		dueDate: task.dueDate,
		startDate: task.startDate,
		startTimezone: task.startTimezone,
		durationMin: task.durationMin,
		recurrenceRule: task.recurrenceRule,
		updatedAt: task.updatedAt,
	};
}

function prefixSnapshot(row: Record<string, unknown>): PrefixSnapshot {
	return {
		id: String(row.id),
		anchorDate: asDate(row.anchor_date) ?? "",
		endDate: asDate(row.end_date) ?? "",
		recurrenceRule: String(row.recurrence_rule),
		startDate: asIso(row.start_date),
		startTimezone: row.start_timezone == null ? null : String(row.start_timezone),
		durationMin: row.duration_min == null ? null : Number(row.duration_min),
		version: Number(row.version ?? 1),
	};
}

function sameTaskSchedule(a: TaskScheduleSnapshot, b: TaskScheduleSnapshot): boolean {
	return (
		a.dueDate === b.dueDate &&
		a.startDate === b.startDate &&
		a.startTimezone === b.startTimezone &&
		a.durationMin === b.durationMin &&
		a.recurrenceRule === b.recurrenceRule &&
		a.updatedAt === b.updatedAt
	);
}

function samePrefix(a: PrefixSnapshot, b: PrefixSnapshot): boolean {
	return (
		a.id === b.id &&
		a.anchorDate === b.anchorDate &&
		a.endDate === b.endDate &&
		a.recurrenceRule === b.recurrenceRule &&
		a.startDate === b.startDate &&
		a.startTimezone === b.startTimezone &&
		a.durationMin === b.durationMin &&
		a.version === b.version
	);
}

function seriesOccurrenceSnapshot(row: Record<string, unknown>): SeriesOccurrenceSnapshot {
	return {
		...snapshot(row),
		occurrenceDate: asDate(row.occ_date) ?? "",
		done: row.done === true,
		skipped: row.skipped === true,
		updatedAt: asIso(row.updated_at) ?? "",
	};
}

async function readSeriesOccurrences(
	tx: Tx,
	taskId: string,
	lock: boolean,
): Promise<SeriesOccurrenceSnapshot[]> {
	const rows = (await tx.execute(sql`
		SELECT id, occ_date, done, skipped, override_due_date, override_start_date,
		       override_start_timezone, override_duration_min, version, updated_at
		FROM task_occurrence_overrides
		WHERE task_id = ${taskId}
		ORDER BY occ_date, id
		${lock ? sql`FOR UPDATE` : sql``}
	`)) as unknown as Rows;
	return rows.map(seriesOccurrenceSnapshot);
}

async function taskContext(
	tx: Tx,
	taskId: string,
	userId: string,
	lock: boolean,
): Promise<TaskContext> {
	const rows = (await tx.execute(sql`
		SELECT t.id, t.name, t.project_id, p.workspace_id, p.visibility::text AS visibility,
		       w.owner_id, w.task_conflict_policy, pm.role::text AS project_role,
		       wm.role::text AS workspace_role, t.due_date, t.start_date,
		       t.start_timezone, t.duration_min, t.deadline, t.recurrence_rule, t.updated_at
		FROM tasks t
		JOIN projects p ON p.id = t.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE t.id = ${taskId}
		LIMIT 1
		${lock ? sql`FOR UPDATE OF t` : sql``}
	`)) as unknown as Rows;
	const row = rows[0];
	const workspaceOwner = row?.owner_id === userId;
	const workspaceMember = workspaceOwner || row?.workspace_role != null;
	const canView =
		workspaceMember && (row?.visibility !== "restricted" || row?.project_role != null);
	if (!row || !canView) throw new RecurrenceCommandError("task_not_found", 404);
	const canEdit =
		workspaceOwner ||
		row.workspace_role === "admin" ||
		row.project_role === "editor" ||
		row.project_role === "manager";
	if (!canEdit) throw new RecurrenceCommandError("forbidden", 403);
	if (!row.recurrence_rule || !parseRecurrenceRule(String(row.recurrence_rule))) {
		throw new RecurrenceCommandError("task_is_not_recurring", 409);
	}
	return {
		id: String(row.id),
		name: String(row.name),
		projectId: String(row.project_id),
		workspaceId: String(row.workspace_id),
		policy: row.task_conflict_policy === "strict" ? "strict" : "warning",
		dueDate: asDate(row.due_date),
		startDate: asIso(row.start_date),
		startTimezone: row.start_timezone == null ? null : String(row.start_timezone),
		durationMin: row.duration_min == null ? null : Number(row.duration_min),
		deadline: asDate(row.deadline),
		recurrenceRule: String(row.recurrence_rule),
		updatedAt: asIso(row.updated_at) ?? "",
	};
}

function seriesBaseDate(task: TaskContext): string | null {
	if (task.dueDate) return task.dueDate;
	if (task.startDate && task.startTimezone) {
		return dateInTimeZone(task.startTimezone, new Date(task.startDate));
	}
	return task.startDate?.slice(0, 10) ?? null;
}

function occursOn(task: TaskContext, occurrenceDate: string): boolean {
	const rule = parseRecurrenceRule(task.recurrenceRule);
	const baseDate = seriesBaseDate(task);
	if (!rule || !baseDate) return false;
	return expandOccurrences({
		baseISO: baseDate,
		kind: rule.kind,
		weekday: rule.weekday,
		nth: rule.nth,
		day: rule.day,
		parity: rule.parity,
		fromISO: occurrenceDate,
		toISO: occurrenceDate,
		cap: 1,
		until: rule.until,
		count: rule.count,
		doneCount: rule.doneCount,
		showAll: true,
	}).includes(occurrenceDate);
}

function occursInPrefix(prefix: PrefixSnapshot, occurrenceDate: string): boolean {
	if (occurrenceDate < prefix.anchorDate || occurrenceDate > prefix.endDate) return false;
	const rule = parseRecurrenceRule(prefix.recurrenceRule);
	return rule !== null && recurrenceIndexOfDate(prefix.anchorDate, rule, occurrenceDate) !== null;
}

function inheritedStart(
	source: Pick<TaskContext, "startDate" | "startTimezone">,
	date: string,
): string | null {
	if (!source.startDate || !source.startTimezone) return null;
	const time = wallTimeFromInstant(source.startDate, source.startTimezone);
	return time
		? nextValidZonedDateTimeToIso(date, time, source.startTimezone)
		: null;
}

function effectiveCurrentSchedule(
	source: Pick<TaskContext, "startDate" | "startTimezone" | "durationMin">,
	override: OverrideSnapshot,
	occurrenceDate: string,
): EffectiveSchedule {
	const hasScheduleOverride = override.overrideDueDate !== null;
	const startsAt = hasScheduleOverride
		? override.overrideStartDate
		: inheritedStart(source, occurrenceDate);
	const timeZone = startsAt
		? hasScheduleOverride
			? override.overrideStartTimezone
			: source.startTimezone
		: null;
	return {
		date: override.overrideDueDate ?? occurrenceDate,
		time: startsAt && timeZone ? wallTimeFromInstant(startsAt, timeZone)?.slice(0, 5) ?? null : null,
		timeZone,
		startsAt,
		durationMin: startsAt ? override.overrideDurationMin ?? source.durationMin : null,
	};
}

function proposedSchedule(input: PreviewInput): EffectiveSchedule & { dstAdjusted: boolean } {
	if (!isCalendarDate(input.schedule.date)) {
		throw new RecurrenceCommandError("invalid_schedule_date");
	}
	if (input.schedule.time === null || input.schedule.timeZone === null) {
		return {
			date: input.schedule.date,
			time: null,
			timeZone: null,
			startsAt: null,
			durationMin: null,
			dstAdjusted: false,
		};
	}
	const exact = zonedDateTimeToIso(
		input.schedule.date,
		input.schedule.time,
		input.schedule.timeZone,
	);
	const startsAt =
		exact ??
		(input.dstPolicy === "next_valid"
			? nextValidZonedDateTimeToIso(
					input.schedule.date,
					input.schedule.time,
					input.schedule.timeZone,
				)
			: null);
	if (!startsAt) throw new RecurrenceCommandError("invalid_or_nonexistent_local_time");
	return {
		date: input.schedule.date,
		time:
			wallTimeFromInstant(startsAt, input.schedule.timeZone)?.slice(0, 5) ??
			input.schedule.time,
		timeZone: input.schedule.timeZone,
		startsAt,
		durationMin: input.schedule.durationMin,
		dstAdjusted: exact === null,
	};
}

function startForSeriesBase(
	date: string,
	proposed: EffectiveSchedule,
	dstPolicy: PreviewInput["dstPolicy"],
): string | null {
	if (!proposed.time || !proposed.timeZone) return null;
	const exact = zonedDateTimeToIso(date, proposed.time, proposed.timeZone);
	const startsAt =
		exact ??
		(dstPolicy === "next_valid"
			? nextValidZonedDateTimeToIso(date, proposed.time, proposed.timeZone)
			: null);
	if (!startsAt) throw new RecurrenceCommandError("invalid_or_nonexistent_series_anchor_time");
	return startsAt;
}

function buildSeriesMutation(
	task: TaskContext,
	input: PreviewInput,
	current: EffectiveSchedule,
	proposed: EffectiveSchedule,
): SeriesMutation | null {
	if (input.scope === "this_occurrence") return null;
	const baseDate = seriesBaseDate(task);
	const rule = parseRecurrenceRule(task.recurrenceRule);
	if (!baseDate || !rule) throw new RecurrenceCommandError("task_is_not_recurring", 409);
	const selectedIndex = recurrenceIndexOfDate(baseDate, rule, input.occurrenceDate);
	if (selectedIndex === null) throw new RecurrenceCommandError("occurrence_not_in_series", 409);
	const shiftDays = calendarDayDistance(current.date, proposed.date);
	const affectedFrom = input.scope === "all" ? baseDate : input.occurrenceDate;
	const nextDueDate = input.scope === "all" ? shiftCalendarDate(baseDate, shiftDays) : proposed.date;
	const remainingCount =
		input.scope === "this_and_future" && rule.count != null
			? rule.count - rule.doneCount - selectedIndex
			: undefined;
	if (remainingCount !== undefined && remainingCount < 1) {
		throw new RecurrenceCommandError("series_has_no_remaining_occurrences", 409);
	}
	const nextRule = transformRecurrenceRule(task.recurrenceRule, proposed.date, {
		shiftUntilDays: shiftDays,
		remainingCount,
	});
	if (!nextRule) throw new RecurrenceCommandError("invalid_recurrence_rule", 409);
	const nextStartDate =
		input.scope === "this_and_future"
			? proposed.startsAt
			: startForSeriesBase(nextDueDate, proposed, input.dstPolicy);
	const previousDate =
		input.scope === "this_and_future"
			? previousRecurrenceDate(baseDate, rule, input.occurrenceDate)
			: null;
	return {
		nextTask: {
			dueDate: nextDueDate,
			startDate: nextStartDate,
			startTimezone: nextStartDate ? proposed.timeZone : null,
			durationMin: nextStartDate ? proposed.durationMin : null,
			recurrenceRule: nextRule,
		},
		prefix: previousDate
			? {
					anchorDate: baseDate,
					endDate: previousDate,
					recurrenceRule: task.recurrenceRule,
					startDate: task.startDate,
					startTimezone: task.startTimezone,
					durationMin: task.startDate ? task.durationMin : null,
				}
			: null,
		affectedFrom,
		preservedPrefixOccurrences: input.scope === "this_and_future" ? selectedIndex : 0,
	};
}

function sameSchedule(a: EffectiveSchedule, b: EffectiveSchedule): boolean {
	return (
		a.date === b.date &&
		a.startsAt === b.startsAt &&
		a.timeZone === b.timeZone &&
		a.durationMin === b.durationMin
	);
}

async function readOverride(
	tx: Tx,
	taskId: string,
	occurrenceDate: string,
	lock: boolean,
): Promise<OverrideSnapshot> {
	const rows = (await tx.execute(sql`
		SELECT id, override_due_date, override_start_date, override_start_timezone,
		       override_duration_min, version
		FROM task_occurrence_overrides
		WHERE task_id = ${taskId} AND occ_date = ${occurrenceDate}
		LIMIT 1
		${lock ? sql`FOR UPDATE` : sql``}
	`)) as unknown as Rows;
	return snapshot(rows[0]);
}

type RecurrencePlan = {
	task: TaskContext;
	override: OverrideSnapshot;
	current: EffectiveSchedule;
	proposed: EffectiveSchedule & { dstAdjusted: boolean };
	series: SeriesMutation | null;
	prefixes: PrefixSnapshot[];
	conflicts: Array<{ code: string; detail?: unknown }>;
	warnings: string[];
	availability: Awaited<ReturnType<typeof readTaskAvailabilityConflicts>>;
	previewHash: string;
};

async function buildPlan(
	tx: Tx,
	taskId: string,
	userId: string,
	input: PreviewInput,
	lock = false,
): Promise<RecurrencePlan> {
	if (!isCalendarDate(input.occurrenceDate)) {
		throw new RecurrenceCommandError("invalid_occurrence_date");
	}
	const task = await taskContext(tx, taskId, userId, lock);
	const prefixRows = (await tx.execute(sql`
		SELECT id, anchor_date, end_date, recurrence_rule, start_date, start_timezone,
		       duration_min, version
		FROM task_recurrence_prefixes WHERE task_id = ${taskId} ORDER BY anchor_date
		${lock ? sql`FOR UPDATE` : sql``}
	`)) as unknown as Rows;
	const prefixes = prefixRows.map(prefixSnapshot);
	const historicalPrefix = prefixes.find((prefix) =>
		occursInPrefix(prefix, input.occurrenceDate),
	);
	if (!occursOn(task, input.occurrenceDate) && !historicalPrefix) {
		throw new RecurrenceCommandError("occurrence_not_in_series", 409);
	}
	const override = await readOverride(tx, taskId, input.occurrenceDate, lock);
	const current = effectiveCurrentSchedule(
		historicalPrefix ?? task,
		override,
		input.occurrenceDate,
	);
	const proposed = proposedSchedule(input);
	const series = historicalPrefix ? null : buildSeriesMutation(task, input, current, proposed);
	const conflicts: Array<{ code: string; detail?: unknown }> = [];
	const warnings: string[] = [];
	if (historicalPrefix && input.scope !== "this_occurrence") {
		conflicts.push({ code: "historical_segment_scope_unsupported" });
	}

	if (
		input.scope === "this_occurrence" &&
		input.schedule.date !== input.occurrenceDate &&
		(occursOn(task, input.schedule.date) ||
			prefixes.some((prefix) => occursInPrefix(prefix, input.schedule.date)))
	) {
		warnings.push("target_contains_series_occurrence");
	}
	const collisionRows = (await tx.execute(sql`
		SELECT occ_date FROM task_occurrence_overrides
		WHERE task_id = ${taskId}
		  AND occ_date <> ${input.occurrenceDate}
		  AND override_due_date = ${input.schedule.date}::date
		LIMIT 1
	`)) as unknown as Rows;
	if (input.scope === "this_occurrence" && collisionRows[0]) {
		warnings.push("target_contains_rescheduled_occurrence");
	}
	if (series) {
		const prefixDraft = series.prefix;
		if (
			prefixDraft &&
			prefixes.some(
				(prefix) =>
					prefix.anchorDate <= prefixDraft.endDate && prefix.endDate >= prefixDraft.anchorDate,
			)
		) {
			conflicts.push({ code: "series_history_overlap" });
		}
		if (task.deadline && series.nextTask.dueDate && series.nextTask.dueDate > task.deadline) {
			conflicts.push({ code: "deadline_before_series_anchor", detail: { deadline: task.deadline } });
		}
		const exceptionRows = (await tx.execute(sql`
			SELECT occ_date FROM task_occurrence_overrides
			WHERE task_id = ${taskId} AND occ_date >= ${series.affectedFrom}
			LIMIT 1
		`)) as unknown as Rows;
		if (exceptionRows[0]) {
			conflicts.push({
				code: "series_has_future_exceptions",
				detail: { firstOccurrenceDate: String(exceptionRows[0].occ_date) },
			});
		}
		if (series.preservedPrefixOccurrences > 0) warnings.push("earlier_occurrences_preserved");
		if (prefixes.length > 0) warnings.push("previous_series_segments_preserved");
		if (series.nextTask.startDate) warnings.push("series_availability_first_occurrence_only");
	}
	if (sameSchedule(current, proposed)) warnings.push("no_schedule_change");

	const assigneeRows = (await tx.execute(sql`
		SELECT user_id FROM assignments WHERE task_id = ${taskId} ORDER BY user_id
	`)) as unknown as Rows;
	const availability = await readTaskAvailabilityConflicts(tx, {
		workspaceId: task.workspaceId,
		policy: task.policy,
		actorUserId: userId,
		taskId,
		startsAt: series?.nextTask.startDate
			? new Date(series.nextTask.startDate)
			: series
				? null
				: proposed.startsAt
					? new Date(proposed.startsAt)
					: null,
		durationMin: series?.nextTask.durationMin ?? proposed.durationMin,
		assigneeIds: assigneeRows.map((row) => String(row.user_id)),
	});
	if (!availability.canSchedule) {
		conflicts.push({ code: "availability_conflict", detail: availability.conflicts });
	} else if (availability.conflicts.length > 0) {
		warnings.push("availability_warning");
	}
	if (proposed.dstAdjusted) warnings.push("dst_time_adjusted");

	const fingerprint = {
		taskId,
		occurrenceDate: input.occurrenceDate,
		scope: input.scope,
		dstPolicy: input.dstPolicy,
		requestedSchedule: input.schedule,
		effectiveSchedule: proposed,
		taskUpdatedAt: task.updatedAt,
		occurrenceSource: historicalPrefix?.id ?? "active",
		override,
		series,
		prefixes,
		conflicts,
	};
	return {
		task,
		override,
		current,
		proposed,
		series,
		prefixes,
		conflicts,
		warnings,
		availability,
		previewHash: await sha256(fingerprint),
	};
}

function publicPlan(plan: RecurrencePlan) {
	return {
		previewHash: plan.previewHash,
		canExecute: plan.conflicts.length === 0 && !plan.warnings.includes("no_schedule_change"),
		task: { id: plan.task.id, name: plan.task.name },
		current: plan.current,
		proposed: plan.proposed,
		seriesImpact: plan.series
			? {
					affectedFrom: plan.series.affectedFrom,
					preservedPrefixOccurrences: plan.series.preservedPrefixOccurrences,
					nextSeriesAnchor: plan.series.nextTask.dueDate,
				}
			: null,
		conflicts: plan.conflicts,
		warnings: plan.warnings,
		availability: plan.availability,
	};
}

recurrenceCommandRoutes.post("/api/tasks/:taskId/recurrence/preview", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const parsed = previewSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_recurrence_preview" }, 422);
	try {
		const plan = await getDb().transaction((tx) =>
			buildPlan(tx, taskId, session.user.id, parsed.data),
		);
		return c.json(publicPlan(plan));
	} catch (error) {
		if (error instanceof RecurrenceCommandError) {
			return c.json({ error: error.code }, error.status);
		}
		throw error;
	}
});

recurrenceCommandRoutes.post("/api/tasks/:taskId/recurrence/execute", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const parsed = executeSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_recurrence_execute" }, 422);
	const { operationId, previewHash, ...input } = parsed.data;
	const requestHash = await sha256({ taskId, operationId, previewHash, input });
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recurrence:${taskId}:${input.occurrenceDate}`}, 0))`,
			);
			const replayRows = (await tx.execute(sql`
				SELECT id, request_hash, expires_at, undone_at
				FROM task_recurrence_edit_batches
				WHERE created_by = ${session.user.id} AND operation_id = ${operationId}
				LIMIT 1
			`)) as unknown as Rows;
			const replay = replayRows[0];
			if (replay) {
				if (replay.request_hash !== requestHash) {
					throw new RecurrenceCommandError("operation_id_reused", 409);
				}
				return {
					batchId: String(replay.id),
					replayed: true,
					undoExpiresAt: asIso(replay.expires_at),
					undone: replay.undone_at != null,
				};
			}

			const plan = await buildPlan(tx, taskId, session.user.id, input, true);
			if (plan.previewHash !== previewHash) {
				throw new RecurrenceCommandError("preview_stale", 409);
			}
			if (plan.conflicts.length > 0) {
				throw new RecurrenceCommandError("recurrence_conflict", 409);
			}
			if (plan.warnings.includes("no_schedule_change")) {
				throw new RecurrenceCommandError("no_schedule_change", 409);
			}
			if (plan.series) {
				const occurrenceOverridesHash = await sha256(
					await readSeriesOccurrences(tx, taskId, true),
				);
				const before: SeriesBatchSnapshot = {
					kind: "series",
					task: taskScheduleSnapshot(plan.task),
					prefix: null,
					occurrenceOverridesHash,
				};
				let createdPrefix: PrefixSnapshot | null = null;
				if (plan.series.prefix) {
					const prefixId = crypto.randomUUID();
					await tx.execute(sql`
						INSERT INTO task_recurrence_prefixes
							(id, task_id, project_id, anchor_date, end_date, recurrence_rule,
							 start_date, start_timezone, duration_min, created_by, version, created_at, updated_at)
						VALUES (${prefixId}, ${taskId}, ${plan.task.projectId},
							${plan.series.prefix.anchorDate}::date, ${plan.series.prefix.endDate}::date,
							${plan.series.prefix.recurrenceRule}, ${plan.series.prefix.startDate}::timestamptz,
							${plan.series.prefix.startTimezone}, ${plan.series.prefix.durationMin},
							${session.user.id}, 1, now(), now())
					`);
					const prefixRows = (await tx.execute(sql`
						SELECT id, anchor_date, end_date, recurrence_rule, start_date, start_timezone,
						       duration_min, version
						FROM task_recurrence_prefixes WHERE id = ${prefixId} LIMIT 1
					`)) as unknown as Rows;
					if (!prefixRows[0]) throw new RecurrenceCommandError("series_prefix_write_failed", 409);
					createdPrefix = prefixSnapshot(prefixRows[0]);
				}
				await tx.execute(sql`
					UPDATE tasks
					SET due_date = ${plan.series.nextTask.dueDate}::date,
					    start_date = ${plan.series.nextTask.startDate}::timestamptz,
					    start_timezone = ${plan.series.nextTask.startTimezone},
					    duration_min = ${plan.series.nextTask.durationMin},
					    recurrence_rule = ${plan.series.nextTask.recurrenceRule},
					    updated_at = now()
					WHERE id = ${taskId}
				`);
				const afterTask = await taskContext(tx, taskId, session.user.id, false);
				const after: SeriesBatchSnapshot = {
					kind: "series",
					task: taskScheduleSnapshot(afterTask),
					prefix: createdPrefix,
					occurrenceOverridesHash,
				};
				const batchId = crypto.randomUUID();
				const expiresAt = new Date(Date.now() + 15 * 60_000);
				await tx.execute(sql`
					INSERT INTO task_recurrence_edit_batches
						(id, workspace_id, task_id, occurrence_date, scope, created_by, operation_id,
						 request_hash, before, after, expires_at, created_at)
					VALUES (${batchId}, ${plan.task.workspaceId}, ${taskId}, ${input.occurrenceDate},
						${input.scope}::recurrence_edit_scope, ${session.user.id}, ${operationId},
						${requestHash}, ${JSON.stringify(before)}::jsonb,
						${JSON.stringify(after)}::jsonb, ${expiresAt.toISOString()}::timestamptz, now())
				`);
				await tx.execute(sql`
					INSERT INTO audit_events
						(id, workspace_id, actor_type, actor_user_id, entity, entity_id, action,
						 diff, before, request_id, created_at)
					VALUES (${crypto.randomUUID()}, ${plan.task.workspaceId}, 'user', ${session.user.id},
						'tasks', ${taskId}, 'recurrence_series_rescheduled',
						${JSON.stringify({
							occurrence_date: input.occurrenceDate,
							scope: input.scope,
							current: plan.current,
							proposed: plan.proposed,
							preserved_prefix_occurrences: plan.series.preservedPrefixOccurrences,
						})}::jsonb, ${JSON.stringify(before)}::jsonb, ${c.get("requestId")}, now())
				`);
				return {
					batchId,
					replayed: false,
					undoExpiresAt: expiresAt.toISOString(),
					undone: false,
					schedule: plan.proposed,
					seriesImpact: publicPlan(plan).seriesImpact,
				};
			}

			const overrideId = plan.override.id ?? crypto.randomUUID();
			const nextVersion = plan.override.version + 1;
			if (plan.override.exists) {
				await tx.execute(sql`
					UPDATE task_occurrence_overrides
					SET override_due_date = ${plan.proposed.date}::date,
					    override_start_date = ${plan.proposed.startsAt}::timestamptz,
					    override_start_timezone = ${plan.proposed.timeZone},
					    override_duration_min = ${plan.proposed.durationMin},
					    updated_by = ${session.user.id}, version = ${nextVersion}, updated_at = now()
					WHERE id = ${overrideId} AND version = ${plan.override.version}
				`);
			} else {
				await tx.execute(sql`
					INSERT INTO task_occurrence_overrides
						(id, task_id, project_id, occ_date, done, skipped, override_due_date,
						 override_start_date, override_start_timezone, override_duration_min,
						 updated_by, version, created_at, updated_at)
					VALUES (${overrideId}, ${taskId}, ${plan.task.projectId}, ${input.occurrenceDate},
						false, false, ${plan.proposed.date}::date, ${plan.proposed.startsAt}::timestamptz,
						${plan.proposed.timeZone}, ${plan.proposed.durationMin}, ${session.user.id},
						${nextVersion}, now(), now())
				`);
			}
			const afterRows = (await tx.execute(sql`
				SELECT id, override_due_date, override_start_date, override_start_timezone,
				       override_duration_min, version
				FROM task_occurrence_overrides WHERE id = ${overrideId} LIMIT 1
			`)) as unknown as Rows;
			const after = snapshot(afterRows[0]);
			const batchId = crypto.randomUUID();
			const expiresAt = new Date(Date.now() + 15 * 60_000);
			await tx.execute(sql`
				INSERT INTO task_recurrence_edit_batches
					(id, workspace_id, task_id, occurrence_date, scope, created_by, operation_id,
					 request_hash, before, after, expires_at, created_at)
				VALUES (${batchId}, ${plan.task.workspaceId}, ${taskId}, ${input.occurrenceDate},
					${input.scope}::recurrence_edit_scope, ${session.user.id}, ${operationId},
					${requestHash}, ${JSON.stringify({ kind: "occurrence", override: plan.override } satisfies OccurrenceBatchSnapshot)}::jsonb,
					${JSON.stringify({ kind: "occurrence", override: after } satisfies OccurrenceBatchSnapshot)}::jsonb,
					${expiresAt.toISOString()}::timestamptz, now())
			`);
			await tx.execute(sql`
				INSERT INTO audit_events
					(id, workspace_id, actor_type, actor_user_id, entity, entity_id, action,
					 diff, before, request_id, created_at)
				VALUES (${crypto.randomUUID()}, ${plan.task.workspaceId}, 'user', ${session.user.id},
					'task_occurrence_overrides', ${overrideId}, 'recurrence_rescheduled',
					${JSON.stringify({
						task_id: taskId,
						occurrence_date: input.occurrenceDate,
						scope: input.scope,
						current: plan.current,
						proposed: plan.proposed,
					})}::jsonb, ${JSON.stringify(plan.override)}::jsonb, ${c.get("requestId")}, now())
			`);
			return {
				batchId,
				replayed: false,
				undoExpiresAt: expiresAt.toISOString(),
				undone: false,
				schedule: plan.proposed,
			};
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		if (error instanceof RecurrenceCommandError) {
			return c.json({ error: error.code }, error.status);
		}
		throw error;
	}
});

function snapshotMatches(current: OverrideSnapshot, expected: OverrideSnapshot): boolean {
	return (
		current.exists === expected.exists &&
		current.id === expected.id &&
		current.overrideDueDate === expected.overrideDueDate &&
		current.overrideStartDate === expected.overrideStartDate &&
		current.overrideStartTimezone === expected.overrideStartTimezone &&
		current.overrideDurationMin === expected.overrideDurationMin &&
		current.version === expected.version
	);
}

recurrenceCommandRoutes.post("/api/tasks/:taskId/recurrence/undo", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const parsed = undoSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_recurrence_undo" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const batchRows = (await tx.execute(sql`
				SELECT * FROM task_recurrence_edit_batches
				WHERE id = ${parsed.data.batchId} AND task_id = ${taskId}
				LIMIT 1 FOR UPDATE
			`)) as unknown as Rows;
			const batch = batchRows[0];
			if (!batch || batch.created_by !== session.user.id) {
				throw new RecurrenceCommandError("undo_not_found", 404);
			}
			const lockedTask = await taskContext(tx, taskId, session.user.id, true);
			if (batch.undone_at) return { ok: true, replayed: true };
			if (new Date(String(batch.expires_at)).getTime() <= Date.now()) {
				throw new RecurrenceCommandError("undo_expired", 410);
			}
			const rawBefore = batch.before as Record<string, unknown>;
			const rawAfter = batch.after as Record<string, unknown>;
			if (rawBefore.kind === "series" && rawAfter.kind === "series") {
				const before = rawBefore as SeriesBatchSnapshot;
				const expectedAfter = rawAfter as SeriesBatchSnapshot;
				if (!sameTaskSchedule(taskScheduleSnapshot(lockedTask), expectedAfter.task)) {
					throw new RecurrenceCommandError("undo_state_changed", 409);
				}
				if (expectedAfter.prefix) {
					const prefixRows = (await tx.execute(sql`
						SELECT id, anchor_date, end_date, recurrence_rule, start_date, start_timezone,
						       duration_min, version
						FROM task_recurrence_prefixes WHERE id = ${expectedAfter.prefix.id}
						LIMIT 1 FOR UPDATE
					`)) as unknown as Rows;
					if (!prefixRows[0] || !samePrefix(prefixSnapshot(prefixRows[0]), expectedAfter.prefix)) {
						throw new RecurrenceCommandError("undo_state_changed", 409);
					}
				}
				const currentOccurrencesHash = await sha256(
					await readSeriesOccurrences(tx, taskId, true),
				);
				if (
					typeof expectedAfter.occurrenceOverridesHash !== "string" ||
					currentOccurrencesHash !== expectedAfter.occurrenceOverridesHash
				) {
					throw new RecurrenceCommandError("undo_state_changed", 409);
				}
				await tx.execute(sql`
					UPDATE tasks
					SET due_date = ${before.task.dueDate}::date,
					    start_date = ${before.task.startDate}::timestamptz,
					    start_timezone = ${before.task.startTimezone},
					    duration_min = ${before.task.durationMin},
					    recurrence_rule = ${before.task.recurrenceRule},
					    updated_at = now()
					WHERE id = ${taskId}
				`);
				if (expectedAfter.prefix) {
					await tx.execute(
						sql`DELETE FROM task_recurrence_prefixes WHERE id = ${expectedAfter.prefix.id}`,
					);
				}
				await tx.execute(sql`
					UPDATE task_recurrence_edit_batches SET undone_at = now() WHERE id = ${parsed.data.batchId}
				`);
				await tx.execute(sql`
					INSERT INTO audit_events
						(id, workspace_id, actor_type, actor_user_id, entity, entity_id, action,
						 diff, before, request_id, created_at)
					VALUES (${crypto.randomUUID()}, ${batch.workspace_id}, 'user', ${session.user.id},
						'tasks', ${taskId}, 'recurrence_series_reschedule_undone',
						${JSON.stringify({
							occurrence_date: String(batch.occurrence_date),
							scope: String(batch.scope),
							restored: before.task,
						})}::jsonb, ${JSON.stringify(expectedAfter)}::jsonb,
						${c.get("requestId")}, now())
				`);
				return { ok: true, replayed: false };
			}
			const before =
				rawBefore.kind === "occurrence"
					? (rawBefore as OccurrenceBatchSnapshot).override
					: (rawBefore as OverrideSnapshot);
			const expectedAfter =
				rawAfter.kind === "occurrence"
					? (rawAfter as OccurrenceBatchSnapshot).override
					: (rawAfter as OverrideSnapshot);
			const current = await readOverride(tx, taskId, String(batch.occurrence_date), true);
			if (!snapshotMatches(current, expectedAfter)) {
				throw new RecurrenceCommandError("undo_state_changed", 409);
			}

			if (!before.exists) {
				const stateRows = (await tx.execute(sql`
					SELECT done, skipped FROM task_occurrence_overrides WHERE id = ${current.id} LIMIT 1
				`)) as unknown as Rows;
				const keepCompletion = stateRows[0]?.done === true || stateRows[0]?.skipped === true;
				if (keepCompletion) {
					await tx.execute(sql`
						UPDATE task_occurrence_overrides
						SET override_due_date = NULL, override_start_date = NULL,
						    override_start_timezone = NULL, override_duration_min = NULL,
						    updated_by = ${session.user.id}, version = version + 1, updated_at = now()
						WHERE id = ${current.id}
					`);
				} else {
					await tx.execute(sql`DELETE FROM task_occurrence_overrides WHERE id = ${current.id}`);
				}
			} else {
				await tx.execute(sql`
					UPDATE task_occurrence_overrides
					SET override_due_date = ${before.overrideDueDate}::date,
					    override_start_date = ${before.overrideStartDate}::timestamptz,
					    override_start_timezone = ${before.overrideStartTimezone},
					    override_duration_min = ${before.overrideDurationMin},
					    updated_by = ${session.user.id}, version = version + 1, updated_at = now()
					WHERE id = ${current.id}
				`);
			}
			await tx.execute(sql`
				UPDATE task_recurrence_edit_batches SET undone_at = now() WHERE id = ${parsed.data.batchId}
			`);
			await tx.execute(sql`
				INSERT INTO audit_events
					(id, workspace_id, actor_type, actor_user_id, entity, entity_id, action,
					 diff, before, request_id, created_at)
				VALUES (${crypto.randomUUID()}, ${batch.workspace_id}, 'user', ${session.user.id},
					'task_occurrence_overrides', ${current.id}, 'recurrence_reschedule_undone',
					${JSON.stringify({
						task_id: taskId,
						occurrence_date: String(batch.occurrence_date),
						restored: before,
					})}::jsonb, ${JSON.stringify(current)}::jsonb, ${c.get("requestId")}, now())
			`);
			return { ok: true, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		if (error instanceof RecurrenceCommandError) {
			return c.json({ error: error.code }, error.status);
		}
		throw error;
	}
});
