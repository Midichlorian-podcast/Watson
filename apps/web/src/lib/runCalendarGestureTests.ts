import assert from "node:assert/strict";
import {
	calendarDayClassName,
	calendarDayKind,
	consumeCalendarWheel,
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

console.log("calendar gesture tests: OK");
