/**
 * Tabulky dnů v týdnu. VERBATIM z prototypu.
 * - WD_RECUR (§11, ř. 2018–2026): skloňované stemy + české labely pro opakování.
 * - WD_BARE  (§9,  ř. 2292):     stemy pro holý den v týdnu (termín, ne opakování).
 * Weekday = JS getDay: neděle=0 … sobota=6.
 */
import type { Weekday } from "../types";

export interface WeekdayRecur {
	st: string;
	d: Weekday;
	every: string;
	every2: string;
	evenL: string;
	oddL: string;
	nom: string;
}

export const WD_RECUR: WeekdayRecur[] = [
	{
		st: "pond[ěe]l[íi]",
		d: 1,
		every: "Každé pondělí",
		every2: "Každé druhé pondělí",
		evenL: "Každé sudé pondělí",
		oddL: "Každé liché pondělí",
		nom: "pondělí",
	},
	{
		st: "[úu]ter[ýyíi]",
		d: 2,
		every: "Každé úterý",
		every2: "Každé druhé úterý",
		evenL: "Každé sudé úterý",
		oddL: "Každé liché úterý",
		nom: "úterý",
	},
	{
		st: "st[řr]ed[uaye]",
		d: 3,
		every: "Každou středu",
		every2: "Každou druhou středu",
		evenL: "Každou sudou středu",
		oddL: "Každou lichou středu",
		nom: "středa",
	},
	{
		st: "[čc]tvrt(?:ek|ku|ky)",
		d: 4,
		every: "Každý čtvrtek",
		every2: "Každý druhý čtvrtek",
		evenL: "Každý sudý čtvrtek",
		oddL: "Každý lichý čtvrtek",
		nom: "čtvrtek",
	},
	{
		st: "p[áa]t(?:ek|ku|ky)",
		d: 5,
		every: "Každý pátek",
		every2: "Každý druhý pátek",
		evenL: "Každý sudý pátek",
		oddL: "Každý lichý pátek",
		nom: "pátek",
	},
	{
		st: "sobot[uaye]",
		d: 6,
		every: "Každou sobotu",
		every2: "Každou druhou sobotu",
		evenL: "Každou sudou sobotu",
		oddL: "Každou lichou sobotu",
		nom: "sobota",
	},
	{
		st: "ned[ěe]l[iey]",
		d: 0,
		every: "Každou neděli",
		every2: "Každou druhou neděli",
		evenL: "Každou sudou neděli",
		oddL: "Každou lichou neděli",
		nom: "neděle",
	},
];

/** §9 — holý den v týdnu (stem → weekday). */
export const WD_BARE: { st: string; d: Weekday }[] = [
	{ st: "pond[ěe]l", d: 1 },
	{ st: "[úu]ter", d: 2 },
	{ st: "st[řr]ed", d: 3 },
	{ st: "[čc]tvrt", d: 4 },
	{ st: "p[áa]t(?:ek|ku|ky)", d: 5 },
	{ st: "sobot", d: 6 },
	{ st: "ned[ěe]l", d: 0 },
];

/** §11 — n-tý: poslední=-1, první=1 … páté=5. VERBATIM (ř. 2031). */
export const NTH_DEFS: [string, number][] = [
	["posledn[íiěe]?", -1],
	["prvn[íie]", 1],
	["druh[éouý]", 2],
	["t[řr]et[íi]", 3],
	["[čc]tvrt[éouý]", 4],
	["p[áa]t[éouý]", 5],
];
