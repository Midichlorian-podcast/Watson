import {
	hasEquivalentReminder,
	reminderCandidateKey,
	reminderCandidateFireAt,
	reminderFireAt,
	sortReminders,
} from "./reminders";

function check(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

const start = "2026-07-15T10:00:00.000Z";
const due = "2026-07-20";
const hourBefore = {
	type: "relative",
	remind_at: null,
	offset_min: 60,
};
const atStart = {
	type: "relative",
	remind_at: null,
	offset_min: 0,
};
const explicit = {
	type: "time",
	remind_at: "2026-07-15T08:30:00.000Z",
	offset_min: null,
};

check(
	reminderFireAt(hourBefore, { startDate: start, dueDate: due }) === Date.parse(start) - 3_600_000,
	"relative reminder must prefer the exact start time",
);
check(
	reminderFireAt(atStart, { startDate: start, dueDate: due }) === Date.parse(start),
	"zero offset must fire exactly at the start",
);
check(
	reminderCandidateFireAt(
		{ type: "relative", offsetMin: 60 },
		{ startDate: start, dueDate: due },
	) === Date.parse(start) - 3_600_000,
	"candidate validation and server explanation must share the same base",
);
check(
	hasEquivalentReminder([hourBefore], { type: "relative", offsetMin: 60 }),
	"an identical relative reminder must be detected",
);
check(
	!hasEquivalentReminder([hourBefore], { type: "relative", offsetMin: 30 }),
	"different offsets must remain independently addable",
);
check(
	reminderCandidateKey({ type: "time", remindAt: "2026-07-15T10:30:00+02:00" }) ===
		"time:2026-07-15T08:30:00.000Z",
	"absolute duplicate detection must normalize time zones",
);
check(
	sortReminders([atStart, hourBefore, explicit], { startDate: start, dueDate: due })[0] === explicit,
	"reminders must be presented by firing time",
);

console.log("reminders: multiple scheduling, duplicate detection and ordering passed");
