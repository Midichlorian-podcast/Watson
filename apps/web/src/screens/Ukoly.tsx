import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "@watson/i18n";
import { TaskItem } from "../components/TaskItem";
import { API_URL } from "../lib/api";
import type { TaskRow } from "../lib/powersync/AppSchema";

type Project = { id: string; name: string };

/** Úkoly — otevřené úkoly seskupené podle projektů (dle designu). */
export function Ukoly() {
  const { t } = useTranslation();
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/projects`, { credentials: "include" });
      if (!r.ok) throw new Error("projects");
      return (await r.json()).projects as Project[];
    },
  });
  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY priority, due_date IS NULL, due_date",
  );

  const groups = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const tk of tasks ?? []) {
      const k = tk.project_id ?? "—";
      const arr = m.get(k);
      if (arr) arr.push(tk);
      else m.set(k, [tk]);
    }
    return [...m.entries()];
  }, [tasks]);

  const projName = (id: string) => projects?.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      {(tasks ?? []).length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-3">
          {t("today.empty")}
        </p>
      )}
      {groups.map(([pid, list]) => (
        <section key={pid} className="mb-6">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-navy">
            {projName(pid)} <span className="ml-1 font-mono text-ink-3">{list.length}</span>
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
