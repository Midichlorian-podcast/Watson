import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Board } from "../components/Board";
import { Calendar } from "../components/Calendar";
import { TaskItem } from "../components/TaskItem";
import {
  DEFAULT_TOOLBAR,
  TasksToolbar,
  type ToolbarState,
  filterTasks,
  sortTasks,
} from "../components/TasksToolbar";
import { useFlowSteps } from "../lib/flowSteps";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";
import { deleteTaskWithUndo, pushColumnUndo } from "../lib/undo";
import { useViewMode } from "../lib/viewMode";

/**
 * Úkoly — view modes Seznam | Nástěnka | Kalendář (per-user výchozí v localStorage) +
 * toolbar (Filtr/Řazení/směr/Dokončené) + seznamová klávesová navigace (j/k/Enter/Space/1–4).
 * Nástěnka = sloupce dle `statuses` (R9: drop do sloupce s is_done ⇄ completed_at).
 */
export function Ukoly() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { projekt?: string };
  const projektId = search.projekt;
  const projects = useProjects();
  const { open, openId } = useTaskDetail();
  const { view } = useViewMode();
  const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
  const flowSteps = useFlowSteps();
  const [kbSel, setKbSel] = useState<string | null>(null);

  const { data: allTasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date",
  );

  const scoped = useMemo(
    () =>
      projektId ? (allTasks ?? []).filter((x) => x.project_id === projektId) : (allTasks ?? []),
    [allTasks, projektId],
  );
  const shown = useMemo(() => sortTasks(filterTasks(scoped, tb), tb), [scoped, tb]);

  const groups = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const tk of shown) {
      const k = tk.project_id ?? "—";
      const arr = m.get(k);
      if (arr) arr.push(tk);
      else m.set(k, [tk]);
    }
    return [...m.entries()];
  }, [shown]);

  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const projName = (id: string) => projMap.get(id)?.name ?? "—";
  const activeProject = projektId ? projMap.get(projektId) : undefined;

  // ── Seznamová klávesová navigace (kbSel — port ř. 2263-2276) ────────────────
  const navIds = useMemo(() => shown.map((tk) => tk.id), [shown]);
  const { setNavIds } = useTaskDetail();
  useEffect(() => {
    setNavIds(navIds);
  }, [navIds, setNavIds]);
  const navRef = useRef({ navIds, kbSel, shown });
  navRef.current = { navIds, kbSel, shown };
  useEffect(() => {
    if (view !== "list") return;
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey || openId) return;
      const { navIds: ids, kbSel: cur, shown: list } = navRef.current;
      if (!ids.length) return;
      let i = cur ? ids.indexOf(cur) : -1;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        i = i < 0 ? 0 : Math.min(ids.length - 1, i + 1);
        setKbSel(ids[i] ?? null);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        i = i < 0 ? 0 : Math.max(0, i - 1);
        setKbSel(ids[i] ?? null);
        return;
      }
      if (i < 0 || !cur) return;
      if (e.key === "Enter") {
        e.preventDefault();
        open(cur);
        return;
      }
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        const tk = list.find((x) => x.id === cur);
        if (tk) void toggleTask(tk);
        return;
      }
      if (["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const prev = list.find((x) => x.id === cur)?.priority ?? 4;
        pushColumnUndo("tasks", cur, "priority", prev, +e.key);
        void powerSync.execute("UPDATE tasks SET priority = ? WHERE id = ?", [+e.key, cur]);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        const ni = ids[i + 1] ?? ids[i - 1] ?? null;
        void deleteTaskWithUndo(cur); // ⌫ smaže s undo (tahák ř. 1654)
        setKbSel(ni);
        return;
      }
      if (e.key === "Escape") setKbSel(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [view, openId, open]);

  return (
    <div
      className={`mx-auto px-5 py-7 ${view === "list" ? "max-w-3xl" : "max-w-[1080px]"}`}
    >
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
          <Link to="/ukoly" search={{}} className="ml-auto text-ink-3 text-sm hover:text-brass-text">
            {t("projects.allTasks")}
          </Link>
        </div>
      )}

      {view !== "calendar" && <TasksToolbar state={tb} onChange={setTb} />}

      {view === "calendar" ? (
        <Calendar tasks={scoped} />
      ) : view === "board" ? (
        <Board tasks={shown} />
      ) : (
        <>
          {shown.length === 0 && (
            <p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
              {t("today.empty")}
            </p>
          )}
          {projektId ? (
            <ul className="flex flex-col gap-2">
              {shown.map((tk) => (
                <KbRow key={tk.id} selected={kbSel === tk.id}>
                  <TaskItem task={tk} project={projMap.get(tk.project_id ?? "")} flow={flowSteps.get(tk.id)} />
                </KbRow>
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
                    <KbRow key={tk.id} selected={kbSel === tk.id}>
                      <TaskItem task={tk} project={projMap.get(tk.project_id ?? "")} flow={flowSteps.get(tk.id)} />
                    </KbRow>
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

/** Obal řádku se zvýrazněním klávesového výběru (kbSel ring). */
function KbRow({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <div
      data-kbsel={selected || undefined}
      className="rounded-xl"
      style={selected ? { outline: "2px solid var(--w-brass)", outlineOffset: -1 } : undefined}
    >
      {children}
    </div>
  );
}

