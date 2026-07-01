import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Calendar } from "../components/Calendar";
import { TaskItem } from "../components/TaskItem";
import {
  DEFAULT_TOOLBAR,
  TasksToolbar,
  type ToolbarState,
  filterTasks,
  sortTasks,
} from "../components/TasksToolbar";
import { advanceChainForTask } from "../lib/chainAdvance";
import type { StatusRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";

type View = "list" | "board" | "calendar";
const VIEW_LS = "watson.viewMode";

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
  const [view, setViewState] = useState<View>(() => {
    const v = localStorage.getItem(VIEW_LS);
    return v === "board" || v === "calendar" ? v : "list";
  });
  const setView = (v: View) => {
    setViewState(v);
    localStorage.setItem(VIEW_LS, v);
  };
  const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
  const [kbSel, setKbSel] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const { data: allTasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date",
  );
  const { data: statuses } = usePsQuery<StatusRow>(
    "SELECT * FROM statuses ORDER BY position",
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
        void powerSync.execute("UPDATE tasks SET priority = ? WHERE id = ?", [+e.key, cur]);
        return;
      }
      if (e.key === "Escape") setKbSel(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [view, openId, open]);

  // ── Nástěnka (R9) ────────────────────────────────────────────────────────────
  const columns = useMemo(() => {
    const cols = (statuses ?? []).filter((s) => s.name);
    if (cols.length === 0) return [];
    const firstCol = cols.find((c) => !c.is_done) ?? cols[0];
    const colOf = (tk: TaskRow): string => {
      if (tk.status_id && cols.some((c) => c.id === tk.status_id)) return tk.status_id;
      if (tk.completed_at) return cols.find((c) => c.is_done)?.id ?? firstCol?.id ?? "";
      return firstCol?.id ?? "";
    };
    return cols.map((c) => ({
      st: c,
      tasks: shown.filter((tk) => colOf(tk) === c.id),
    }));
  }, [statuses, shown]);

  const dropTo = async (statusId: string, isDone: boolean, taskId: string | null) => {
    const id = taskId || dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const tk = scoped.find((x) => x.id === id);
    if (!tk) return;
    const wasDone = !!tk.completed_at;
    // R9: is_done sloupec ⇄ completed_at (provázané se zaškrtnutím)
    await powerSync.execute("UPDATE tasks SET status_id = ?, completed_at = ? WHERE id = ?", [
      statusId,
      isDone ? (tk.completed_at ?? new Date().toISOString()) : null,
      tk.id,
    ]);
    if (isDone !== wasDone) await advanceChainForTask(tk.id, isDone);
  };

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

      {/* přepínač zobrazení */}
      <div className="mb-4 flex items-center gap-1">
        <ViewTab active={view === "list"} onClick={() => setView("list")}>
          {t("calendar.viewList")}
        </ViewTab>
        <ViewTab active={view === "board"} onClick={() => setView("board")}>
          {t("toolbar.board")}
        </ViewTab>
        <ViewTab active={view === "calendar"} onClick={() => setView("calendar")}>
          {t("calendar.viewCalendar")}
        </ViewTab>
      </div>

      {view !== "calendar" && <TasksToolbar state={tb} onChange={setTb} />}

      {view === "calendar" ? (
        <Calendar tasks={scoped} />
      ) : view === "board" ? (
        columns.length === 0 ? (
          <p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
            {t("today.empty")}
          </p>
        ) : (
          <div className="flex items-start gap-3.5 overflow-x-auto" style={{ paddingBottom: 90 }}>
            {columns.map(({ st, tasks }) => (
              <div
                key={st.id}
                data-col={st.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(st.id);
                }}
                onDragLeave={() => setOverCol((c) => (c === st.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  void dropTo(st.id, !!st.is_done, e.dataTransfer.getData("text/plain") || null);
                }}
                className="flex flex-col gap-2 rounded-[14px] border bg-panel-2"
                style={{
                  width: 280,
                  flex: "none",
                  padding: 12,
                  borderColor: overCol === st.id ? "var(--w-brass)" : "var(--w-line)",
                }}
              >
                <div className="flex items-center gap-2" style={{ padding: "2px 4px" }}>
                  <span className="font-display font-bold text-ink" style={{ fontSize: 12.5 }}>
                    {st.name}
                  </span>
                  <span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
                    {tasks.length}
                  </span>
                </div>
                {tasks.map((tk) => {
                  const p = tk.project_id ? projMap.get(tk.project_id) : undefined;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: drag karta, klik = detail; klávesnice řeší list view
                    <div
                      key={tk.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", tk.id);
                        setDragId(tk.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      onClick={() => open(tk.id)}
                      className="cursor-grab rounded-[11px] border border-line bg-card transition-shadow hover:shadow-md"
                      style={{
                        padding: "11px 12px",
                        boxShadow: "var(--w-shadow-sm)",
                        opacity: dragId === tk.id ? 0.5 : 1,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="shrink-0 rounded-full"
                          style={{ width: 8, height: 8, background: p?.color ?? "var(--w-line)" }}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate font-display font-semibold ${tk.completed_at ? "text-ink-3 line-through" : "text-ink"}`}
                          style={{ fontSize: 13 }}
                        >
                          {tk.name}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <span
                          className="rounded-full bg-card font-display font-semibold"
                          style={{
                            fontSize: 10.5,
                            padding: "2px 7px",
                            color: `var(--w-p${tk.priority ?? 4})`,
                            border: "1px solid var(--w-line)",
                          }}
                        >
                          P{tk.priority ?? 4}
                        </span>
                        {tk.due_date && (
                          <span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
                            {tk.due_date.slice(8, 10)}. {String(+tk.due_date.slice(5, 7))}.
                          </span>
                        )}
                        {tk.recurrence && (
                          <span className="font-mono text-brass-text" style={{ fontSize: 11 }}>
                            ↻
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )
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
                  <TaskItem task={tk} project={projMap.get(tk.project_id ?? "")} />
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
                      <TaskItem task={tk} project={projMap.get(tk.project_id ?? "")} />
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
