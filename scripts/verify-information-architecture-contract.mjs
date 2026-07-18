#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const nav = read("apps/web/src/layout/nav.ts");
const sidebar = read("apps/web/src/layout/Sidebar.tsx");
const mobile = read("apps/web/src/layout/MobileTabBar.tsx");
const preferences = read("apps/web/src/lib/navigationPreferences.ts");
const settings = read("apps/web/src/screens/Nastaveni.tsx");
const overview = read("apps/web/src/screens/Prehled.tsx");
const taskShell = read("apps/web/src/screens/UkolyShell.tsx");
const mailThread = read("apps/web/src/mail/MailThread.tsx");
const router = read("apps/web/src/router.tsx");
const cs = read("packages/i18n/src/locales/cs.json");
const en = read("packages/i18n/src/locales/en.json");
const uiVerifier = read("apps/api/verify-information-architecture-ui.ts");

const core = nav.slice(nav.indexOf("export const CORE_NAV"), nav.indexOf("export const TOOL_NAV"));
const tools = nav.slice(nav.indexOf("export const TOOL_NAV"), nav.indexOf("export const MAIN_NAV"));
const checks = [
	[
		"jádro drží Přehled, Mail, Úkoly a Nadcházející; pokročilé nástroje jsou oddělené",
		core.includes('to: "/prehled"') &&
			core.includes('to: "/mail"') &&
			core.includes('to: "/ukoly"') &&
			core.includes('to: "/nadchazejici"') &&
			!core.includes('to: "/schranka"') &&
			!core.includes('to: "/projekty"') &&
			tools.includes('to: "/projekty"') &&
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
		"sidebar má jeden Přehled a jeden modul Úkoly bez duplicitních denních vstupů",
		!sidebar.includes('t("nav.personalizedEntries")') &&
			sidebar.includes("{CORE_NAV.map(renderNavItem)}") &&
			sidebar.includes('path.startsWith("/schranka")') &&
			taskShell.includes('to="/schranka"') &&
			taskShell.includes('t("tasks.tabIncoming")'),
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
			overview.includes('search: (current) => ({ ...current, vstup: "tym" })') &&
			overview.includes("replace: true") &&
			overview.includes("leadershipWorkspaceIds.has(workspaceId)") &&
			overview.includes("leadershipWorkspaceIds.has(g.wsId)"),
	],
	[
		"Přehled a Dnes zůstávají odlišné a Tým/Provoz jsou řezy uvnitř Přehledu",
		overview.includes('surface === "overview"') &&
			overview.includes('surface !== "provoz"') &&
			overview.includes('surface !== "tym"') &&
			overview.includes('search: (current) => ({ ...current, vstup: "tym" })') &&
			!sidebar.includes('search={{ vstup: "tym" }}'),
	],
	[
		"mobil má stejné čtyři hlavní moduly, Úkoly zahrnují Příchozí a cíle mají 44px",
		mobile.includes('{ to: "/prehled", icon: "prehled"') &&
			mobile.includes('activePrefixes: ["/ukoly", "/schranka"]') &&
			mobile.includes('{ to: "/mail", icon: "mail"') &&
			mobile.includes('to: "/nadchazejici"') &&
			mobile.includes('minHeight: 44') &&
			!mobile.includes('aria-label={t("nav.personalizedEntries")}'),
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
