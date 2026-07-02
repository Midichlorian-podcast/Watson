import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { advanceChainForTask } from "../lib/chainAdvance";
import type { StatusRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";

/**
 * Nástěnka — sloupce dle `statuses` (R9: drop do sloupce s is_done ⇄ completed_at).
 * Sdílená pro Úkoly i Nadcházející (prototyp: board je společný workspace pohled).
 */
export function Board({ tasks }: { tasks: TaskRow[] }) {
  const { t } = useTranslation();
  const { open } = useTaskDetail();
  const projects = useProjects();
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const { data: statuses } = usePsQuery<StatusRow>("SELECT * FROM statuses ORDER BY position");

  const columns = useMemo(() => {
    const cols = (statuses ?? []).filter((s) => s.name);
    if (cols.length === 0) return [];
    const firstCol = cols.find((c) => !c.is_done) ?? cols[0];
    const colOf = (tk: TaskRow): string => {
      if (tk.status_id && cols.some((c) => c.id === tk.status_id)) return tk.status_id;
      if (tk.completed_at) return cols.find((c) => c.is_done)?.id ?? firstCol?.id ?? "";
      return firstCol?.id ?? "";
    };
    return cols.map((c) => ({ st: c, tasks: tasks.filter((tk) => colOf(tk) === c.id) }));
  }, [statuses, tasks]);

  const dropTo = async (statusId: string, isDone: boolean, taskId: string | null) => {
    const id = taskId || dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const tk = tasks.find((x) => x.id === id);
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

  if (columns.length === 0) {
    return (
      <p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
        {t("today.empty")}
      </p>
    );
  }

  return (
    <div className="flex items-start gap-3.5 overflow-x-auto" style={{ paddingBottom: 90 }}>
      {columns.map(({ st, tasks: colTasks }) => (
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
              {colTasks.length}
            </span>
          </div>
          {colTasks.map((tk) => {
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
  );
}
