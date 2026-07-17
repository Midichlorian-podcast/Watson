import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
	schema,
	gateway,
	syncConfig,
	commands,
	taskCommands,
	importsSource,
	taskTimeline,
	exportSource,
	calendar,
	month,
	dialog,
	projection,
	migration,
	prefixMigration,
	ruleMigration,
	authorMigration,
	overlapMigration,
	sharedOccurrences,
	seriesTests,
	webPackage,
] = await Promise.all([
		read("apps/web/src/lib/powersync/AppSchema.ts"),
		read("apps/api/src/powersync.ts"),
		read("powersync/sync-config.yaml"),
		read("apps/api/src/recurrenceCommands.ts"),
		read("apps/api/src/taskCommands.ts"),
		read("apps/api/src/imports.ts"),
		read("apps/api/src/taskTimeline.ts"),
		read("apps/api/src/export.ts"),
		read("apps/web/src/components/Calendar.tsx"),
		read("apps/web/src/components/CalendarMonth.tsx"),
		read("apps/web/src/components/RecurrenceMoveDialog.tsx"),
		read("apps/web/src/lib/occurrenceProjection.ts"),
		read("packages/db/drizzle/0060_busy_kree.sql"),
		read("packages/db/drizzle/0061_bored_yellow_claw.sql"),
		read("packages/db/drizzle/0062_white_morlocks.sql"),
		read("packages/db/drizzle/0063_careful_jimmy_woo.sql"),
		read("packages/db/drizzle/0064_prevent_recurrence_prefix_overlap.sql"),
		read("packages/shared/src/occurrences.ts"),
		read("apps/web/src/lib/runRecurrenceSeriesTests.ts"),
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

for (const column of [
	"anchor_date",
	"end_date",
	"recurrence_rule",
	"start_date",
	"start_timezone",
	"duration_min",
	"version",
]) {
	requireText(schema, `${column}:`, `PowerSync prefix schema ${column}`);
	requireText(syncConfig, column, `PowerSync prefix bucket ${column}`);
	requireText(prefixMigration, `"${column}"`, `DB prefix migrace ${column}`);
}
requireText(syncConfig, "FROM task_recurrence_prefixes", "PowerSync segmenty řady");
requireText(ruleMigration, "monthly-nth", "DB allowlist recurrence pravidel");
requireText(authorMigration, "ON DELETE set null", "historie nesmí blokovat smazání autora");
requireText(overlapMigration, "EXCLUDE USING gist", "DB zákaz překryvu segmentů řady");
requireText(
	overlapMigration,
	'"task_recurrence_prefixes_no_overlap"',
	"pojmenovaný DB invariant překryvu segmentů řady",
);
requireText(exportSource, '"task_recurrence_prefixes"', "export/restore segmentů řady");
requireText(taskCommands, "'recurrencePrefixes'", "task delete snapshot segmentů řady");
requireText(
	taskCommands,
	"null::task_recurrence_prefixes",
	"task restore historických segmentů řady",
);
requireText(
	importsSource,
	"SELECT count(*) FROM task_recurrence_prefixes",
	"import rollback nesmí smazat pozdější segment řady",
);
requireText(
	taskTimeline,
	'row.action === "recurrence_series_rescheduled"',
	"časová osa strukturálního přesunu řady",
);
if (gateway.includes("task_recurrence_prefixes:")) {
	failures.push("prefix řady musí být command-only a nesmí být v obecném write gateway");
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
	'kind: "series"',
	"series_has_future_exceptions",
	"recurrence_series_rescheduled",
	"recurrence_series_reschedule_undone",
	"task_recurrence_prefixes",
	"occurrenceOverridesHash",
	"historical_segment_scope_unsupported",
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
	'"this_and_future"',
	'"all"',
	"seriesImpact",
]) {
	requireText(dialog, uiToken, `dialog ${uiToken}`);
}
for (const projectionToken of [
	"přestože její původní datum leží mimo okno",
	"override_due_date",
	"override_start_date",
	"sourceDates.add",
	"projectPrefixOccurrence",
	"prefixContainsOccurrence",
	"taskPrefixes",
]) {
	requireText(projection, projectionToken, `projekce ${projectionToken}`);
}
requireText(
	webPackage,
	"runOccurrenceProjectionTests.ts",
	"projection test musí zůstat v běžném test gate",
);
requireText(
	webPackage,
	"runRecurrenceSeriesTests.ts",
	"series transform test musí zůstat v běžném test gate",
);
for (const helper of [
	"recurrenceIndexOfDate",
	"previousRecurrenceDate",
	"transformRecurrenceRule",
]) {
	requireText(sharedOccurrences, helper, `sdílený series helper ${helper}`);
	requireText(seriesTests, helper, `regrese series helperu ${helper}`);
}

if (failures.length) {
	console.error(`Recurrence contract selhal (${failures.length}):`);
	for (const failure of failures) console.error(` - ${failure}`);
	process.exit(1);
}

console.log(
	"Recurrence contract ověřen: tři command-only rozsahy, prefix historie, preview/undo, export, projekce a a11y.",
);
