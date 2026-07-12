import type { IconName } from "@watson/ui";

export interface NavItem {
	to: string;
	icon: IconName;
	labelKey: string;
	/** Zobrazit počítadlo (např. Schránka). */
	count?: boolean;
}

/**
 * „Dnes" = domovská routa `/` (záložka Dnes sloučeného modulu Úkoly). NENÍ samostatná plochá
 * položka navigace — v Sidebaru se renderuje jako zanořená pod „Úkoly". Drženo v ALL_NAV kvůli
 * titulku headeru a jako badge (dnes+zpožděné bez nedatovaných).
 */
export const TODAY_NAV: NavItem = {
	to: "/",
	icon: "dnes",
	labelKey: "nav.today",
	count: true,
};

/**
 * Hlavní navigace (dle Claude Design handoffu). „Úkoly" je sloučený modul (Dnes/Vše/Zásobník) —
 * v Sidebaru se rozbaluje na zanořené záložky (viz Sidebar). Počty: Schránka/Dnes/Nadcházející/Zásobník.
 */
export const MAIN_NAV: NavItem[] = [
	{ to: "/prehled", icon: "prehled", labelKey: "nav.overview" },
	{ to: "/hledat", icon: "hledat", labelKey: "nav.search" },
	{ to: "/schranka", icon: "schranka", labelKey: "nav.inbox", count: true },
	{ to: "/mail", icon: "mail", labelKey: "nav.mail", count: true },
	{ to: "/mitingy", icon: "tym", labelKey: "nav.meetings" },
	{ to: "/ukoly", icon: "ukoly", labelKey: "nav.tasks" },
	{
		to: "/nadchazejici",
		icon: "nadchazejici",
		labelKey: "nav.upcoming",
		count: true,
	},
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

export const ALL_NAV: NavItem[] = [TODAY_NAV, ...MAIN_NAV, ...FAV_NAV, SETTINGS_NAV, VELIN_NAV];
