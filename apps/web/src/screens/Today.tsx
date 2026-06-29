import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "@watson/i18n";
import { PriorityBadge } from "@watson/ui";
import { API_URL } from "../lib/api";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";

type Project = { id: string; name: string };

export function Today() {
  const { t } = useTranslation();
  const [text, setText] = useState("");

  // Projekty uživatele (kvůli platnému project_id) — ze serveru.
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/projects`, { credentials: "include" });
      if (!res.ok) throw new Error("projects");
      return (await res.json()).projects as Project[];
    },
  });
  const inboxId = projects?.[0]?.id;

  // Úkoly z LOKÁLNÍ PowerSync DB (reaktivní, offline-first).
  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY completed_at IS NOT NULL, created_at DESC",
  );

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !inboxId) return;
    await powerSync.execute(
      "INSERT INTO tasks (id, project_id, name, priority, created_at) VALUES (uuid(), ?, ?, 4, ?)",
      [inboxId, text.trim(), new Date().toISOString()],
    );
    setText("");
  }

  async function toggle(task: TaskRow) {
    await powerSync.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", [
      task.completed_at ? null : new Date().toISOString(),
      task.id,
    ]);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-brass-text">
        {t("nav.today")}
      </p>
      <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-navy">
        {t("today.heading")}
      </h1>

      <form onSubmit={addTask} className="mt-5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Přidat úkol…"
          className="flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!inboxId}
          className="rounded-lg bg-navy px-4 font-display text-sm font-semibold text-white disabled:opacity-50"
        >
          Přidat
        </button>
      </form>

      <ul className="mt-6 flex flex-col gap-2">
        {(tasks ?? []).map((task) => {
          const done = Boolean(task.completed_at);
          return (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3"
              style={{ boxShadow: "var(--w-shadow)" }}
            >
              <button
                type="button"
                onClick={() => toggle(task)}
                aria-label={done ? "Označit jako nehotové" : "Dokončit"}
                className="grid h-5 w-5 place-items-center rounded-full border"
                style={{
                  borderColor: done ? "var(--w-success)" : "var(--w-line)",
                  background: done ? "var(--w-success)" : "transparent",
                  color: "#fff",
                }}
              >
                {done ? "✓" : ""}
              </button>
              <span
                className={`flex-1 text-sm ${done ? "text-ink-3 line-through" : "text-ink"}`}
              >
                {task.name}
              </span>
              <PriorityBadge priority={(task.priority ?? 4) as 1 | 2 | 3 | 4} />
            </li>
          );
        })}
        {tasks && tasks.length === 0 && (
          <li className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">
            {t("today.empty")}
          </li>
        )}
      </ul>
    </div>
  );
}
