import assert from "node:assert/strict";
import { canClaimLeaderLease, parseLeaderLease, parseWindowMessage } from "./windowCoordinator";

const valid = {
	version: 1,
	id: "event-1",
	source: "window-1",
	type: "window-presence",
	sentAt: 123,
	payload: { shell: "focus", surface: "mail", path: "/mail" },
};
assert.deepEqual(parseWindowMessage(valid), valid);
assert.equal(parseWindowMessage({ ...valid, version: 2 }), null);
assert.equal(parseWindowMessage({ ...valid, payload: { shell: "admin", path: "/mail" } }), null);
assert.equal(parseWindowMessage({ ...valid, payload: { ...valid.payload, extra: true } }), null);
assert.equal(parseWindowMessage({ ...valid, payload: { ...valid.payload, surface: "unknown" } }), null);
assert.equal(
	parseWindowMessage({ ...valid, type: "session-invalidated", payload: { extra: true } }),
	null,
);
assert.equal(
	parseWindowMessage({
		...valid,
		type: "mail-invalidated",
		payload: { accountId: "x".repeat(161) },
	}),
	null,
);

assert.deepEqual(parseLeaderLease('{"owner":"a","expiresAt":200}'), {
	owner: "a",
	expiresAt: 200,
});
assert.equal(parseLeaderLease("not-json"), null);
assert.equal(canClaimLeaderLease('{"owner":"a","expiresAt":200}', 100, "b"), false);
assert.equal(canClaimLeaderLease('{"owner":"a","expiresAt":200}', 201, "b"), true);
assert.equal(canClaimLeaderLease('{"owner":"a","expiresAt":200}', 100, "a"), true);

console.log("windowCoordinator: message validation and deterministic leader lease passed");
