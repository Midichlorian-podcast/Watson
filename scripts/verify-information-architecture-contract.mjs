#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const nav = read("apps/web/src/layout/nav.ts");
const sidebar = read("apps/web/src/layout/Sidebar.tsx");
const mobile = read("apps/web/src/layout/MobileTabBar.tsx");
const preferences = read("apps/web/src/lib/navigationPreferences.ts");
const settings = read("apps/web/src/screens/Nastaveni.tsx");
const overview = read("apps/web/src/screens/Prehled.tsx");
const mailThread = read("apps/web/src/mail/MailThread.tsx");
const router = read("apps/web/src/router.tsx");
const cs = read("packages/i18n/src/locales/cs.json");
const en = read("packages/i18n/src/locales/en.json");
const uiVerifier = read("apps/api/verify-information-architecture-ui.ts");

const core = nav.slice(nav.indexOf("export const CORE_NAV"), nav.indexOf("export const TOOL_NAV"));
const tools = nav.slice(nav.indexOf("export const TOOL_NAV"), nav.indexOf("export const MAIN_NAV"));
const checks = [
	[
		"denní jádro a pokročilé nástroje jsou oddělené bez odstranění rout",
		core.includes('to: "/prehled"') &&
			core.includes('to: "/ukoly"') &&
			tools.includes('to: "/znalosti"') &&
			tools.includes('to: "/postupy"'),
	],
	[
		"Seznamy mají nižší navigační váhu, ale zůstávají přímo v nástrojích",
		!core.includes('to: "/seznamy"') && tools.includes('to: "/seznamy"'),
	],
	[
		"vedený režim je bezpečný default a pokročilý režim je explicitní preference",
		preferences.includes('storageGet(KEY) === "advanced" ? "advanced" : "guided"') &&
			preferences.includes('window.dispatchEvent(new Event(CHANGE_EVENT))') &&
			settings.includes("setNavigationMode"),
	],
	[
		"sidebar nabízí tři personalizované vstupy a Provoz gateuje rolí vedení",
		sidebar.includes('t("nav.myDay")') &&
			sidebar.includes('search={{ vstup: "tym" }}') &&
			sidebar.includes('search={{ vstup: "provoz" }}') &&
			sidebar.includes("{leadership && ("),
	],
	[
		"pokročilé nástroje jsou jeden explicitní krok daleko a aktivní cíl se neschová",
		sidebar.includes('t("nav.allTools")') &&
			sidebar.includes('navigationMode === "advanced"') &&
			sidebar.includes("toolsOpen || toolRouteActive"),
	],
	[
		"Team/Operations deep-link přijímá jen uzavřený enum",
		router.includes('s.vstup === "tym" || s.vstup === "provoz"'),
	],
	[
		"Provoz se omezuje na skutečně vedené prostory a členův deep-link přesměruje na Tým",
		overview.includes('vstup !== "provoz" || leadership') &&
			overview.includes('search: { vstup: "tym" }, replace: true') &&
			overview.includes("leadershipWorkspaceIds.has(workspaceId)") &&
			overview.includes("leadershipWorkspaceIds.has(g.wsId)"),
	],
	[
		"Přehled a Dnes zůstávají odlišné a týmový/provozní řez skrývá osobní karty",
		overview.includes('surface === "overview"') &&
			overview.includes('surface !== "provoz"') &&
			overview.includes('surface !== "tym"') &&
			overview.includes('navigate({ to: "/", search: {} })'),
	],
	[
		"mobil má stejné role-aware vstupy s 44px cíli",
		mobile.includes('aria-label={t("nav.personalizedEntries")}') &&
			mobile.includes('min-h-11') &&
			mobile.includes("{leadership && ("),
	],
	[
		"copy existuje česky i anglicky pro navigaci a vysvětlení povrchů",
		cs.includes('"personalizedEntries": "Moje vstupy"') &&
			cs.includes('"surfaceDescription"') &&
			en.includes('"personalizedEntries": "My entry points"') &&
			en.includes('"surfaceDescription"'),
	],
	[
		"browser audit pokrývá oba enginy, role, persistence, mobil a WCAG",
		uiVerifier.includes("chromium,webkit") &&
			uiVerifier.includes('provision(browserName, "member")') &&
			uiVerifier.includes("assertAxeClean") &&
			uiVerifier.includes("assertNoOverflow") &&
			uiVerifier.includes("page.reload"),
	],
	[
		"scope lock nepřidal samostatný interní chat, whiteboard ani databázový builder",
		!overview.includes("chatBuilder") &&
			!overview.includes("whiteboard") &&
			!overview.includes("databaseBuilder") &&
			!mailThread.includes("data-chattabs") &&
			!mailThread.includes("data-chatrail") &&
			!mailThread.includes("Interní chat") &&
			cs.includes('"chat": "Interní komentáře k vláknu"'),
	],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length) {
	console.error(`Information architecture contract failed: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("Information architecture contract: personalized, progressive, role-aware and reversible.");
