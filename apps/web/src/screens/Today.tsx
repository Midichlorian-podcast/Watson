import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { TaskCard } from "@watson/ui";
import { QuickAdd } from "../components/QuickAdd";
import { useSession } from "../lib/auth-client";
import type { ProjectRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { dueLabel, toggleTask } from "../lib/tasks";
import { useWatson } from "../lib/watson";

type Pri = 1 | 2 | 3 | 4;
const todayISO = () => new Date().toISOString().slice(0, 10);
const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/**
 * Dnes — 1:1 dle Cloud Design: Watson strip (brass-soft) + workspace kontext + skupiny
 * „Zpožděné" (s akcí Přeplánovat) a „{datum} · Dnes · {den}". Karty = sdílený TaskCard řádek.
 */
export function Today() {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const { open } = useTaskDetail();
  const { toggleWatson } = useWatson();
  const [openDone, setOpenDone] = useState(false);

  const projects = useProjects();
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
  const inboxId = projects[0]?.id;

  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date, created_at DESC",
  );

  const g = useMemo(() => {
    const tdy = todayISO();
    const all = tasks ?? [];
    const opn = all.filter((x) => !x.completed_at);
    return {
      overdue: opn.filter((x) => {
        const d = dayOf(x);
        return d !== null && d < tdy;
      }),
      today: opn.filter((x) => {
        const d = dayOf(x);
        return d === null || d === tdy;
      }),
      done: all.filter((x) => x.completed_at),
    };
  }, [tasks]);

  async function toggle(task: TaskRow) {
    await toggleTask(task);
  }

  async function rescheduleOverdue() {
    const now = new Date().toISOString();
    for (const tk of g.overdue) {
      await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [now, tk.id]);
    }
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 11 ? t("today.morning") : hour < 18 ? t("today.afternoon") : t("today.evening");
  const firstName = session?.user?.name?.split(" ")[0] ?? "";
  const greet = `${greeting}${firstName ? `, ${firstName}` : ""}. ${t("today.summaryToday", {
    count: g.today.length,
  })}${g.overdue.length > 0 ? ` · ${t("today.summaryOverdue", { count: g.overdue.length })}` : ""}`;

  const dateLabel = `${new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "long",
  }).format(
    new Date(),
  )} · ${t("nav.today")} · ${new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(new Date())}`;

  const card = (task: TaskRow) => {
    const p = task.project_id ? projMap.get(task.project_id) : undefined;
    return (
      <li key={task.id}>
        <TaskCard
          name={task.name ?? ""}
          priority={(task.priority ?? 4) as Pri}
          projectName={p?.name ?? undefined}
          projectColor={p?.color ?? undefined}
          due={task.due_date ? dueLabel(task.due_date, t) : undefined}
          done={Boolean(task.completed_at)}
          onToggle={() => toggle(task)}
          onOpen={() => open(task.id)}
        />
      </li>
    );
  };

  return (
    <>
      {/* WATSON strip */}
      <div
        className="flex items-center gap-2.5 border-line border-b"
        style={{ padding: "10px 20px", background: "var(--w-brass-soft)" }}
      >
        <span
          className="shrink-0 rounded-full"
          style={{ width: 6, height: 6, background: "var(--w-brass)" }}
        />
        <span
          className="shrink-0 font-display font-bold text-brass-text"
          style={{ fontSize: 11.5, letterSpacing: ".04em" }}
        >
          WATSON
        </span>
        <span className="min-w-0 flex-1 truncate font-body text-ink-2" style={{ fontSize: 13 }}>
          {greet}
        </span>
        {g.overdue.length > 0 && (
          <button
            type="button"
            onClick={() => void rescheduleOverdue()}
            className="shrink-0 font-display font-semibold text-brass-text hover:underline"
            style={{ fontSize: 12 }}
          >
            {t("today.rescheduleOverdue")}
          </button>
        )}
        <button
          type="button"
          onClick={toggleWatson}
          className="shrink-0 font-display font-semibold text-ink-3 hover:text-brass-text"
          style={{ fontSize: 12 }}
        >
          {t("today.watsonMore")}
        </button>
      </div>

      <div className="mx-auto max-w-[1080px]" style={{ padding: "12px 22px 90px" }}>
        {/* Chytré přidání úkolu (parser, #7) */}
        <QuickAdd
          projects={projects.map((p: ProjectRow) => ({ id: p.id, name: p.name ?? "" }))}
          inboxId={inboxId}
        />

        {/* Zpožděné */}
        {g.overdue.length > 0 && (
          <section>
            <SectionHead
              label={t("today.overdue")}
              count={g.overdue.length}
              action={t("today.reschedule")}
              onAction={() => void rescheduleOverdue()}
            />
            <ul>{g.overdue.map(card)}</ul>
          </section>
        )}

        {/* Dnes / datum */}
        <section>
          <SectionHead label={dateLabel} count={g.today.length} />
          {g.today.length === 0 ? (
            <p className="rounded-xl border border-line border-dashed px-4 py-8 text-center text-ink-3 text-sm">
              {t("today.empty")}
            </p>
          ) : (
            <ul>{g.today.map(card)}</ul>
          )}
        </section>

        {/* Hotovo */}
        {g.done.length > 0 && (
          <section className="mt-4">
            <button
              type="button"
              onClick={() => setOpenDone((s) => !s)}
              className="flex w-full items-center gap-2.5"
              style={{ padding: "0 4px" }}
            >
              <span className="font-display font-bold text-ink-3" style={{ fontSize: 13 }}>
                {t("today.doneSection")}
              </span>
              <span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
                {g.done.length}
              </span>
              <span className="ml-auto text-ink-3">{openDone ? "▾" : "▸"}</span>
            </button>
            {openDone && <ul className="mt-1">{g.done.map(card)}</ul>}
          </section>
        )}
      </div>
    </>
  );
}

function SectionHead({
  label,
  count,
  action,
  onAction,
}: {
  label: string;
  count: number;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5" style={{ margin: "18px 0 2px", padding: "0 4px" }}>
      <span className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
        {label}
      </span>
      <span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
        {count}
      </span>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="ml-auto font-display font-semibold text-brass-text hover:underline"
          style={{ fontSize: 12 }}
        >
          {action}
        </button>
      )}
    </div>
  );
}
