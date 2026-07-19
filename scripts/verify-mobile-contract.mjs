import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [taskCard, mobileNav, mobileCss, mailScreen] = await Promise.all([
	read("../packages/ui/src/TaskCard.tsx"),
	read("../apps/web/src/layout/MobileTabBar.tsx"),
	read("../apps/web/src/index.css"),
	read("../apps/web/src/mail/MailScreen.tsx"),
]);

const failures = [];
const requireText = (source, needle, message) => {
	if (!source.includes(needle)) failures.push(message);
};

requireText(taskCard, 'className="w-taskmain min-w-0 flex-1"', "TaskCard: chybí mobilní hlavní oblast");
requireText(taskCard, 'className="w-taskquick ', "TaskCard: chybí dotyková nabídka rychlých akcí");
if (taskCard.indexOf("{quickMenu && (") > taskCard.indexOf('<span className="w-taskmeta">')) {
	failures.push("TaskCard: rychlé akce musí být před metadaty v prvním mobilním řádku");
}

for (const [needle, message] of [
	["overscroll-behavior-x: none;", "CSS: viewport neblokuje horizontální Safari overscroll"],
	["overflow-x: clip;", "CSS: dokument není horizontální scroll container"],
	[".w-taskmain {", "CSS: chybí mobilní rozbalení hlavní oblasti karty"],
	[".w-taskmeta {", "CSS: chybí samostatný řádek metadat"],
	["order: 1;", "CSS: metadata nemají stabilní pořadí"],
	[".w-tasksub {", "CSS: chybí řádek projektu a kontextu"],
	["order: 2;", "CSS: projekt a kontext nemají stabilní pořadí"],
	["width: 44px;", "CSS: dotyková akce nemá minimální šířku 44 px"],
	["height: 44px;", "CSS: dotyková akce nemá minimální výšku 44 px"],
]) requireText(mobileCss, needle, message);

for (const [needle, message] of [
	["data-mobile-primary", "MobileTabBar: chybí jednoznačný primární navigační landmark"],
	['aria-label={t("nav.mobilePrimary")}', "MobileTabBar: primární navigace nemá název"],
	['aria-current={active ? "page" : undefined}', "MobileTabBar: aktivní cíl není oznámen"],
	['aria-expanded={moreOpen}', "MobileTabBar: tlačítko Více neoznamuje stav"],
	['aria-controls="mobile-more-sheet"', "MobileTabBar: tlačítko Více není spojeno se sheetem"],
	['maxHeight: "calc(100dvh - 12px)"', "MobileTabBar: sheet není omezen výškou viewportu"],
	['overflowY: "auto"', "MobileTabBar: dlouhý sheet nelze posouvat"],
	['? "calc(var(--w-layer-drawer) - 1)"', "MobileTabBar: otevřený sheet musí překrýt primární lištu"],
	["minHeight: 44", "MobileTabBar: přepínač prostoru nesplňuje dotykový cíl"],
]) requireText(mobileNav, needle, message);

if ((mobileNav.match(/data-mobile-primary/g) ?? []).length !== 1) {
	failures.push("MobileTabBar: musí existovat právě jedna primární mobilní lišta");
}
if (!mailScreen.includes("Mobilní spodní lišta modulu ZRUŠENA")) {
	failures.push("MailScreen: modul nesmí obnovit druhou spodní navigační lištu");
}

if (failures.length) {
	console.error(`Mobilní kontrakt selhal (${failures.length}):\n${failures.join("\n")}`);
	process.exit(1);
}

console.log("Mobilní kontrakt: jedna navigace, dosažitelný sheet a čitelná hierarchie karty úkolu.");
