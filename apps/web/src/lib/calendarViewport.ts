/** A week must stay readable instead of compressing seven days into unusable columns. */
export const CALENDAR_WEEK_DAY_MIN_WIDTH = 200;
export const CALENDAR_TIME_GUTTER_WIDTH = 46;
export const CALENDAR_WHEEL_THRESHOLD = 48;

export function calendarWeekMinWidth(dayCount: number, withTimeGutter = false): number {
	return (
		Math.max(1, dayCount) * CALENDAR_WEEK_DAY_MIN_WIDTH +
		(withTimeGutter ? CALENDAR_TIME_GUTTER_WIDTH : 0)
	);
}

/**
 * Translate one completed non-week horizontal gesture to at most one navigation step.
 * Week view uses native horizontal scrolling and therefore never calls this helper.
 */
export function calendarWheelDirection(
	deltaX: number,
	deltaY: number,
	threshold = CALENDAR_WHEEL_THRESHOLD,
): -1 | 0 | 1 {
	if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) < threshold) return 0;
	return deltaX > 0 ? 1 : -1;
}
