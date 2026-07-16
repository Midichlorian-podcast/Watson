import type { QuietHoursConfig, WorkingHoursConfig } from "@watson/db";
import { z } from "zod";

const minute = z.number().int().min(0).max(1439);
const intervalSchema = z
	.object({ startMinute: minute, endMinute: z.number().int().min(1).max(1440) })
	.strict()
	.refine((value) => value.startMinute < value.endMinute, "invalid_interval");

export const workingHoursSchema = z
	.object({
		enabled: z.boolean(),
		days: z
			.array(
				z
					.object({
						day: z.number().int().min(1).max(7),
						intervals: z.array(intervalSchema).max(4),
					})
					.strict()
					.superRefine((value, ctx) => {
						const sorted = [...value.intervals].sort(
							(left, right) => left.startMinute - right.startMinute,
						);
						for (let index = 1; index < sorted.length; index++) {
							const previous = sorted[index - 1];
							const current = sorted[index];
							if (previous && current && current.startMinute < previous.endMinute) {
								ctx.addIssue({ code: "custom", message: "overlapping_intervals" });
							}
						}
					}),
			)
			.max(7),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (new Set(value.days.map((day) => day.day)).size !== value.days.length) {
			ctx.addIssue({ code: "custom", message: "duplicate_weekday", path: ["days"] });
		}
		if (value.enabled && !value.days.some((day) => day.intervals.length > 0)) {
			ctx.addIssue({ code: "custom", message: "working_hours_empty", path: ["days"] });
		}
	});

export const quietHoursSchema = z
	.object({
		enabled: z.boolean(),
		days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
		startMinute: minute,
		endMinute: minute,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (new Set(value.days).size !== value.days.length) {
			ctx.addIssue({ code: "custom", message: "duplicate_weekday", path: ["days"] });
		}
		if (value.startMinute === value.endMinute) {
			ctx.addIssue({ code: "custom", message: "quiet_hours_full_day_ambiguous" });
		}
	});

export const availabilityKindSchema = z.enum(["focus", "unavailable", "absence", "holiday"]);

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone }).format(0);
		return true;
	} catch {
		return false;
	}
}

type WallParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	isoWeekday: number;
};

function wallParts(instant: Date, timeZone: string): WallParts | null {
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(instant);
		const get = (type: "year" | "month" | "day" | "hour" | "minute") =>
			Number(parts.find((part) => part.type === type)?.value);
		const result = {
			year: get("year"),
			month: get("month"),
			day: get("day"),
			hour: get("hour"),
			minute: get("minute"),
		};
		if (!Object.values(result).every(Number.isFinite)) return null;
		const weekday = new Date(Date.UTC(result.year, result.month - 1, result.day)).getUTCDay();
		return { ...result, isoWeekday: weekday === 0 ? 7 : weekday };
	} catch {
		return null;
	}
}

function dateIso(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addLocalDays(parts: Pick<WallParts, "year" | "month" | "day">, days: number) {
	const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
	};
}

function timeOf(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Všechny skutečné instanty pro jeden lokální wall time (0 v DST mezeře, 2 při překryvu). */
function zonedCandidates(date: string, time: string, timeZone: string): Date[] {
	const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
	if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) return [];
	const desired = {
		year: Number(dateMatch[1]),
		month: Number(dateMatch[2]),
		day: Number(dateMatch[3]),
		hour: Number(timeMatch[1]),
		minute: Number(timeMatch[2]),
	};
	const naive = Date.UTC(
		desired.year,
		desired.month - 1,
		desired.day,
		desired.hour,
		desired.minute,
	);
	const offsets = new Set<number>();
	for (const deltaHours of [-36, -12, 0, 12, 36]) {
		const sample = new Date(naive + deltaHours * 3_600_000);
		const observed = wallParts(sample, timeZone);
		if (!observed) return [];
		const observedAsUtc = Date.UTC(
			observed.year,
			observed.month - 1,
			observed.day,
			observed.hour,
			observed.minute,
		);
		offsets.add(observedAsUtc - sample.getTime());
	}
	return [...offsets]
		.map((offset) => new Date(naive - offset))
		.filter((candidate) => {
			const observed = wallParts(candidate, timeZone);
			return (
				observed?.year === desired.year &&
				observed.month === desired.month &&
				observed.day === desired.day &&
				observed.hour === desired.hour &&
				observed.minute === desired.minute
			);
		})
		.sort((left, right) => left.getTime() - right.getTime());
}

/**
 * Vrátí první instant po `after`. Jarní DST mezeru posune na první existující
 * minutu; při podzimním překryvu naopak vybere pozdější kandidát, je-li potřeba.
 */
function nextWallInstant(
	date: string,
	minuteOfDay: number,
	timeZone: string,
	after: Date,
): Date | null {
	for (let shift = 0; shift <= 180; shift++) {
		const total = minuteOfDay + shift;
		if (total >= 1440) break;
		const candidates = zonedCandidates(date, timeOf(total), timeZone);
		const next = candidates.find((candidate) => candidate.getTime() > after.getTime());
		if (next) return next;
	}
	return null;
}

export type NotificationHold = {
	reason: "manual_snooze" | "focus" | "unavailable" | "absence" | "holiday" | "quiet_hours";
	/** null znamená ruční snooze bez omezení; u časových bloků je vždy konec. */
	until: Date | null;
};

/** Vyhodnotí opakující se quiet hours korektně přes IANA zónu a DST. */
export function quietHoursHold(
	config: QuietHoursConfig,
	timeZone: string,
	now: Date,
): NotificationHold | null {
	if (!config.enabled || !isValidTimeZone(timeZone)) return null;
	const wall = wallParts(now, timeZone);
	if (!wall) return null;
	const currentMinute = wall.hour * 60 + wall.minute;
	const activeDays = new Set(config.days);
	let endDayOffset: number | null = null;
	if (config.startMinute < config.endMinute) {
		if (activeDays.has(wall.isoWeekday) && currentMinute >= config.startMinute && currentMinute < config.endMinute) {
			endDayOffset = 0;
		}
	} else {
		const previousWeekday = wall.isoWeekday === 1 ? 7 : wall.isoWeekday - 1;
		if (activeDays.has(wall.isoWeekday) && currentMinute >= config.startMinute) endDayOffset = 1;
		else if (activeDays.has(previousWeekday) && currentMinute < config.endMinute) endDayOffset = 0;
	}
	if (endDayOffset === null) return null;
	const endDay = addLocalDays(wall, endDayOffset);
	const until = nextWallInstant(
		dateIso(endDay.year, endDay.month, endDay.day),
		config.endMinute,
		timeZone,
		now,
	);
	return until ? { reason: "quiet_hours", until } : null;
}

export function normalizeWorkingHours(config: WorkingHoursConfig): WorkingHoursConfig {
	return {
		enabled: config.enabled,
		days: [...config.days]
			.sort((left, right) => left.day - right.day)
			.map((day) => ({
				day: day.day,
				intervals: [...day.intervals].sort(
					(left, right) => left.startMinute - right.startMinute,
				),
			})),
	};
}

export function normalizeQuietHours(config: QuietHoursConfig): QuietHoursConfig {
	return { ...config, days: [...config.days].sort((left, right) => left - right) };
}

/** null = pracovní rozvrh je vypnutý; false je jen informace, ne automatická blokace. */
export function isWithinWorkingHours(
	config: WorkingHoursConfig,
	timeZone: string,
	now: Date,
): boolean | null {
	if (!config.enabled || !isValidTimeZone(timeZone)) return null;
	const wall = wallParts(now, timeZone);
	if (!wall) return null;
	const minuteOfDay = wall.hour * 60 + wall.minute;
	const day = config.days.find((candidate) => candidate.day === wall.isoWeekday);
	return Boolean(
		day?.intervals.some(
			(interval) => minuteOfDay >= interval.startMinute && minuteOfDay < interval.endMinute,
		),
	);
}
