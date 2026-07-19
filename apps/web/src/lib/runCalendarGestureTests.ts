import assert from "node:assert/strict";
import {
	calendarDayClassName,
	calendarDayKind,
	calendarInitialScrollTop,
	calendarStripCenter,
	calendarStripDayWidth,
	consumeCalendarWheel,
	nearestCalendarDayOffset,
} from "./calendarGesture";

assert.deepEqual(consumeCalendarWheel(0, 31, 0), { offset: 0, remainder: 31 });
assert.deepEqual(consumeCalendarWheel(31, 1, 0), { offset: 1, remainder: 0 });
assert.deepEqual(consumeCalendarWheel(0, 64, 0), { offset: 2, remainder: 0 });
assert.deepEqual(consumeCalendarWheel(0, -32, 0), { offset: -1, remainder: 0 });
assert.deepEqual(consumeCalendarWheel(12, 20, 40), { offset: 0, remainder: 12 });
assert.deepEqual(consumeCalendarWheel(0, 320, 0), { offset: 8, remainder: 64 });
assert.deepEqual(consumeCalendarWheel(64, -96, 0), { offset: -1, remainder: 0 });
assert.equal(calendarDayKind(new Date(2026, 6, 13)), "monday");
assert.equal(calendarDayKind(new Date(2026, 6, 18)), "weekend");
assert.equal(calendarDayKind(new Date(2026, 6, 15)), "weekday");
assert.equal(calendarDayClassName(1), "w-calendar-day-monday");
assert.equal(calendarDayClassName(0), "w-calendar-day-weekend");
assert.equal(calendarDayClassName(3), "");
assert.equal(calendarStripDayWidth(980, 7), 140);
assert.equal(calendarStripDayWidth(980, 1), 980);
assert.equal(calendarStripDayWidth(0, 7), 0);
assert.equal(calendarStripCenter(140, 3), 420);
assert.equal(nearestCalendarDayOffset(489, 420, 140, -3, 3), 0);
assert.equal(nearestCalendarDayOffset(491, 420, 140, -3, 3), 1);
assert.equal(nearestCalendarDayOffset(69, 420, 140, -3, 3), -3);
assert.equal(nearestCalendarDayOffset(1_120, 420, 140, -3, 3), 3);
assert.equal(calendarInitialScrollTop(0.62), 215.2);
assert.equal(calendarInitialScrollTop(0.95, 7), 391);

console.log("calendar gesture tests: OK");
