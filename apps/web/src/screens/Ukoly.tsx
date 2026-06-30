import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "@watson/i18n";
import { TaskItem } from "../components/TaskItem";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";

/**
 * Úkoly — otevřené úkoly. Bez filtru: seskupené podle projektů. S `?projekt=$id`
 * (vstup z detailu projektu): jedna plochá skupina + banner (← Všechny úkoly).
 * Sekce v prototypu nejsou — projekt = jedna skupina (design handoff).
 */
export function Ukoly() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { projekt?: string };
  const projektId = search.projekt;
  const projects = useProjects();

  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY priority, due_date IS NULL, due_date",
  );

  const filtered = useMemo(
    () => (projektId ? (tasks ?? []).filter((x) => x.project_id === projektId) : (tasks ?? [])),
    [tasks, projektId],
  );

  const groups = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const tk of filtered) {
      const k = tk.project_id ?? "—";
      const arr = m.get(k);
      if (arr) arr.push(tk);
      else m.set(k, [tk]);
    }
    return [...m.entries()];
  }, [filtered]);

  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";
  const activeProject = projektId ? projects.find((p) => p.id === projektId) : undefined;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      {/* banner filtrovaného projektu */}
      {activeProject && (
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-3">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: activeProject.color ?? "var(--w-ink-3)" }}
          />
          <span className="font-display font-extrabold text-lg text-navy">
            {activeProject.name}
          </span>
          <Link
            to="/ukoly"
            search={{}}
            className="ml-auto text-ink-3 text-sm hover:text-brass-text"
          >
            {t("projects.allTasks")}
          </Link>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
          {t("today.empty")}
        </p>
      )}

      {projektId ? (
        <ul className="flex flex-col gap-2">
          {filtered.map((tk) => (
            <TaskItem key={tk.id} task={tk} />
          ))}
        </ul>
      ) : (
        groups.map(([pid, list]) => (
          <section key={pid} className="mb-6">
            <h2 className="font-display font-bold text-navy text-xs uppercase tracking-[0.18em]">
              {projName(pid)} <span className="ml-1 font-mono text-ink-3">{list.length}</span>
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {list.map((tk) => (
                <TaskItem key={tk.id} task={tk} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
