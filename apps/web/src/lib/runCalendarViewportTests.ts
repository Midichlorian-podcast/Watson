import assert from "node:assert/strict";
import {
	CALENDAR_WEEK_DAY_MIN_WIDTH,
	calendarWeekMinWidth,
	calendarWheelDirection,
} from "./calendarViewport";

assert.equal(calendarWeekMinWidth(7), 7 * CALENDAR_WEEK_DAY_MIN_WIDTH);
assert.equal(calendarWeekMinWidth(7, true), 7 * CALENDAR_WEEK_DAY_MIN_WIDTH + 46);
assert.equal(calendarWeekMinWidth(0), CALENDAR_WEEK_DAY_MIN_WIDTH);

assert.equal(calendarWheelDirection(47, 0), 0);
assert.equal(calendarWheelDirection(80, 12), 1);
assert.equal(calendarWheelDirection(-80, 12), -1);
assert.equal(calendarWheelDirection(80, 100), 0);

console.log("calendar viewport tests: OK");
