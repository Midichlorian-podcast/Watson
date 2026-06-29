/**
 * §1 — parseQuick: hlavní orchestrátor. Pořadí pravidel je ZÁVAZNÉ (každé vyřízne svůj
 * match z `work`, další ho už nevidí). Produkční úpravy vs prototyp: reálný `today`,
 * validace délky měsíce, vyříznutí jen u validního data/deadline (viz §2/§7 Implementace).
 */
import { addDays, weekdayDate } from "./dates";
import { computeHighlights } from "./highlight";
import { czNum } from "./lexicon/czNum";
import { recVocab } from "./lexicon/recVocab";
import { WD_BARE } from "./lexicon/weekdays";
import { parseRecurrence } from "./recurrence";
import type { ParseCtx, ParsedDraft, Priority } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, mo: number, da: number): boolean {
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
  return da <= new Date(y, mo, 0).getDate();
}

export function parseQuick(text: string, ctx: ParseCtx): ParsedDraft {
  const raw = text || "";
  const today = ctx.today;
  const year = +today.slice(0, 4);
  let work = ` ${raw} `;
  const hits: { t: string; kind: string }[] = [];
  const cut = (s: string, kind = "date") => {
    const t = s.trim();
    if (t) hits.push({ t, kind });
    work = work.replace(s, " ");
  };

  const draft: Partial<ParsedDraft> = {};
  let m: RegExpMatchArray | null;

  // 1) Deadline !d. m. [rrrr]
  const dl = work.match(/!\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/);
  if (dl) {
    const da = +dl[1]!;
    const mo = +dl[2]!;
    const y = dl[3] ? +dl[3] : year;
    if (validDate(y, mo, da)) {
      draft.deadline = `${y}-${pad(mo)}-${pad(da)}`;
      cut(dl[0], "deadline");
    }
  }

  // 2) Priorita p1-p4
  const pr = work.match(/\bp([1-4])\b/i);
  if (pr) {
    draft.priority = +pr[1]! as Priority;
    cut(pr[0], "priority");
  }

  // 3) Čas (4 varianty, else-if řetěz)
  let tH: number | null = null;
  let tM = 0;
  if ((m = work.match(/\b(?:v|ve|od)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i))) {
    tH = +m[1]!;
    tM = +m[2]!;
    cut(m[0], "time");
  } else if ((m = work.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    tH = +m[1]!;
    tM = +m[2]!;
    cut(m[0], "time");
  } else if ((m = work.match(/\b(?:v|ve|od)\s+(\d{1,2})\s*hodin\p{L}*/iu))) {
    if (+m[1]! <= 23) {
      tH = +m[1]!;
      tM = 0;
      cut(m[0], "time");
    }
  } else if ((m = work.match(/\b(?:v|ve|od)\s+(\p{L}+(?:\s+\p{L}+)?)\s+hodin\p{L}*/iu))) {
    const v = czNum(m[1]!);
    if (v != null && v <= 23) {
      tH = v;
      tM = 0;
      cut(m[0], "time");
    }
  }
  if (tH != null) draft.startMin = tH * 60 + tM;

  // 4) Trvání (6 variant, else-if řetěz)
  let dur: number | null = null;
  if ((m = work.match(/(?:po dobu\s+)?(\d+)\s*min\p{L}*/iu))) {
    dur = +m[1]!;
    cut(m[0], "duration");
  } else if ((m = work.match(/po dobu\s+(\p{L}+(?:\s+\p{L}+)?)\s*minut\p{L}*/iu))) {
    const v = czNum(m[1]!);
    if (v != null) {
      dur = v;
      cut(m[0], "duration");
    }
  } else if ((m = work.match(/(?<![\p{L}])(\p{L}+(?:\s+\p{L}+)?)\s+minut\p{L}*/iu))) {
    const v = czNum(m[1]!);
    if (v != null) {
      dur = v;
      cut(m[0], "duration");
    }
  } else if ((m = work.match(/(?:po dobu\s+)?p[ůu]l\s+hodin\p{L}*/iu))) {
    dur = 30;
    cut(m[0], "duration");
  } else if ((m = work.match(/(?:po dobu\s+)?(\d+(?:[.,]\d+)?)\s*(?:hodin\p{L}*|hod\p{L}*|h)(?![\p{L}])/iu))) {
    dur = Math.round(Number.parseFloat(m[1]!.replace(",", ".")) * 60);
    cut(m[0], "duration");
  } else if ((m = work.match(/po dobu\s+(\p{L}+)\s+hodin\p{L}*/iu))) {
    const v = czNum(m[1]!);
    if (v != null) {
      dur = v * 60;
      cut(m[0], "duration");
    }
  }
  if (dur != null) draft.durationMin = dur;

  // 5) Vícedenní N dn[íiy]
  const dd = work.match(/(\d+)\s*dn[íiy](?![\p{L}])/iu);
  if (dd) {
    draft.days = Math.max(1, Math.min(60, Number.parseInt(dd[1]!, 10)));
    cut(dd[0]);
  }

  // 6) Datum (explicit → pozítří → zítra → dnes)
  let dateKind: "custom" | "zitra" | "dnes" | undefined;
  let customDate: string | undefined;
  if ((m = work.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/))) {
    const da = +m[1]!;
    const mo = +m[2]!;
    const y = m[3] ? +m[3] : year;
    if (validDate(y, mo, da)) {
      dateKind = "custom";
      customDate = `${y}-${pad(mo)}-${pad(da)}`;
      cut(m[0]);
    }
  } else if ((m = work.match(/poz[íi]t[řr][íi]|po\s+z[íi]t[řr][íi]/i))) {
    dateKind = "custom";
    customDate = addDays(today, 2);
    cut(m[0]);
  } else if ((m = work.match(/z[íi]tra/i))) {
    dateKind = "zitra";
    cut(m[0]);
  } else if ((m = work.match(/\bdnes\b/i))) {
    dateKind = "dnes";
    cut(m[0]);
  }

  // 7) Opakování (na work po vyříznutí výše)
  const rec = parseRecurrence(work, today);
  if (rec) {
    draft.recurrence = rec.rule;
    if (rec.startISO && dateKind === undefined) {
      dateKind = "custom";
      customDate = rec.startISO;
    }
    if (rec.timeMin != null && draft.startMin == null) draft.startMin = rec.timeMin;
  }

  // 8) Holý den v týdnu (jen když nebylo opakování ani datum)
  let bareWd = false;
  if (!rec && dateKind === undefined) {
    for (const w of WD_BARE) {
      if (new RegExp(`(?:^|\\s)(?:${w.st})[\\p{L}]*(?=\\s|$)`, "iu").test(work)) {
        const ahead = /p[řr][íi]št/i.test(work) ? 1 : 0;
        dateKind = "custom";
        customDate = weekdayDate(w.d, ahead, today);
        bareWd = true;
        break;
      }
    }
  }

  // 9) Projekt #X (jen přesná shoda názvu)
  const hash = work.match(/#(\p{L}+)/u);
  if (hash) {
    const q = hash[1]!;
    const exact = ctx.projects.find((p) => p.name.toLowerCase() === q.toLowerCase());
    if (exact) draft.projectId = exact.id;
    cut(hash[0], "proj");
  }

  // 10) Sestavení názvu (§12)
  let base = work.replace(/\b(?:ve?)\s+m[ěe]s[íi]ci\b/giu, (mm) => {
    const t = mm.trim();
    if (t) hits.push({ t, kind: "repeat" });
    return " ";
  });
  if (rec || bareWd) {
    const re = recVocab();
    let rm: RegExpExecArray | null;
    while ((rm = re.exec(base))) {
      const t = rm[0].trim();
      if (t) hits.push({ t, kind: "repeat" });
    }
    base = base.replace(recVocab(), " ");
  }
  const personQueries: string[] = [];
  const are = /[@+](\p{L}+)/gu;
  let am: RegExpExecArray | null;
  while ((am = are.exec(work))) {
    const t = am[0].trim();
    if (t) hits.push({ t, kind: "person" });
    personQueries.push(am[1]!);
  }
  base = base.replace(/\s{2,}/g, " ").trim();
  const cleanName = base.replace(/[@+]\p{L}+/gu, " ").replace(/\s{2,}/g, " ").trim();

  // Termín (due) z dateKind/customDate
  let due: string | undefined;
  if (dateKind === "custom") due = customDate;
  else if (dateKind === "zitra") due = addDays(today, 1);
  else if (dateKind === "dnes") due = today;

  const result: ParsedDraft = {
    name: cleanName,
    rawName: raw,
    highlights: computeHighlights(raw, hits),
  };
  if (draft.priority != null) result.priority = draft.priority;
  if (due != null) result.due = due;
  if (draft.deadline != null) result.deadline = draft.deadline;
  if (draft.startMin != null) result.startMin = draft.startMin;
  if (draft.durationMin != null) result.durationMin = draft.durationMin;
  if (draft.days != null) result.days = draft.days;
  if (draft.recurrence != null) result.recurrence = draft.recurrence;
  if (draft.projectId != null) result.projectId = draft.projectId;
  if (personQueries.length) result.personQueries = personQueries;
  return result;
}
