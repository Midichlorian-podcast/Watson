import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";
import i18n, { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { TaskItem } from "../components/TaskItem";
import { expandOccurrences, occId, recurrenceKind } from "../lib/occurrences";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { dayOf, todayISO } from "../lib/tasks";

const HORIZON_DAYS = 16;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Occ {
  id: string;
  name: string;
  color: string | null;
}

function fmtDate(d: string) {
  const loc = i18n.language?.startsWith("cs") ? "cs-CZ" : "en-US";
  return new Date(`${d}T00:00:00`).toLocaleDateString(loc, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Nadcházející — úkoly s termínem po dnech (horizont ~16 dní) + projekce výskytů opakování (R4). */
export function Nadchazejici() {
  const { t } = useTranslation();
  const projects = useProjects();
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE completed_at IS NULL AND due_date IS NOT NULL ORDER BY due_date",
  );

  const view = useMemo(() => {
    const tdy = todayISO();
    const tmrw = iso(Date.now() + DAY);
    const horizon = iso(Date.now() + HORIZON_DAYS * DAY);
    const overdue: TaskRow[] = [];
    const byDay = new Map<string, TaskRow[]>();
    const projByDay = new Map<string, Occ[]>();

    for (const tk of tasks ?? []) {
      const d = dayOf(tk);
      if (!d) continue;
      if (d < tdy) overdue.push(tk);
      else if (d <= horizon) {
        const arr = byDay.get(d);
        if (arr) arr.push(tk);
        else byDay.set(d, [tk]);
      }
      // Projekce výskytů opakování do horizontu (kromě base dne = reálný úkol).
      const kind = recurrenceKind(tk.recurrence_rule);
      if (kind) {
        for (const od of expandOccurrences({
          baseISO: d,
          kind,
          fromISO: tdy,
          toISO: horizon,
          cap: 40,
        })) {
          if (od === d) continue;
          const arr = projByDay.get(od) ?? [];
          arr.push({
            id: occId(tk.id, od),
            name: tk.name ?? "",
            color: (tk.project_id && projMap.get(tk.project_id)?.color) || null,
          });
          projByDay.set(od, arr);
        }
      }
    }

    const allDays = new Set<string>([...byDay.keys(), ...projByDay.keys()]);
    const days = [...allDays]
      .sort((a, b) => (a < b ? -1 : 1))
      .map((d) => ({ d, list: byDay.get(d) ?? [], projs: projByDay.get(d) ?? [] }))
      .filter((g) => g.list.length > 0 || g.projs.length > 0);
    const label = (d: string) =>
      d === tdy ? t("nav.today") : d === tmrw ? t("today.tomorrow") : fmtDate(d);
    return { overdue, days, label };
  }, [tasks, projMap, t]);

  const empty = view.days.length === 0 && view.overdue.length === 0;

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
            {t("today.overdue")}{" "}
            <span className="ml-1 font-mono text-ink-3">{view.overdue.length}</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {view.overdue.map((tk) => (
              <TaskItem key={tk.id} task={tk} />
            ))}
          </ul>
        </section>
      )}

      {view.days.map(({ d, list, projs }) => (
        <section key={d} className="mb-6">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-brass-text">
            {view.label(d)}{" "}
            <span className="ml-1 font-mono text-ink-3">{list.length + projs.length}</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {list.map((tk) => (
              <TaskItem key={tk.id} task={tk} />
            ))}
            {projs.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2.5 rounded-xl border border-dashed border-line px-3 py-2"
                style={{ opacity: 0.75 }}
                title={t("cheat.calendar")}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 8, height: 8, background: o.color ?? "var(--w-line)" }}
                />
                <span className="flex items-center text-brass-text">
                  <Icon name="opakovani" size={13} />
                </span>
                <span className="flex-1 truncate font-body text-ink-2" style={{ fontSize: 13.5 }}>
                  {o.name}
                </span>
                <span className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
                  ↻
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
