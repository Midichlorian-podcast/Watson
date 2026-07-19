export const CALENDAR_WHEEL_THRESHOLD = 32;
export const CALENDAR_WHEEL_MAX_STEPS = 8;
export const CALENDAR_STRIP_BUFFER_DAYS = 3;
export const CALENDAR_STRIP_SETTLE_MS = 110;
export const CALENDAR_STRIP_SNAP_MS = 150;
export const CALENDAR_INITIAL_HOUR = 6;

export interface CalendarWheelProgress {
	offset: number;
	remainder: number;
}

export type CalendarDayKind = "monday" | "weekend" | "weekday";

export function calendarDayKind(day: Date | number): CalendarDayKind {
	const weekday = typeof day === "number" ? day : day.getDay();
	if (weekday === 1) return "monday";
	if (weekday === 0 || weekday === 6) return "weekend";
	return "weekday";
}

export function calendarDayClassName(day: Date | number): string {
	const kind = calendarDayKind(day);
	if (kind === "monday") return "w-calendar-day-monday";
	if (kind === "weekend") return "w-calendar-day-weekend";
	return "";
}

export function calendarStripDayWidth(viewportWidth: number, visibleDays: number): number {
	if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || visibleDays < 1) return 0;
	return viewportWidth / Math.floor(visibleDays);
}

export function calendarStripCenter(dayWidth: number, bufferDays: number): number {
	if (!Number.isFinite(dayWidth) || dayWidth <= 0 || bufferDays < 0) return 0;
	return dayWidth * Math.floor(bufferDays);
}

/** Nejbližší celodenní kotva po doběhnutí nativní setrvačnosti trackpadu. */
export function nearestCalendarDayOffset(
	scrollLeft: number,
	center: number,
	dayWidth: number,
	minOffset: number,
	maxOffset: number,
): number {
	if (!Number.isFinite(scrollLeft) || !Number.isFinite(center) || dayWidth <= 0) return 0;
	return Math.max(minOffset, Math.min(maxOffset, Math.round((scrollLeft - center) / dayWidth)));
}

export function calendarInitialScrollTop(
	pixelsPerMinute: number,
	hour = CALENDAR_INITIAL_HOUR,
	topPadding = 8,
): number {
	if (!Number.isFinite(pixelsPerMinute) || pixelsPerMinute <= 0) return 0;
	return Math.max(0, Math.min(24, hour) * 60 * pixelsPerMinute - topPadding);
}

/**
 * Převádí horizontální trackpad deltu na diskrétní posun měsíční kotvy.
 * Zbytek se zachová mezi eventy, takže i jemné Safari delty postupně překročí práh.
 * Jeden event je omezený stejně jako v původním prototypu, aby velký impuls
 * nepřeskočil nekontrolovaně desítky dnů.
 */
export function consumeCalendarWheel(
	remainder: number,
	deltaX: number,
	deltaY: number,
	threshold = CALENDAR_WHEEL_THRESHOLD,
	maxSteps = CALENDAR_WHEEL_MAX_STEPS,
): CalendarWheelProgress {
	if (Math.abs(deltaX) <= Math.abs(deltaY)) return { offset: 0, remainder };
	let nextRemainder = remainder + deltaX;
	let offset = 0;
	let steps = 0;
	while (Math.abs(nextRemainder) >= threshold && steps < maxSteps) {
		const direction = nextRemainder > 0 ? 1 : -1;
		offset += direction;
		nextRemainder -= direction * threshold;
		steps += 1;
	}
	return { offset, remainder: nextRemainder };
}
