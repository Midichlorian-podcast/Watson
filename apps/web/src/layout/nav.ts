import type { IconName } from "@watson/ui";

export interface NavItem {
	to: string;
	icon: IconName;
	labelKey: string;
	/** Zobrazit počítadlo (např. Schránka). */
	count?: boolean;
}

/** Hlavní navigace (dle Claude Design handoffu). Počty (badge): Schránka/Dnes/Nadcházející/Úkoly. */
export const MAIN_NAV: NavItem[] = [
	{ to: "/prehled", icon: "prehled", labelKey: "nav.overview" },
	{ to: "/hledat", icon: "hledat", labelKey: "nav.search" },
	{ to: "/schranka", icon: "schranka", labelKey: "nav.inbox", count: true },
	{ to: "/", icon: "dnes", labelKey: "nav.today", count: true },
	{
		to: "/nadchazejici",
		icon: "nadchazejici",
		labelKey: "nav.upcoming",
		count: true,
	},
	{ to: "/ukoly", icon: "ukoly", labelKey: "nav.tasks", count: true },
	{ to: "/projekty", icon: "projekty", labelKey: "nav.projects" },
	{ to: "/seznamy", icon: "seznamy", labelKey: "nav.lists", count: true },
	{ to: "/cile", icon: "cile", labelKey: "nav.goals" },
	{ to: "/reporty", icon: "reporty", labelKey: "nav.reports" },
	{ to: "/postupy", icon: "postup", labelKey: "nav.flows" },
];

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

export const ALL_NAV: NavItem[] = [
	...MAIN_NAV,
	...FAV_NAV,
	SETTINGS_NAV,
	VELIN_NAV,
];
