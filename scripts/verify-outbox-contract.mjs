import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [component, helper, settings, releaseE2e, cs, en] = await Promise.all([
	read("../apps/web/src/components/SyncProblems.tsx"),
	read("../apps/web/src/lib/powersync/outbox.ts"),
	read("../apps/web/src/screens/Nastaveni.tsx"),
	read("../apps/api/verify-release-e2e.ts"),
	read("../packages/i18n/src/locales/cs.json"),
	read("../packages/i18n/src/locales/en.json"),
]);

const failures = [];
for (const needle of [
	"getUploadQueueStats(true)",
	"getCrudBatch(50)",
	"data-sync-outbox",
	"data-outbox-pending",
	"data-outbox-rejected",
	"data-outbox-diff",
	"retryRejectedOperation",
	"problemCopy",
	"problemDiscard",
]) {
	if (!component.includes(needle)) failures.push(`Outbox UI: chybí ${needle}`);
}

for (const forbidden of [".complete(", "DELETE FROM ps_crud", "DELETE FROM powersync_crud"]) {
	if (component.includes(forbidden)) {
		failures.push(`Outbox UI: čekající frontu nesmí měnit přes ${forbidden}`);
	}
}

if (component.includes("JSON.stringify(row")) {
	failures.push("Outbox UI: kopie nesmí obcházet redakci přes raw rejected payload");
}
if (!component.includes("changes: operationDiff(operation, Number.MAX_SAFE_INTEGER)")) {
	failures.push("Outbox UI: technická kopie musí obsahovat úplný sanitizovaný diff");
}

for (const needle of ["SENSITIVE_FIELD", "••••••", "safeValue", "operationDiff"]) {
	if (!helper.includes(needle)) failures.push(`Outbox redakce: chybí ${needle}`);
}

if (!settings.includes('import { SyncProblems } from "../components/SyncProblems"')) {
	failures.push("Nastavení: chybí existující integrace outboxu");
}
if (!settings.includes('activeSection === "data"') || !settings.includes("<SyncProblems />")) {
	failures.push("Nastavení: outbox musí zůstat v sekci Data");
}

for (const needle of [
	"pendingOutboxReviewed",
	"rejectedOutboxDiff",
	"outbox-pending-390",
	"outbox-rejected-390",
	"offline_outbox",
	"rejected_outbox",
]) {
	if (!releaseE2e.includes(needle)) failures.push(`Release E2E: chybí důkaz ${needle}`);
}

for (const [locale, source] of [
	["cs", cs],
	["en", en],
]) {
	for (const key of ["outboxTitle", "outboxPendingTitle", "outboxBefore", "outboxAfter"]) {
		if (!source.includes(`"${key}"`)) failures.push(`${locale}: chybí překlad sync.${key}`);
	}
}

if (failures.length) {
	console.error(`Outbox kontrakt selhal (${failures.length}):\n${failures.join("\n")}`);
	process.exit(1);
}

console.log(
	"Outbox kontrakt: čekající fronta je pouze pro čtení, citlivá pole se redigují a obnovovací akce mají browser důkaz.",
);
