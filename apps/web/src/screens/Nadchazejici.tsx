import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo, useState } from "react";
import i18n, { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { TaskItem } from "../components/TaskItem";
import {
  DEFAULT_TOOLBAR,
  TasksToolbar,
  type ToolbarState,
  filterTasks,
  sortTasks,
} from "../components/TasksToolbar";
import { useFlowSteps } from "../lib/flowSteps";
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

/** Hlavička skupiny dle prototypu ř. 409–411: 13px bold ink + mono count (bez uppercase). */
function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center" style={{ gap: 10, margin: "18px 0 2px", padding: "0 4px" }}>
      <span className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
        {label}
      </span>
      <span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
        {count}
      </span>
    </div>
  );
}

/** Nadcházející — úkoly s termínem po dnech (horizont ~16 dní) + projekce výskytů opakování (R4). */
export function Nadchazejici() {
  const { t } = useTranslation();
  const projects = useProjects();
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
  const { data: allTasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE completed_at IS NULL AND due_date IS NOT NULL ORDER BY due_date",
  );
  const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
  const flowSteps = useFlowSteps();
  const tasks = useMemo(
    () => sortTasks(filterTasks(allTasks ?? [], tb), tb),
    [allTasks, tb],
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
      <TasksToolbar state={tb} onChange={setTb} hideDone />
      {empty && (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-3">
          {t("today.empty")}
        </p>
      )}

      {view.overdue.length > 0 && (
        <section>
          <GroupHead label={t("today.overdue")} count={view.overdue.length} />
          <ul>
            {view.overdue.map((tk) => (
              <TaskItem
                key={tk.id}
                task={tk}
                project={tk.project_id ? projMap.get(tk.project_id) : undefined}
                flow={flowSteps.get(tk.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {view.days.map(({ d, list, projs }) => (
        <section key={d}>
          <GroupHead label={view.label(d)} count={list.length + projs.length} />
          <ul>
            {list.map((tk) => (
              <TaskItem
                key={tk.id}
                task={tk}
                project={tk.project_id ? projMap.get(tk.project_id) : undefined}
                flow={flowSteps.get(tk.id)}
              />
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
