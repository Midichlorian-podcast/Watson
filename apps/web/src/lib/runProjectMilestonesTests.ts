import { strict as assert } from "node:assert";
import {
	evaluateProjectMilestone,
	type MilestoneTaskSnapshot,
} from "./projectMilestones";

const tasks: MilestoneTaskSnapshot[] = [
	{ id: "a", name: "A", kind: "task", completed_at: "2026-07-10T09:00:00Z" },
	{ id: "b", name: "B", kind: "task", completed_at: null },
	{ id: "m", name: "Meeting", kind: "meeting", completed_at: null },
];

assert.deepEqual(
	evaluateProjectMilestone(
		{
			id: "1",
			title: "A",
			condition_type: "task_completed",
			task_id: "a",
			target_count: null,
			due_date: "2026-07-10",
		},
		tasks,
		"2026-07-16",
	),
	{ state: "met", current: 1, target: 1 },
);
assert.deepEqual(
	evaluateProjectMilestone(
		{
			id: "2",
			title: "Dva",
			condition_type: "completed_count",
			task_id: null,
			target_count: 2,
			due_date: "2026-07-15",
		},
		tasks,
		"2026-07-16",
	),
	{ state: "missed", current: 1, target: 2 },
);
assert.deepEqual(
	evaluateProjectMilestone(
		{
			id: "3",
			title: "Vše",
			condition_type: "all_tasks_completed",
			task_id: null,
			target_count: null,
			due_date: null,
		},
		tasks,
		"2026-07-16",
	),
	{ state: "pending", current: 1, target: 2 },
);
assert.deepEqual(
	evaluateProjectMilestone(
		{
			id: "4",
			title: "Prázdný",
			condition_type: "all_tasks_completed",
			task_id: null,
			target_count: null,
			due_date: null,
		},
		[],
		"2026-07-16",
	),
	{ state: "pending", current: 0, target: 1 },
);
assert.deepEqual(
	evaluateProjectMilestone(
		{
			id: "5",
			title: "Pražská půlnoc",
			condition_type: "task_completed",
			task_id: "late",
			target_count: null,
			due_date: "2026-07-10",
		},
		[
			{
				id: "late",
				name: "Pozdní",
				kind: "task",
				completed_at: "2026-07-10T22:30:00Z",
			},
		],
		"2026-07-11",
	),
	{ state: "missed", current: 0, target: 1 },
);

console.log("project milestones tests: 5/5 passed");
