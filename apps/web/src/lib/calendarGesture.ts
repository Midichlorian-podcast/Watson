export const CALENDAR_WHEEL_THRESHOLD = 32;
export const CALENDAR_WHEEL_MAX_STEPS = 8;

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

/**
 * Převádí horizontální trackpad deltu na diskrétní posun kalendářní kotvy.
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
