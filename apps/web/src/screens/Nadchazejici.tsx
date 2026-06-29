import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";
import i18n, { useTranslation } from "@watson/i18n";
import { TaskItem } from "../components/TaskItem";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { dayOf, todayISO } from "../lib/tasks";

const HORIZON_DAYS = 16;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function fmtDate(d: string) {
  const loc = i18n.language?.startsWith("cs") ? "cs-CZ" : "en-US";
  return new Date(`${d}T00:00:00`).toLocaleDateString(loc, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Nadcházející — otevřené úkoly s termínem seskupené po dnech (horizont ~16 dní). */
export function Nadchazejici() {
  const { t } = useTranslation();
  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE completed_at IS NULL AND due_date IS NOT NULL ORDER BY due_date",
  );

  const view = useMemo(() => {
    const tdy = todayISO();
    const tmrw = iso(Date.now() + DAY);
    const horizon = iso(Date.now() + HORIZON_DAYS * DAY);
    const overdue: TaskRow[] = [];
    const byDay = new Map<string, TaskRow[]>();
    for (const tk of tasks ?? []) {
      const d = dayOf(tk);
      if (!d) continue;
      if (d < tdy) overdue.push(tk);
      else if (d <= horizon) {
        const arr = byDay.get(d);
        if (arr) arr.push(tk);
        else byDay.set(d, [tk]);
      }
    }
    const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const label = (d: string) =>
      d === tdy ? t("nav.today") : d === tmrw ? t("today.tomorrow") : fmtDate(d);
    return { overdue, days, label };
  }, [tasks, t]);

  const empty = (tasks ?? []).length === 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      {empty && (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-3">
          {t("today.empty")}
        </p>
      )}

      {view.overdue.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-overdue">
            {t("today.overdue")} <span className="ml-1 font-mono text-ink-3">{view.overdue.length}</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {view.overdue.map((tk) => (
              <TaskItem key={tk.id} task={tk} />
            ))}
          </ul>
        </section>
      )}

      {view.days.map(([d, list]) => (
        <section key={d} className="mb-6">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-brass-text">
            {view.label(d)} <span className="ml-1 font-mono text-ink-3">{list.length}</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {list.map((tk) => (
              <TaskItem key={tk.id} task={tk} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
