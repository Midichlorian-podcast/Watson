import { expandOccurrences, occId, parseRecurrenceRule } from "./occurrences";
import type { TaskRecurrencePrefixRow, TaskRow } from "./powersync/AppSchema";
import {
	dateInTimeZone,
	nextValidZonedDateTimeToIso,
	wallTimeFromInstant,
} from "./timeZone";

export type OccurrenceOverrideRow = {
	id?: string | null;
	task_id: string | null;
	occ_date: string | null;
	done: number | null;
	skipped: number | null;
	override_due_date: string | null;
	override_start_date: string | null;
	override_start_timezone: string | null;
	override_duration_min: number | null;
	updated_at?: string | null;
};

type ProjectedSchedule = {
	date: string;
	startDate: string | null;
	startTimezone: string | null;
	durationMin: number | null;
};

/** Stejná identita začátku série jako na serveru: due date, jinak lokální datum startu. */
export function recurrenceBaseDate(task: TaskRow): string | null {
	if (task.due_date) return task.due_date.slice(0, 10);
	if (!task.start_date) return null;
	const instant = new Date(task.start_date);
	if (Number.isNaN(instant.getTime())) return null;
	return task.start_timezone
		? dateInTimeZone(task.start_timezone, instant)
		: task.start_date.slice(0, 10);
}

export function occurrenceOverrideMap(rows: OccurrenceOverrideRow[]) {
	const map = new Map<string, OccurrenceOverrideRow>();
	for (const row of rows) {
		if (row.task_id && row.occ_date) map.set(occId(row.task_id, row.occ_date), row);
	}
	return map;
}

/**
 * Promítne jednu stabilně identifikovanou occurrence. Jakmile existuje override_due_date,
 * null override_start_date záměrně znamená CELÝ DEN (nikoli dědění času řady).
 */
export function projectOccurrence(
	task: TaskRow,
	sourceDate: string,
	override: OccurrenceOverrideRow | undefined,
	virtual: boolean,
	inheritedSchedule?: ProjectedSchedule,
): TaskRow {
	const hasScheduleOverride = Boolean(override?.override_due_date);
	const targetDate =
		override?.override_due_date?.slice(0, 10) ?? inheritedSchedule?.date ?? sourceDate;
	const inheritedStart =
		inheritedSchedule !== undefined
			? inheritedSchedule.startDate
			: task.start_date && task.start_timezone
			? nextValidZonedDateTimeToIso(
					sourceDate,
					wallTimeFromInstant(task.start_date, task.start_timezone) ?? "00:00:00",
					task.start_timezone,
				)
			: task.start_date
				? `${sourceDate}T${task.start_date.slice(11)}`
				: null;
	const startDate = hasScheduleOverride
		? override?.override_start_date ?? null
		: inheritedStart;
	return {
		...task,
		id: virtual ? occId(task.id, sourceDate) : task.id,
		due_date: targetDate,
		start_date: startDate,
		start_timezone: startDate
			? hasScheduleOverride
				? override?.override_start_timezone ?? null
				: inheritedSchedule?.startTimezone ?? task.start_timezone
			: null,
		duration_min: startDate
			? override?.override_duration_min ?? inheritedSchedule?.durationMin ?? task.duration_min
			: null,
		completed_at: override?.done
			? override.updated_at ?? task.created_at ?? `${targetDate}T00:00:00.000Z`
			: task.completed_at,
	};
}

export function prefixContainsOccurrence(
	prefix: TaskRecurrencePrefixRow,
	sourceDate: string,
): boolean {
	const anchor = prefix.anchor_date?.slice(0, 10);
	const end = prefix.end_date?.slice(0, 10);
	const rule = parseRecurrenceRule(prefix.recurrence_rule);
	if (!anchor || !end || !rule || sourceDate < anchor || sourceDate > end) return false;
	return expandOccurrences({
		baseISO: anchor,
		kind: rule.kind,
		weekday: rule.weekday,
		nth: rule.nth,
		day: rule.day,
		parity: rule.parity,
		fromISO: sourceDate,
		toISO: sourceDate,
		cap: 1,
		showAll: true,
	}).includes(sourceDate);
}

export function projectPrefixOccurrence(
	task: TaskRow,
	prefix: TaskRecurrencePrefixRow,
	sourceDate: string,
	override: OccurrenceOverrideRow | undefined,
): TaskRow {
	const startDate =
		prefix.start_date && prefix.start_timezone
			? nextValidZonedDateTimeToIso(
					sourceDate,
					wallTimeFromInstant(prefix.start_date, prefix.start_timezone) ?? "00:00:00",
					prefix.start_timezone,
				)
			: null;
	return projectOccurrence(
		{ ...task, recurrence_rule: prefix.recurrence_rule },
		sourceDate,
		override,
		true,
		{
			date: sourceDate,
			startDate,
			startTimezone: startDate ? prefix.start_timezone : null,
			durationMin: startDate ? prefix.duration_min : null,
		},
	);
}

/**
 * Jeden materializer pro kalendářové povrchy. Zahrne i occurrence přesunutou DO okna,
 * přestože její původní datum leží mimo okno; source datum zůstává v ID kvůli historii/undo.
 */
export function materializeRecurringTasks(
	tasks: TaskRow[],
	overrides: OccurrenceOverrideRow[],
	fromISO: string,
	toISO: string,
	capPerTask = 80,
	prefixes: TaskRecurrencePrefixRow[] = [],
): TaskRow[] {
	const overrideMap = occurrenceOverrideMap(overrides);
	const overridesByTask = new Map<string, OccurrenceOverrideRow[]>();
	for (const override of overrides) {
		if (!override.task_id || !override.occ_date) continue;
		overridesByTask.set(override.task_id, [
			...(overridesByTask.get(override.task_id) ?? []),
			override,
		]);
	}
	const result: TaskRow[] = [];
	const prefixesByTask = new Map<string, TaskRecurrencePrefixRow[]>();
	for (const prefix of prefixes) {
		if (!prefix.task_id) continue;
		prefixesByTask.set(prefix.task_id, [
			...(prefixesByTask.get(prefix.task_id) ?? []),
			prefix,
		]);
	}
	for (const task of tasks) {
		const rule = parseRecurrenceRule(task.recurrence_rule);
		const base = recurrenceBaseDate(task);
		if (!rule || !base || task.completed_at) {
			result.push(task);
			continue;
		}

		const taskPrefixes = prefixesByTask.get(task.id) ?? [];
		for (const prefix of taskPrefixes) {
			const prefixAnchor = prefix.anchor_date?.slice(0, 10);
			const prefixEnd = prefix.end_date?.slice(0, 10);
			const prefixRule = parseRecurrenceRule(prefix.recurrence_rule);
			if (!prefixAnchor || !prefixEnd || !prefixRule) continue;
			if (toISO < prefixAnchor || fromISO > prefixEnd) continue;
			const prefixSources = new Set(
				expandOccurrences({
					baseISO: prefixAnchor,
					kind: prefixRule.kind,
					weekday: prefixRule.weekday,
					nth: prefixRule.nth,
					day: prefixRule.day,
					parity: prefixRule.parity,
					fromISO: fromISO > prefixAnchor ? fromISO : prefixAnchor,
					toISO: toISO < prefixEnd ? toISO : prefixEnd,
					cap: capPerTask,
					showAll: true,
				}),
			);
			for (const override of overridesByTask.get(task.id) ?? []) {
				const target = override.override_due_date?.slice(0, 10);
				if (
					override.occ_date &&
					target &&
					target >= fromISO &&
					target <= toISO &&
					prefixContainsOccurrence(prefix, override.occ_date)
				) {
					prefixSources.add(override.occ_date);
				}
			}
			for (const sourceDate of [...prefixSources].sort()) {
				const override = overrideMap.get(occId(task.id, sourceDate));
				if (override?.skipped) continue;
				result.push(projectPrefixOccurrence(task, prefix, sourceDate, override));
			}
		}

		const baseOverride = overrideMap.get(occId(task.id, base));
		if (!baseOverride?.skipped) result.push(projectOccurrence(task, base, baseOverride, false));

		const sourceDates = new Set(
			expandOccurrences({
				baseISO: base,
				kind: rule.kind,
				weekday: rule.weekday,
				nth: rule.nth,
				day: rule.day,
				parity: rule.parity,
				fromISO,
				toISO,
				cap: capPerTask,
				until: rule.until,
				count: rule.count,
				doneCount: rule.doneCount,
				showAll: rule.showAll,
			}),
		);
		for (const override of overridesByTask.get(task.id) ?? []) {
			const target = override.override_due_date?.slice(0, 10);
			const belongsToPrefix =
				override.occ_date &&
				taskPrefixes.some((prefix) => prefixContainsOccurrence(prefix, override.occ_date ?? ""));
			if (
				!belongsToPrefix &&
				target &&
				target >= fromISO &&
				target <= toISO &&
				override.occ_date
			) {
				sourceDates.add(override.occ_date);
			}
		}
		for (const sourceDate of [...sourceDates].sort()) {
			if (sourceDate === base) continue;
			const override = overrideMap.get(occId(task.id, sourceDate));
			if (override?.skipped) continue;
			result.push(projectOccurrence(task, sourceDate, override, true));
		}
	}
	return result;
}
