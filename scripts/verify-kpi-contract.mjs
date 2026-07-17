import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [reports, controlRoom, card, mailState, mailDigest, cs, en] = await Promise.all([
	read("../apps/web/src/screens/Reporty.tsx"),
	read("../apps/web/src/screens/Velin.tsx"),
	read("../apps/web/src/components/KpiCard.tsx"),
	read("../apps/web/src/mail/state.tsx"),
	read("../apps/web/src/mail/digest.ts"),
	read("../packages/i18n/src/locales/cs.json"),
	read("../packages/i18n/src/locales/en.json"),
]);

const failures = [];
const cards = (source) => source.match(/<KpiCard[\s\S]*?\/>/g) ?? [];
const reportCards = cards(reports);
const controlRoomCards = cards(controlRoom);
if (reportCards.length !== 3) failures.push(`Reporty: očekávány 3 KPI karty, nalezeno ${reportCards.length}`);
if (controlRoomCards.length !== 5) failures.push(`Velín: očekáváno 5 KPI karet, nalezeno ${controlRoomCards.length}`);
for (const [surface, surfaceCards] of [
	["Reporty", reportCards],
	["Velín", controlRoomCards],
]) {
	for (const [index, source] of surfaceCards.entries()) {
		for (const field of ["scope", "period", "timeZone", "exclusions", "formula"]) {
			if (!source.includes(`${field}:`)) failures.push(`${surface} KPI ${index + 1}: chybí ${field}`);
		}
	}
}

for (const needle of ["data-kpi-definition", "metrics.scope", "metrics.period", "metrics.timeZone", "metrics.exclusions", "metrics.freshness", "data-kpi-formula"]) {
	if (!card.includes(needle)) failures.push(`KpiCard: chybí ${needle}`);
}
if (card.includes("title=")) failures.push("KpiCard: zásadní definice nesmí být jen v tooltipu");

if (!controlRoom.includes("String(digest.urgent)")) {
	failures.push("Velín: urgentní KPI musí používat celý digest, ne délku top náhledu");
}
const digestSource = mailState.slice(mailState.indexOf("export function useMailDigest"));
if (
	digestSource.indexOf("const urgent = inbox.filter") < 0 ||
	digestSource.indexOf("const urgent = inbox.filter") > digestSource.indexOf(".slice(0, 8)")
) {
	failures.push("Mail digest: urgentní počet musí vzniknout z celého inboxu před omezením top-8");
}
if (
	!mailState.includes("countsAsUnread({") ||
	!mailDigest.includes("state.spam") ||
	!mailDigest.includes("state.closed")
) {
	failures.push("Mail digest: nepřečtené KPI nesmí započítat spam nebo uzavřená vlákna");
}

for (const [locale, source] of [["cs", cs], ["en", en]]) {
	for (const key of ["scope", "period", "timeZone", "exclusions", "freshness", "formula"]) {
		if (!source.includes(`"${key}"`)) failures.push(`${locale}: chybí překlad metrics.${key}`);
	}
}

if (failures.length) {
	console.error(`KPI kontrakt selhal (${failures.length}):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log("KPI kontrakt: Reporty a Velín zveřejňují rozsah, období, zónu, výluky, čerstvost i výpočet.");
