import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, gateway, syncConfig, commands, calendar, month, dialog, projection, migration, webPackage] =
	await Promise.all([
		read("apps/web/src/lib/powersync/AppSchema.ts"),
		read("apps/api/src/powersync.ts"),
		read("powersync/sync-config.yaml"),
		read("apps/api/src/recurrenceCommands.ts"),
		read("apps/web/src/components/Calendar.tsx"),
		read("apps/web/src/components/CalendarMonth.tsx"),
		read("apps/web/src/components/RecurrenceMoveDialog.tsx"),
		read("apps/web/src/lib/occurrenceProjection.ts"),
		read("packages/db/drizzle/0060_busy_kree.sql"),
		read("apps/web/package.json"),
	]);

const failures = [];
const requireText = (source, token, label) => {
	if (!source.includes(token)) failures.push(`${label}: chybí ${token}`);
};

	for (const column of [
	"override_due_date",
	"override_start_date",
	"override_start_timezone",
	"override_duration_min",
	"version",
]) {
	requireText(schema, `${column}:`, `PowerSync schema ${column}`);
	requireText(syncConfig, column, `PowerSync bucket ${column}`);
	requireText(migration, `"${column}"`, `DB migrace ${column}`);
}

const gatewayBlock = gateway.match(/task_occurrence_overrides:\s*\{[\s\S]*?\n\s*\},\n\s*\/\/ R6/)?.[0] ?? "";
requireText(gatewayBlock, 'done: "bool"', "offline done zápis");
requireText(gatewayBlock, 'skipped: "bool"', "offline skipped zápis");
for (const forbidden of [
	"override_due_date:",
	"override_start_date:",
	"override_start_timezone:",
	"override_duration_min:",
]) {
	if (gatewayBlock.includes(forbidden)) {
		failures.push(`write gateway nesmí přijímat ${forbidden.slice(0, -1)} mimo command`);
	}
}

for (const route of ["/preview", "/execute", "/undo"]) {
	requireText(commands, `recurrence${route}",`, `recurrence command ${route}`);
}
for (const guarantee of [
	"preview_stale",
	"operation_id_reused",
	"undo_state_changed",
	"readTaskAvailabilityConflicts",
	"pg_advisory_xact_lock",
	"recurrence_rescheduled",
]) {
	requireText(commands, guarantee, `serverový kontrakt ${guarantee}`);
}

requireText(calendar, "<RecurrenceMoveDialog", "kalendářový preview dialog");
requireText(calendar, "materializeRecurringTasks", "sdílená projekce kalendáře");
requireText(month, "data-calendar-task-id", "testovatelná occurrence karta");
if (calendar.includes('if (id.includes("@"))')) {
	failures.push("kalendář znovu blokuje virtuální occurrence před preview commandem");
}
for (const uiToken of [
	'role="dialog"',
	'aria-modal="true"',
	"min-h-11",
	"previewRecurrenceMove",
	"undoRecurrenceMove",
]) {
	requireText(dialog, uiToken, `dialog ${uiToken}`);
}
for (const projectionToken of [
	"přestože její původní datum leží mimo okno",
	"override_due_date",
	"override_start_date",
	"sourceDates.add",
]) {
	requireText(projection, projectionToken, `projekce ${projectionToken}`);
}
requireText(
	webPackage,
	"runOccurrenceProjectionTests.ts",
	"projection test musí zůstat v běžném test gate",
);

if (failures.length) {
	console.error(`Recurrence contract selhal (${failures.length}):`);
	for (const failure of failures) console.error(` - ${failure}`);
	process.exit(1);
}

console.log("Recurrence contract ověřen: command-only plánování, preview/undo, projekce a a11y.");
