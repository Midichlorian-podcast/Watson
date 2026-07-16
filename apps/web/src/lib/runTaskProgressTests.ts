import { taskProgress } from "./taskProgress";

function check(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

const empty = taskProgress([]);
check(empty.total === 0 && empty.percent === 0 && !empty.isComplete, "empty parent must be stable");

const partial = taskProgress([
	{ completed_at: "2026-07-15T08:00:00.000Z" },
	{ completed_at: null },
	{ completed_at: null },
]);
check(partial.done === 1 && partial.total === 3, "progress must count immediate children");
check(partial.percent === 33 && !partial.isComplete, "partial progress must be rounded and open");

const complete = taskProgress([
	{ completed_at: "2026-07-15T08:00:00.000Z" },
	{ completed_at: "2026-07-15T09:00:00.000Z" },
]);
check(complete.percent === 100 && complete.isComplete, "all completed children must reach 100%");

console.log("taskProgress: empty, partial and complete parent progress passed");
