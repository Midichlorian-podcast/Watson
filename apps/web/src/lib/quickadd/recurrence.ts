/**
 * §11 — parseRecurrence: rozpoznání opakování z fráze. Větve A (příslovce) /
 * B (den v týdnu: n-tý/parita/každý) / C (den v měsíci) / D (obecné jednotky).
 * Počítá `startISO` z reálného `today` (dates.ts). VERBATIM tabulky v lexicon/.
 */
import { nextMonthDayISO, nthWeekdayISO, weekdayDate, weekdayParityISO } from "./dates";
import { ordinalDay } from "./lexicon/ordinals";
import { NTH_DEFS, WD_RECUR, type WeekdayRecur } from "./lexicon/weekdays";
import type { RecurrenceRule } from "./types";

export interface RecurrenceResult {
  rule: RecurrenceRule;
  /** první výskyt (jen u konkrétního dne/n-tého/dne v měsíci) */
  startISO?: string;
  /** čas z fráze v minutách od půlnoci (jen když ho nezachytil §4) */
  timeMin?: number;
}

/** Slovo ohraničené ne-písmeny (robustní `\b` pro unicode), fallback bez lookbehind. */
function B(stem: string, s: string): boolean {
  try {
    return new RegExp(`(?<![\\p{L}])(?:${stem})(?![\\p{L}])`, "u").test(s);
  } catch {
    return new RegExp(`(?:^|[^a-zà-ž])(?:${stem})(?![a-zà-ž])`).test(s);
  }
}

export function parseRecurrence(text: string, today: string): RecurrenceResult | null {
  const s = text.toLowerCase();

  const tm = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const timeMin = tm ? +tm[1]! * 60 + +tm[2]! : undefined;

  const hasK = /každ|kazd/.test(s);
  const evenOdd: "even" | "odd" | null = B("sud[éýáou]\\w*", s)
    ? "even"
    : B("lich[éýáou]\\w*", s)
      ? "odd"
      : null;

  // Větev A — bez „každ" a bez sudý/lichý: příslovce
  if (!hasK && !evenOdd) {
    if (B("denně", s) || B("denne", s)) return { rule: { kind: "daily", label: "Denně" }, timeMin };
    if (B("týdně", s) || B("tydne", s)) return { rule: { kind: "weekly", label: "Týdně" }, timeMin };
    if (B("měsíčně", s) || B("mesicne", s)) return { rule: { kind: "monthly", label: "Měsíčně" }, timeMin };
    if (B("ročně", s) || B("rocne", s)) return { rule: { kind: "yearly", label: "Ročně" }, timeMin };
    return null;
  }

  let wd: WeekdayRecur | null = null;
  for (const w of WD_RECUR) {
    if (B(w.st, s)) {
      wd = w;
      break;
    }
  }
  const inMonth = B("m[ěe]s[íi]ci", s) || /\bv\s+m[ěe]s/.test(s);

  // Větev B — den v týdnu rozpoznán
  if (wd) {
    if (inMonth) {
      let nth: number | null = null;
      for (const [stem, val] of NTH_DEFS) {
        if (B(stem, s)) {
          nth = val;
          break;
        }
      }
      if (nth != null) {
        const label = nth === -1 ? `Poslední ${wd.nom} v měsíci` : `${nth}. ${wd.nom} v měsíci`;
        return {
          rule: { kind: "monthly-nth", nth, weekday: wd.d, label },
          startISO: nthWeekdayISO(nth, wd.d, today) ?? undefined,
          timeMin,
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
      };
    }
    const bi = B("druh[éouýa]\\w*", s) || B("dva", s) || B("dvou", s);
    return {
      rule: { kind: bi ? "biweekly" : "weekly", weekday: wd.d, label: bi ? wd.every2 : wd.every },
      startISO: weekdayDate(wd.d, 0, today),
      timeMin,
    };
  }

  // Větev C — den v měsíci číslem/slovem
  let day = ordinalDay(s);
  if (day == null) {
    const dm = s.match(/(\d{1,2})\.(?!\s*\d)/);
    if (dm) {
      const nn = +dm[1]!;
      if (nn >= 1 && nn <= 31) day = nn;
    }
  }
  if (day != null) {
    return {
      rule: { kind: "monthly-day", day, label: `${day}. v měsíci` },
      startISO: nextMonthDayISO(day, today),
      timeMin,
    };
  }

  // Větev D — obecné jednotky (fallback)
  if (B("den", s) || B("dny", s) || B("denn[íěe]", s)) return { rule: { kind: "daily", label: "Každý den" }, timeMin };
  if (B("t[ýy]den", s) || B("t[ýy]dn[ěeyů]", s)) {
    const bi = B("druh[éouýa]\\w*", s) || B("dva", s) || /\b2\b/.test(s);
    return { rule: { kind: bi ? "biweekly" : "weekly", label: bi ? "Každé 2 týdny" : "Každý týden" }, timeMin };
  }
  if (B("m[ěe]s[íi]c", s) || B("m[ěe]s[íi]ce", s)) return { rule: { kind: "monthly", label: "Každý měsíc" }, timeMin };
  if (B("rok", s) || B("roce", s) || B("roky", s)) return { rule: { kind: "yearly", label: "Každý rok" }, timeMin };

  return null;
}
