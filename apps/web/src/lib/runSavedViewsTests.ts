import assert from "node:assert/strict";
import { DEFAULT_TOOLBAR, filterTasks } from "../components/TasksToolbar";
import {
	makeSavedTaskViewConfig,
	parseSavedTaskViewConfig,
	toolbarStateFromSavedView,
} from "./savedViews";

const config = makeSavedTaskViewConfig(
	{
		...DEFAULT_TOOLBAR,
		priorities: [1, 2],
		due: ["overdue"],
		groupBy: "priority",
		sortBy: "due",
	},
	"board",
	"kompaktni",
);
assert.deepEqual(parseSavedTaskViewConfig(JSON.stringify(config)), config);
assert.deepEqual(toolbarStateFromSavedView(config).priorities, [1, 2]);
assert.equal(toolbarStateFromSavedView(config).groupBy, "priority");
assert.equal(parseSavedTaskViewConfig({ ...config, priorities: [1, 1] }), null);
assert.equal(parseSavedTaskViewConfig({ ...config, viewMode: "calendar" }), null);
assert.equal(parseSavedTaskViewConfig("broken-json"), null);

const dateAt = (days: number) => {
	const now = new Date();
	const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const tasks = [
	{ id: "overdue", name: "Overdue", priority: 1, due_date: dateAt(-1), completed_at: null, project_id: null, status_id: null },
	{ id: "today", name: "Today", priority: 2, due_date: dateAt(0), completed_at: null, project_id: null, status_id: null },
	{ id: "next7", name: "Next week", priority: 3, due_date: dateAt(7), completed_at: null, project_id: null, status_id: null },
	{ id: "later", name: "Later", priority: 4, due_date: dateAt(8), completed_at: null, project_id: null, status_id: null },
	{ id: "none", name: "No due", priority: 4, due_date: null, completed_at: null, project_id: null, status_id: null },
	{ id: "done", name: "Done", priority: 1, due_date: dateAt(-1), completed_at: new Date().toISOString(), project_id: null, status_id: null },
];
assert.deepEqual(
	filterTasks(tasks, { ...DEFAULT_TOOLBAR, due: ["overdue", "today"] }).map((task) => task.id),
	["overdue", "today"],
);
assert.deepEqual(
	filterTasks(tasks, { ...DEFAULT_TOOLBAR, due: ["next7"] }).map((task) => task.id),
	["next7"],
);
assert.deepEqual(
	filterTasks(tasks, { ...DEFAULT_TOOLBAR, due: ["none"] }).map((task) => task.id),
	["none"],
);

console.log("savedViews: strict config roundtrip and due filters passed");
