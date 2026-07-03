/**
 * §11 — parseRecurrence: rozpoznání opakování z fráze. Větve A (příslovce) /
 * B (den v týdnu: n-tý/parita/každý) / C (den v měsíci) / D (obecné jednotky).
 * Počítá `startISO` z reálného `today` (dates.ts). VERBATIM tabulky v lexicon/.
 *
 * Produkční úprava (#13): místo globálního RECVOCAB stripu vrací `consumed` — přesné
 * rozsahy tokenů, které opakování spotřebovalo. Caller je vyřízne z názvu podle indexu,
 * takže se z názvu nemažou stejně znějící slova (např. „hodinky", „středisko", „druha").
 */
import {
	nextMonthDayISO,
	nthWeekdayISO,
	weekdayDate,
	weekdayParityISO,
} from "./dates";
import { ordinalDay } from "./lexicon/ordinals";
import { NTH_DEFS, WD_RECUR, type WeekdayRecur } from "./lexicon/weekdays";
import type { RecurrenceRule } from "./types";

/** Rozsah tokenu ve vstupním textu (půlotevřený interval). */
export interface Span {
	start: number;
	end: number;
}

export interface RecurrenceResult {
	rule: RecurrenceRule;
	/** první výskyt (jen u konkrétního dne/n-tého/dne v měsíci) */
	startISO?: string;
	/** čas z fráze v minutách od půlnoci (jen když ho nezachytil §4) */
	timeMin?: number;
	/** rozsahy tokenů, které opakování spotřebovalo (pro cílené vyříznutí z názvu) */
	consumed: Span[];
}

/** Najde stem ohraničený ne-písmeny a vrátí jeho rozsah (nebo null). */
function findStem(stem: string, s: string): Span | null {
	let re: RegExp;
	try {
		re = new RegExp(`(?<![\\p{L}])(?:${stem})(?![\\p{L}])`, "iu");
	} catch {
		re = new RegExp(`(?:^|[^\\p{L}])(?:${stem})(?![\\p{L}])`, "iu");
	}
	const m = re.exec(s);
	if (!m) return null;
	// fallback (bez lookbehind) může zahrnout vedoucí oddělovač → posuň start za něj
	const lead = m[0].match(/^[^\p{L}]*/u)?.[0].length ?? 0;
	return { start: m.index + lead, end: m.index + m[0].length };
}

export function parseRecurrence(
	text: string,
	today: string,
): RecurrenceResult | null {
	const s = text.toLowerCase();
	const consumed: Span[] = [];
	const take = (sp: Span | null): void => {
		if (sp) consumed.push(sp);
	};

	const tm = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
	const timeMin = tm ? +tm[1]! * 60 + +tm[2]! : undefined;

	const kSpan = findStem("ka[žz]d\\p{L}*", s);
	const hasK = kSpan !== null;
	const evenSpan = findStem("sud[éýáou]\\p{L}*", s);
	const oddSpan = findStem("lich[éýáou]\\p{L}*", s);
	const evenOdd: "even" | "odd" | null = evenSpan
		? "even"
		: oddSpan
			? "odd"
			: null;

	// Větev A — bez „každ" a bez sudý/lichý: příslovce
	if (!hasK && !evenOdd) {
		const advs: [string, RecurrenceRule][] = [
			["denně|denne", { kind: "daily", label: "Denně" }],
			["týdně|tydne", { kind: "weekly", label: "Týdně" }],
			["měsíčně|mesicne", { kind: "monthly", label: "Měsíčně" }],
			["ročně|rocne", { kind: "yearly", label: "Ročně" }],
		];
		for (const [stem, rule] of advs) {
			const sp = findStem(stem, s);
			if (sp) return { rule, timeMin, consumed: [sp] };
		}
		return null;
	}

	take(kSpan);
	take(evenOdd === "even" ? evenSpan : oddSpan);

	let wd: WeekdayRecur | null = null;
	let wdSpan: Span | null = null;
	for (const w of WD_RECUR) {
		const sp = findStem(w.st, s);
		if (sp) {
			wd = w;
			wdSpan = sp;
			break;
		}
	}
	// „v měsíci" / „měsíci" (volitelné vedoucí „v ") — jeden rozsah včetně předložky.
	const monthMatch = s.match(/\b(?:v\s+)?m[ěe]s[íi]c\p{L}*(?![\p{L}])/u);
	const inMonthSpan = monthMatch
		? {
				start: monthMatch.index!,
				end: monthMatch.index! + monthMatch[0].length,
			}
		: null;
	const inMonth = inMonthSpan !== null;

	// Větev B — den v týdnu rozpoznán
	if (wd) {
		take(wdSpan);
		if (inMonth) {
			let nth: number | null = null;
			let nthSpan: Span | null = null;
			for (const [stem, val] of NTH_DEFS) {
				const sp = findStem(stem, s);
				if (sp) {
					nth = val;
					nthSpan = sp;
					break;
				}
			}
			if (nth != null) {
				take(nthSpan);
				take(inMonthSpan);
				const label =
					nth === -1
						? `Poslední ${wd.nom} v měsíci`
						: `${nth}. ${wd.nom} v měsíci`;
				return {
					rule: { kind: "monthly-nth", nth, weekday: wd.d, label },
					startISO: nthWeekdayISO(nth, wd.d, today) ?? undefined,
					timeMin,
					consumed,
				};
			}
		}
		if (evenOdd) {
			return {
				rule: {
					kind: "biweekly",
					weekday: wd.d,
					parity: evenOdd,
					label: evenOdd === "even" ? wd.evenL : wd.oddL,
				},
				startISO: weekdayParityISO(wd.d, evenOdd, today),
				timeMin,
				consumed,
			};
		}
		const biSpan =
			findStem("druh[éouýá]\\p{L}*", s) ??
			findStem("dva", s) ??
			findStem("dvou", s);
		take(biSpan);
		const bi = biSpan !== null;
		return {
			rule: {
				kind: bi ? "biweekly" : "weekly",
				weekday: wd.d,
				label: bi ? wd.every2 : wd.every,
			},
			startISO: weekdayDate(wd.d, 0, today),
			timeMin,
			consumed,
		};
	}

	// Větev C — den v měsíci číslem/slovem
	let day = ordinalDay(s);
	let daySpans: Span[] = [];
	if (day != null) {
		// řadové číslovky v genitivu (pátého, dvacátého…) — zachyť jejich rozsahy
		const re = /(?<![\p{L}])\p{L}+(?:ého|ího|eho|iho)(?![\p{L}])/gu;
		let om: RegExpExecArray | null;
		while ((om = re.exec(s)))
			daySpans.push({ start: om.index, end: om.index + om[0].length });
	} else {
		const dm = s.match(/(\d{1,2})\.(?!\s*\d)/);
		if (dm) {
			const nn = +dm[1]!;
			if (nn >= 1 && nn <= 31) {
				day = nn;
				daySpans = [{ start: dm.index!, end: dm.index! + dm[0].length }];
			}
		}
	}
	if (day != null) {
		for (const sp of daySpans) take(sp);
		take(inMonthSpan);
		return {
			rule: { kind: "monthly-day", day, label: `${day}. v měsíci` },
			startISO: nextMonthDayISO(day, today),
			timeMin,
			consumed,
		};
	}

	// Větev D — obecné jednotky (fallback)
	const daySp =
		findStem("den", s) ?? findStem("dny", s) ?? findStem("denn[íěe]", s);
	if (daySp) {
		take(daySp);
		return { rule: { kind: "daily", label: "Každý den" }, timeMin, consumed };
	}
	const weekSp = findStem("t[ýy]den", s) ?? findStem("t[ýy]dn[ěeyů]", s);
	if (weekSp) {
		take(weekSp);
		const bi2 = findStem("druh[éouýá]\\p{L}*", s) ?? findStem("dva", s);
		take(bi2);
		const bi = bi2 !== null || /\b2\b/.test(s);
		return {
			rule: {
				kind: bi ? "biweekly" : "weekly",
				label: bi ? "Každé 2 týdny" : "Každý týden",
			},
			timeMin,
			consumed,
		};
	}
	const monthSp = findStem("m[ěe]s[íi]c", s) ?? findStem("m[ěe]s[íi]ce", s);
	if (monthSp) {
		take(monthSp);
		return {
			rule: { kind: "monthly", label: "Každý měsíc" },
			timeMin,
			consumed,
		};
	}
	const yearSp =
		findStem("rok", s) ?? findStem("roce", s) ?? findStem("roky", s);
	if (yearSp) {
		take(yearSp);
		return { rule: { kind: "yearly", label: "Každý rok" }, timeMin, consumed };
	}

	return null;
}
