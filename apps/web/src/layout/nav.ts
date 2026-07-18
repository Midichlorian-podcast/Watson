import type { IconName } from "@watson/ui";

export interface NavItem {
	to: string;
	icon: IconName;
	labelKey: string;
	/** Zobrazit počítadlo (např. Schránka). */
	count?: boolean;
}

/** „Dnes" = domovská záložka sloučeného modulu Úkoly. V ALL_NAV zůstává kvůli titulku. */
export const TODAY_NAV: NavItem = {
	to: "/",
	icon: "dnes",
	labelKey: "nav.today",
	count: true,
};

/** Vyhledávání zůstává routa i titulkový cíl, ale neobsazuje místo v hlavním sidebaru. */
export const SEARCH_NAV: NavItem = {
	to: "/hledat",
	icon: "hledat",
	labelKey: "nav.search",
};

/** Původní deep-link Schránky zůstává titulkový cíl, ale žije jako Příchozí v Úkolech. */
export const INBOX_NAV: NavItem = {
	to: "/schranka",
	icon: "schranka",
	labelKey: "nav.inbox",
	count: true,
};

/**
 * Jádro navigace zůstává krátké i při růstu Watsonu. Vedené zobrazení ukazuje
 * tyto cíle přímo; ostatní plně funkční moduly jsou o jeden explicitní krok níž.
 */
export const CORE_NAV: NavItem[] = [
	{ to: "/prehled", icon: "prehled", labelKey: "nav.overview" },
	{ to: "/mail", icon: "mail", labelKey: "nav.mail", count: true },
	{ to: "/ukoly", icon: "ukoly", labelKey: "nav.tasks", count: true },
	{
		to: "/nadchazejici",
		icon: "nadchazejici",
		labelKey: "nav.upcoming",
		count: true,
	},
];

/**
 * Pokročilé nástroje. Seznamy zůstávají snadno dostupné, ale nejsou rovnocenné
 * každodenním vstupům — přesně podle scope locku informační architektury.
 */
export const TOOL_NAV: NavItem[] = [
	{ to: "/projekty", icon: "projekty", labelKey: "nav.projects" },
	{ to: "/meets", icon: "tym", labelKey: "nav.meetings" },
	{ to: "/prijem-prace", icon: "schranka", labelKey: "nav.intake" },
	{ to: "/seznamy", icon: "seznamy", labelKey: "nav.lists", count: true },
	{ to: "/znalosti", icon: "popis", labelKey: "nav.knowledge" },
	{ to: "/cile", icon: "cile", labelKey: "nav.goals" },
	{ to: "/reporty", icon: "reporty", labelKey: "nav.reports" },
	{ to: "/postupy", icon: "postup", labelKey: "nav.flows" },
];

export const MAIN_NAV: NavItem[] = [...CORE_NAV, ...TOOL_NAV];

/** Oblíbené (rychlé filtry). */
export const FAV_NAV: NavItem[] = [
	{ to: "/oblibene/p1", icon: "priorita", labelKey: "nav.priority1" },
	{ to: "/oblibene/me", icon: "prirazeni", labelKey: "nav.assignedToMe" },
];

export const SETTINGS_NAV: NavItem = {
	to: "/nastaveni",
	icon: "nastaveni",
	labelKey: "nav.settings",
};

/** Velín — v sidebaru podmíněně (jen vedení), v ALL_NAV kvůli titulku headeru. */
export const VELIN_NAV: NavItem = {
	to: "/velin",
	icon: "velin",
	labelKey: "nav.velin",
};

/** Employee Hub je viditelný pouze po potvrzeném osobním napojení na LuckyOS. */
export const EMPLOYEE_NAV: NavItem = {
	to: "/zamestnanec",
	icon: "tym",
	labelKey: "nav.employee",
};

export const ALL_NAV: NavItem[] = [
	TODAY_NAV,
	INBOX_NAV,
	SEARCH_NAV,
	...MAIN_NAV,
	...FAV_NAV,
	SETTINGS_NAV,
	VELIN_NAV,
	EMPLOYEE_NAV,
];
