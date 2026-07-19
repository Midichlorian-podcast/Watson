import { buildWaitingRoom } from "./waitingRoom";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label}: ${JSON.stringify(detail)}`);
	}
};

const me = "me";
const other = "other";
const tasks = [
	{ id: "mine-blocker", name: "Dodám podklady", project_id: "p", priority: 1, due_date: "2026-07-17", completed_at: null },
	{ id: "other-blocked", name: "Kolega naváže", project_id: "p", priority: 3, due_date: null, completed_at: null },
	{ id: "other-blocker", name: "Čekám na rešerši", project_id: "p", priority: 2, due_date: "2026-07-18", completed_at: null },
	{ id: "mine-blocked", name: "Sepíšu výstup", project_id: "p", priority: 2, due_date: null, completed_at: null },
	{ id: "done-blocker", name: "Hotový vstup", project_id: "p", priority: 1, due_date: null, completed_at: "2026-07-16T10:00:00Z" },
	{ id: "flow-active-other", name: "Schválit rozpočet", project_id: "p", priority: 1, due_date: "2026-07-16", completed_at: null },
	{ id: "flow-future-me", name: "Objednat", project_id: "p", priority: 3, due_date: null, completed_at: null },
	{ id: "flow-active-me", name: "Připravit smlouvu", project_id: "p", priority: 2, due_date: "2026-07-19", completed_at: null },
	{ id: "flow-future-other", name: "Podepsat", project_id: "p", priority: 3, due_date: null, completed_at: null },
];
const assignments = [
	{ task_id: "mine-blocker", user_id: me },
	{ task_id: "other-blocked", user_id: other },
	{ task_id: "other-blocker", user_id: other },
	{ task_id: "mine-blocked", user_id: me },
	{ task_id: "done-blocker", user_id: other },
	{ task_id: "flow-active-other", user_id: other },
	{ task_id: "flow-future-me", user_id: me },
	{ task_id: "flow-active-me", user_id: me },
	{ task_id: "flow-future-other", user_id: other },
];
const result = buildWaitingRoom({
	currentUserId: me,
	tasks,
	assignments,
	dependencies: [
		{ id: "d1", blocking_task_id: "mine-blocker", blocked_task_id: "other-blocked" },
		{ id: "d2", blocking_task_id: "other-blocker", blocked_task_id: "mine-blocked" },
		{ id: "d3", blocking_task_id: "done-blocker", blocked_task_id: "mine-blocked" },
	],
	chainSteps: [
		{ id: "s1", chain_id: "c1", task_id: "flow-active-other", position: 0, step_state: "active" },
		{ id: "s2", chain_id: "c1", task_id: "flow-future-me", position: 1, step_state: "dormant" },
		{ id: "s3", chain_id: "c2", task_id: "flow-active-me", position: 0, step_state: "active" },
		{ id: "s4", chain_id: "c2", task_id: "flow-future-other", position: 1, step_state: "dormant" },
	],
});

check(
	"závislost přiřazená mně je ve frontě čeká na mě",
	result.onMe.some((entry) => entry.taskId === "mine-blocker" && entry.source === "dependency"),
	result,
);
check(
	"cizí blocker mého úkolu je ve frontě čekám na ostatní",
	result.forOthers.some((entry) => entry.taskId === "other-blocker" && entry.relatedTaskId === "mine-blocked"),
	result,
);
check(
	"dokončený blocker čekání nevytváří",
	!result.forOthers.some((entry) => entry.taskId === "done-blocker"),
	result,
);
check(
	"aktivní cizí krok před mým krokem je ve frontě čekám na ostatní",
	result.forOthers.some((entry) => entry.taskId === "flow-active-other" && entry.source === "flow"),
	result,
);
check(
	"můj aktivní krok odemykající kolegu je ve frontě čeká na mě",
	result.onMe.some((entry) => entry.taskId === "flow-active-me" && entry.source === "flow"),
	result,
);
check(
	"fronty mají deterministické pořadí termín → priorita → název",
	result.forOthers[0]?.taskId === "flow-active-other" && result.onMe[0]?.taskId === "mine-blocker",
	result,
);

if (failed) throw new Error(`${failed} Waiting Room checks failed`);
console.log("Waiting Room: dependency, flow, completion and ordering checks passed.");
