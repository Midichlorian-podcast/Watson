import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useSearch } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { CalendarMonth } from "../components/CalendarMonth";
import { TaskItem } from "../components/TaskItem";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";

type View = "list" | "calendar";

/**
 * Úkoly — view mode Seznam | Kalendář (Nástěnka/Board = follow-up #17).
 * Bez filtru: seznam seskupený dle projektů. S `?projekt=$id`: plochá skupina + banner.
 * Kalendář = měsíční mřížka týchž (project-scoped) úkolů dle termínu.
 */
export function Ukoly() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { projekt?: string };
  const projektId = search.projekt;
  const projects = useProjects();
  const [view, setView] = useState<View>("list");

  const { data: allTasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date",
  );

  const scoped = useMemo(
    () =>
      projektId ? (allTasks ?? []).filter((x) => x.project_id === projektId) : (allTasks ?? []),
    [allTasks, projektId],
  );
  const openTasks = useMemo(() => scoped.filter((x) => !x.completed_at), [scoped]);

  const groups = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const tk of openTasks) {
      const k = tk.project_id ?? "—";
      const arr = m.get(k);
      if (arr) arr.push(tk);
      else m.set(k, [tk]);
    }
    return [...m.entries()];
  }, [openTasks]);

  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const projName = (id: string) => projMap.get(id)?.name ?? "—";
  const activeProject = projektId ? projMap.get(projektId) : undefined;

  return (
    <div className={`mx-auto px-5 py-7 ${view === "calendar" ? "max-w-5xl" : "max-w-3xl"}`}>
      {/* banner filtrovaného projektu */}
      {activeProject && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-3">
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

      {/* přepínač zobrazení */}
      <div className="mb-5 flex items-center gap-1">
        <ViewTab active={view === "list"} onClick={() => setView("list")}>
          {t("calendar.viewList")}
        </ViewTab>
        <ViewTab active={view === "calendar"} onClick={() => setView("calendar")}>
          {t("calendar.viewCalendar")}
        </ViewTab>
      </div>

      {view === "calendar" ? (
        <CalendarMonth tasks={scoped} />
      ) : (
        <>
          {openTasks.length === 0 && (
            <p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
              {t("today.empty")}
            </p>
          )}
          {projektId ? (
            <ul className="flex flex-col gap-2">
              {openTasks.map((tk) => (
                <TaskItem key={tk.id} task={tk} project={projMap.get(tk.project_id ?? "")} />
              ))}
            </ul>
          ) : (
            groups.map(([pid, list]) => (
              <section key={pid}>
                <div
                  className="flex items-center gap-2.5"
                  style={{ margin: "18px 0 2px", padding: "0 4px" }}
                >
                  <span className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
                    {projName(pid)}
                  </span>
                  <span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
                    {list.length}
                  </span>
                </div>
                <ul>
                  {list.map((tk) => (
                    <TaskItem key={tk.id} task={tk} project={projMap.get(tk.project_id ?? "")} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-3 py-1.5 font-display font-semibold text-xs transition"
      style={{
        borderColor: active ? "var(--w-brass)" : "var(--w-line)",
        background: active ? "var(--w-brass-soft)" : "transparent",
        color: active ? "var(--w-brass-text)" : "var(--w-ink-3)",
      }}
    >
      {children}
    </button>
  );
}
