import {
	parseRecurrenceRule,
	previousRecurrenceDate,
	recurrenceDateAtIndex,
	recurrenceIndexOfDate,
	transformRecurrenceRule,
} from "./occurrences";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

const monthly31 = parseRecurrenceRule(
	JSON.stringify({ kind: "monthly-day", day: 31, endKind: "never", showAll: true }),
);
if (!monthly31) throw new Error("monthly rule missing");
check(
	"index měsíční řady nepočítá únorovou díru",
	recurrenceDateAtIndex("2026-01-31", monthly31, 2) === "2026-05-31" &&
		recurrenceIndexOfDate("2026-01-31", monthly31, "2026-05-31") === 2,
);
check(
	"předchozí výskyt přeskočí měsíc bez 31. dne",
	previousRecurrenceDate("2026-01-31", monthly31, "2026-05-31") === "2026-03-31",
);

const weekly = transformRecurrenceRule(
	JSON.stringify({
		kind: "weekly",
		weekday: 1,
		endKind: "until",
		until: "2026-08-31",
		showAll: true,
	}),
	"2026-07-08",
	{ shiftUntilDays: 2 },
);
const weeklyParsed = parseRecurrenceRule(weekly);
check(
	"přesun týdenní řady změní weekday a stejně posune until",
	weeklyParsed?.weekday === 3 && weeklyParsed.until === "2026-09-02",
	weekly,
);

const biweekly = parseRecurrenceRule(
	transformRecurrenceRule(
		JSON.stringify({ kind: "biweekly", weekday: 1, parity: "odd", showAll: true }),
		"2026-07-16",
	),
);
check(
	"dvoutýdenní přesun přepočte den i ISO paritu",
	biweekly?.weekday === 4 && biweekly.parity === "odd",
	biweekly,
);

const lastWeekday = parseRecurrenceRule(
	transformRecurrenceRule(
		JSON.stringify({ kind: "monthly-nth", weekday: 1, nth: 1, showAll: true }),
		"2026-07-31",
	),
);
check(
	"přesun na poslední pátek vytvoří monthly-nth -1",
	lastWeekday?.weekday === 5 && lastWeekday.nth === -1,
	lastWeekday,
);

const remaining = parseRecurrenceRule(
	transformRecurrenceRule(
		JSON.stringify({ kind: "daily", endKind: "count", count: 10, doneCount: 4 }),
		"2026-07-10",
		{ remainingCount: 3 },
	),
);
check(
	"oddělená budoucí řada dostane přesný zbylý count a nový čítač",
	remaining?.count === 3 && remaining.doneCount === 0,
	remaining,
);

if (failed) throw new Error(`${failed} recurrence series checks failed`);
console.log("\nRecurrence series checks passed.");
