import assert from "node:assert/strict";
import { SWIPE_LONG, SWIPE_SHORT, swipeEase, swipeMag } from "./useSwipe";

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

console.log("shared swipe gesture tests: OK");
