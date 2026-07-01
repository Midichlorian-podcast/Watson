/**
 * Cíle — výpočet progresu (VERBATIM logika z prototypu `goalProgress`/`goalStatus`, ř. 2362–2368).
 * Metriky: completion (% dokončených), ontime (% včas), count (počet hotových), project (% projektu).
 * Progres se počítá klientsky z reálných úkolů.
 */

export interface GoalTaskLite {
  completed_at: string | null;
  due_date: string | null;
}

export interface GoalProgress {
  /** % naplnění cíle (real vs target), 0–100. */
  pct: number;
  real: number;
  target: number;
  met: boolean;
  /** Hodnotový popisek karty (např. „3 / 10 hotových"). */
  label: string;
  /** Vedlejší popisek (např. „12 úkolů v hledáčku"). */
  sub: string;
  matchCount: number;
}

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** Úkol dokončen včas: hotový a (bez termínu nebo dokončen ≤ den termínu). */
export function taskOnTime(t: GoalTaskLite): boolean {
  if (!t.completed_at) return false;
  const due = dayOf(t.due_date);
  if (!due) return true;
  return (dayOf(t.completed_at) ?? "") <= due;
}

export function goalProgress(
  metric: string,
  tasks: GoalTaskLite[],
  target: number,
  /** Jen pro metric=project: průměrné % dokončení propojených projektů (vážené počtem úkolů). */
  projectPct?: { pct: number; count: number },
): GoalProgress {
  const total = tasks.length;
  const done = tasks.filter((t) => t.completed_at).length;

  if (metric === "project") {
    const real = projectPct?.pct ?? 0;
    const tgt = target || 100;
    return {
      pct: Math.min(100, Math.round((real / (tgt || 100)) * 100)),
      real,
      target: tgt,
      met: real >= tgt,
      label: `${real} % projektu`,
      sub: `cíl ${tgt} %`,
      matchCount: projectPct?.count ?? 0,
    };
  }
  if (metric === "count") {
    const tgt = target || 1;
    return {
      pct: Math.min(100, Math.round((done / tgt) * 100)),
      real: done,
      target: tgt,
      met: done >= tgt,
      label: `${done} / ${tgt} hotových`,
      sub: `${total} úkolů v hledáčku`,
      matchCount: total,
    };
  }
  if (metric === "ontime") {
    const onT = tasks.filter(taskOnTime).length;
    const real = done ? Math.round((onT / done) * 100) : 0;
    const tgt = target || 90;
    return {
      pct: Math.min(100, Math.round((real / (tgt || 90)) * 100)),
      real,
      target: tgt,
      met: done > 0 && real >= tgt,
      label: `${real} % včas`,
      sub: `${onT} z ${done} úkolů včas`,
      matchCount: total,
    };
  }
  // completion (default)
  const real = total ? Math.round((done / total) * 100) : 0;
  const tgt = target || 100;
  return {
    pct: Math.min(100, Math.round((real / (tgt || 100)) * 100)),
    real,
    target: tgt,
    met: total > 0 && real >= tgt,
    label: `${done} / ${total} hotovo`,
    sub: `${real} % dokončeno`,
    matchCount: total,
  };
}

export type GoalStatusKind = "done" | "track" | "risk" | "over";

/** Stav cíle: splněno / na cestě / ohrožený (pct < elapsed−12) / po termínu. VERBATIM. */
export function goalStatus(
  pct: number,
  elapsed: number,
  overdue: boolean,
  done: boolean,
): GoalStatusKind {
  if (pct >= 100 || done) return "done";
  if (overdue) return "over";
  if (pct < elapsed - 12) return "risk";
  return "track";
}

/** % uplynulého času řady created→due (0 když bez termínu; 100+ po termínu → clamp 100). */
export function goalElapsed(createdISO: string | null, dueISO: string | null, todayISO: string): number {
  const c = dayOf(createdISO);
  const d = dayOf(dueISO);
  if (!c || !d || d <= c) return 0;
  const ms = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
  const span = ms(d) - ms(c);
  const gone = ms(todayISO) - ms(c);
  return Math.max(0, Math.min(100, Math.round((gone / span) * 100)));
}

/** Barvy/labely stavů (GSTAT z prototypu): [label, softBg, textColor, barColor]. */
export const GSTAT: Record<GoalStatusKind, [string, string, string, string]> = {
  done: ["Splněno", "var(--w-success-soft)", "var(--w-success-ink)", "#2e9c6e"],
  track: ["Na cestě", "rgba(42,111,219,.13)", "#2a6fdb", "#2a6fdb"],
  risk: ["Ohrožený", "rgba(198,138,62,.16)", "var(--w-brass-text)", "var(--w-brass)"],
  over: ["Po termínu", "rgba(194,71,60,.13)", "var(--w-overdue)", "var(--w-overdue)"],
};
