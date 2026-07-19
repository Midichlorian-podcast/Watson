import assert from "node:assert/strict";
import {
	formatQueueBytes,
	normalizePendingOperation,
	operationDiff,
	parseRejectedOperation,
} from "./outbox";

const pending = normalizePendingOperation({
	clientId: 42,
	table: "tasks",
	id: "task-1",
	op: "PATCH",
	opData: { name: "Nový název", token: "nesmí ven" },
	previousValues: { name: "Starý název", token: "původní" },
});
assert.equal(pending.op, "PATCH");
assert.deepEqual(operationDiff(pending), [
	{ field: "name", before: "Starý název", after: "Nový název" },
	{ field: "token", before: "••••••", after: "••••••" },
]);

const rejected = parseRejectedOperation(
	"rejected-1",
	"tasks",
	"task-1",
	"PATCH",
	JSON.stringify({ data: { priority: 1 }, previous: { priority: 3 } }),
);
assert.deepEqual(operationDiff(rejected), [{ field: "priority", before: "3", after: "1" }]);
assert.equal(parseRejectedOperation("x", "tasks", "t", "PUT", "{").data.name, undefined);
assert.equal(formatQueueBytes(1536, "cs"), "1,5 kB");

console.log("Outbox: normalizace, diff, redakce a legacy payload testy prošly.");
