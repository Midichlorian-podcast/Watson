import {
	materializeRecurringTasks,
	type OccurrenceOverrideRow,
	recurrenceBaseDate,
} from "./occurrenceProjection";
import type { TaskRow } from "./powersync/AppSchema";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

const task = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Denní kontrola",
	project_id: "22222222-2222-4222-8222-222222222222",
	due_date: "2026-07-01",
	start_date: "2026-07-01T07:00:00.000Z",
	start_timezone: "Europe/Prague",
	duration_min: 60,
	recurrence_rule: JSON.stringify({ kind: "daily", showAll: true }),
	completed_at: null,
	created_at: "2026-06-01T00:00:00.000Z",
} as TaskRow;

const moved: OccurrenceOverrideRow = {
	id: "33333333-3333-4333-8333-333333333333",
	task_id: task.id,
	occ_date: "2026-07-02",
	done: 0,
	skipped: 0,
	override_due_date: "2026-07-10",
	override_start_date: "2026-07-10T11:00:00.000Z",
	override_start_timezone: "Europe/Prague",
	override_duration_min: 45,
	updated_at: "2026-07-01T10:00:00.000Z",
};

let projected = materializeRecurringTasks([task], [moved], "2026-07-09", "2026-07-11");
const movedOccurrence = projected.find((row) => row.id === `${task.id}@2026-07-02`);
check(
	"přesun DO okna nezmizí, i když původní occurrence leží mimo okno",
	movedOccurrence?.due_date === "2026-07-10" &&
		movedOccurrence.start_date === "2026-07-10T11:00:00.000Z" &&
		movedOccurrence.duration_min === 45,
	movedOccurrence,
);
check(
	"přirozený i přesunutý výskyt mohou vědomě sdílet cílový den",
	projected.filter((row) => row.due_date === "2026-07-10").length === 2,
	projected.map((row) => ({ id: row.id, due: row.due_date })),
);

const allDay: OccurrenceOverrideRow = {
	...moved,
	override_start_date: null,
	override_start_timezone: null,
	override_duration_min: null,
};
projected = materializeRecurringTasks([task], [allDay], "2026-07-09", "2026-07-11");
const allDayOccurrence = projected.find((row) => row.id === `${task.id}@2026-07-02`);
check(
	"explicitní celodenní override nedědí čas ani délku řady",
	allDayOccurrence?.start_date === null &&
		allDayOccurrence.start_timezone === null &&
		allDayOccurrence.duration_min === null,
	allDayOccurrence,
);

const done: OccurrenceOverrideRow = { ...moved, done: 1 };
projected = materializeRecurringTasks([task], [done], "2026-07-09", "2026-07-11");
check(
	"plánovací override zachová per-occurrence dokončení",
	Boolean(projected.find((row) => row.id === `${task.id}@2026-07-02`)?.completed_at),
);

const skipped: OccurrenceOverrideRow = { ...moved, skipped: 1 };
projected = materializeRecurringTasks([task], [skipped], "2026-07-09", "2026-07-11");
check(
	"přesunutý přeskočený výskyt se nevykreslí",
	!projected.some((row) => row.id === `${task.id}@2026-07-02`),
);

const movedBase: OccurrenceOverrideRow = {
	...moved,
	occ_date: "2026-07-01",
	override_due_date: "2026-07-08",
	override_start_date: "2026-07-08T07:00:00.000Z",
	override_duration_min: 60,
};
projected = materializeRecurringTasks([task], [movedBase], "2026-07-07", "2026-07-09");
check(
	"jen tento funguje i pro base occurrence bez změny identity řady",
	projected.find((row) => row.id === task.id)?.due_date === "2026-07-08" &&
		projected.some((row) => row.id === `${task.id}@2026-07-08`),
	projected.map((row) => ({ id: row.id, due: row.due_date })),
);

const startOnlyTask = {
	...task,
	due_date: null,
	start_date: "2026-06-30T22:30:00.000Z",
	start_timezone: "Europe/Prague",
} as TaskRow;
check(
	"řada bez due date používá lokální datum startu, ne UTC datum instantu",
	recurrenceBaseDate(startOnlyTask) === "2026-07-01" &&
		materializeRecurringTasks([startOnlyTask], [], "2026-07-02", "2026-07-02").some(
			(row) => row.id === `${task.id}@2026-07-02`,
		),
);

if (failed) throw new Error(`${failed} occurrence projection checks failed`);
console.log("\nOccurrence projection checks passed.");
