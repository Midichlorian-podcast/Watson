import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";
import { useTranslation } from "@watson/i18n";
import { TaskItem } from "../components/TaskItem";
import { useSession } from "../lib/auth-client";
import { useFlowSteps } from "../lib/flowSteps";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";

/**
 * Oblíbené — rychlé filtry ze sidebaru: Priorita 1 / Přiřazeno mně
 * (mně = přiřazené přes assignments ∪ mnou vytvořené — stejná logika jako sidebar badge).
 */
export function Oblibene({ mode }: { mode: "p1" | "me" }) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const meId = session?.user?.id;
  const projects = useProjects();
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const flowSteps = useFlowSteps();

  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY priority, due_date IS NULL, due_date",
  );
  const { data: assignments } = usePsQuery<{ task_id: string | null; user_id: string | null }>(
    "SELECT task_id, user_id FROM assignments",
  );
  const mineSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of assignments ?? []) if (a.user_id === meId && a.task_id) s.add(a.task_id);
    return s;
  }, [assignments, meId]);

  const shown = useMemo(
    () =>
      (tasks ?? []).filter((tk) =>
        mode === "p1" ? tk.priority === 1 : mineSet.has(tk.id) || tk.created_by === meId,
      ),
    [tasks, mode, mineSet, meId],
  );

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="mb-4 flex items-center gap-2.5">
        <span
          className="shrink-0"
          style={{
            width: 9,
            height: 9,
            borderRadius: mode === "p1" ? 2 : "50%",
            background: mode === "p1" ? "var(--w-brass)" : "#2a6fdb",
          }}
        />
        <h1 className="font-display font-extrabold text-ink" style={{ fontSize: 17 }}>
          {mode === "p1" ? t("nav.priority1") : t("nav.assignedToMe")}
        </h1>
        <span className="font-mono text-ink-3" style={{ fontSize: 12 }}>
          {shown.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
          {t("today.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-0">
          {shown.map((tk) => (
            <TaskItem
              key={tk.id}
              task={tk}
              project={projMap.get(tk.project_id ?? "")}
              flow={flowSteps.get(tk.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
