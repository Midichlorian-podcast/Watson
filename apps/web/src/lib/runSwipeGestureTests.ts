import assert from "node:assert/strict";
import {
	clampSwipeWheelDelta,
	SWIPE_HYSTERESIS,
	SWIPE_LONG,
	SWIPE_SHORT,
	SWIPE_WHEEL_LONG_COMMIT,
	SWIPE_WHEEL_SHORT_COMMIT,
	swipeEase,
	swipeMag,
	swipeMagWithHysteresis,
	swipeWheelCommitMag,
} from "./useSwipe";

assert.equal(swipeMag(0), "none");
assert.equal(swipeMag(15), "none");
assert.equal(swipeMag(16), "r0");
assert.equal(swipeMag(SWIPE_SHORT - 1), "r0");
assert.equal(swipeMag(SWIPE_SHORT), "r1");
assert.equal(swipeMag(SWIPE_LONG - 1), "r1");
assert.equal(swipeMag(SWIPE_LONG), "r2");

assert.equal(swipeMag(-16), "l0");
assert.equal(swipeMag(-SWIPE_SHORT), "l1");
assert.equal(swipeMag(-SWIPE_LONG), "l2");

assert.equal(swipeEase(SWIPE_LONG), SWIPE_LONG);
assert.equal(swipeEase(SWIPE_LONG + 40), SWIPE_LONG + 8);
assert.equal(swipeEase(-(SWIPE_LONG + 40)), -(SWIPE_LONG + 8));

assert.equal(swipeMagWithHysteresis(SWIPE_LONG + SWIPE_HYSTERESIS - 1, "r1"), "r1");
assert.equal(swipeMagWithHysteresis(SWIPE_LONG + SWIPE_HYSTERESIS, "r1"), "r2");
assert.equal(swipeMagWithHysteresis(SWIPE_LONG - SWIPE_HYSTERESIS, "r2"), "r2");
assert.equal(swipeMagWithHysteresis(SWIPE_LONG - SWIPE_HYSTERESIS - 1, "r2"), "r1");

assert.equal(clampSwipeWheelDelta(120), 42);
assert.equal(clampSwipeWheelDelta(-120), -42);
assert.equal(clampSwipeWheelDelta(18), 18);
assert.equal(swipeWheelCommitMag(SWIPE_SHORT), null);
assert.equal(swipeWheelCommitMag(SWIPE_WHEEL_SHORT_COMMIT - 1), null);
assert.equal(swipeWheelCommitMag(SWIPE_WHEEL_SHORT_COMMIT), "r1");
assert.equal(swipeWheelCommitMag(SWIPE_LONG + 20), null);
assert.equal(swipeWheelCommitMag(SWIPE_WHEEL_LONG_COMMIT), "r2");
assert.equal(swipeWheelCommitMag(-SWIPE_WHEEL_LONG_COMMIT), "l2");

console.log("shared swipe gesture tests: OK");
