import assert from "node:assert/strict";
import {
	DEFAULT_MAIL_SWIPE_CONFIG,
	mailSwipeSlotDistance,
	mailSwipeSlotSide,
	normalizeMailSwipeConfig,
} from "./swipeConfig";

assert.deepEqual(normalizeMailSwipeConfig(null), DEFAULT_MAIL_SWIPE_CONFIG);
assert.deepEqual(
	normalizeMailSwipeConfig({ r1: "pin", r2: "set_aside", l1: "assign", l2: "done" }),
	{
		r1: "pin",
		r2: "set_aside",
		l1: "assign",
		l2: "done",
	},
);
assert.deepEqual(normalizeMailSwipeConfig({ r1: "invalid", r2: "trash", l1: 42, l2: "none" }), {
	r1: "read",
	r2: "trash",
	l1: "archive",
	l2: "none",
});
assert.equal(mailSwipeSlotSide("r2"), "right");
assert.equal(mailSwipeSlotSide("l1"), "left");
assert.equal(mailSwipeSlotDistance("r1"), "short");
assert.equal(mailSwipeSlotDistance("l2"), "long");

console.log("mail swipe configuration tests: OK");
