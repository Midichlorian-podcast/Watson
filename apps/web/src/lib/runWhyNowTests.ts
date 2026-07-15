import assert from "node:assert/strict";
import { WHY_NOW_MAX_LENGTH, whyNowSignals } from "./whyNow";

const TODAY = "2026-07-15";

assert.deepEqual(whyNowSignals({ due_date: "2026-07-14" }, { today: TODAY }), ["due_overdue"]);
assert.deepEqual(
  whyNowSignals({ due_date: TODAY, deadline: "2026-07-17", priority: 1 }, { today: TODAY }),
  ["due_today", "deadline_soon", "priority_one"],
);
assert.deepEqual(
  whyNowSignals(
    { start_date: "2026-07-15T08:00:00.000Z", start_timezone: "Europe/Prague" },
    { today: TODAY },
  ),
  ["starts_today"],
);
assert.deepEqual(
  whyNowSignals({ due_date: "2026-07-14", priority: 1, completed_at: TODAY }, { today: TODAY }),
  [],
);
assert.deepEqual(whyNowSignals({ due_date: "2026-08-15", priority: 4 }, { today: TODAY }), []);
assert.equal(WHY_NOW_MAX_LENGTH, 1000);

console.log("whyNow: deterministic relevance tests passed");
