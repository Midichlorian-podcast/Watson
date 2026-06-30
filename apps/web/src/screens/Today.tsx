import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon, TaskCard } from "@watson/ui";
import { QuickAdd } from "../components/QuickAdd";
import { useSession } from "../lib/auth-client";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";

type Pri = 1 | 2 | 3 | 4;

const todayISO = () => new Date().toISOString().slice(0, 10);
const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

function dueInfo(due: string | null) {
  if (!due) return null;
  const d = due.slice(0, 10);
  const tdy = todayISO();
  return { day: d, overdue: d < tdy, isToday: d === tdy };
}

/**
 * Dnes (dashboard) dle Claude Design: Watson pruh + quick-add + ODDĚLENÁ sekce
 * „Zpožděné" (MASTER §11, nemíchat s dnešními) + dnešní úkoly + hotovo.
 */
export function Today() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const { open } = useTaskDetail();
  const [openOverdue, setOpenOverdue] = useState(true);
  const [openDone, setOpenDone] = useState(false);

  const projects = useProjects();
  const inboxId = projects[0]?.id;

  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY due_date IS NULL, due_date, created_at DESC",
  );

  const g = useMemo(() => {
    const tdy = todayISO();
    const all = tasks ?? [];
    const open = all.filter((x) => !x.completed_at);
    return {
      overdue: open.filter((x) => {
        const d = dayOf(x);
        return d !== null && d < tdy;
      }),
      today: open.filter((x) => {
        const d = dayOf(x);
        return d === null || d === tdy;
      }),
      done: all.filter((x) => x.completed_at),
    };
  }, [tasks]);

  async function toggle(task: TaskRow) {
    await powerSync.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", [
      task.completed_at ? null : new Date().toISOString(),
      task.id,
    ]);
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 11 ? t("today.morning") : hour < 18 ? t("today.afternoon") : t("today.evening");
  const firstName = session?.user?.name?.split(" ")[0] ?? "";

  const card = (task: TaskRow) => {
    const di = dueInfo(task.due_date);
    const due = di
      ? {
          label: di.overdue
            ? `${t("today.duePast")} · ${di.day}`
            : di.isToday
              ? t("nav.today")
              : di.day,
          overdue: di.overdue,
        }
      : undefined;
    return (
      <li key={task.id}>
        <TaskCard
          name={task.name ?? ""}
          priority={(task.priority ?? 4) as Pri}
          color={task.color ?? undefined}
          due={due}
          done={Boolean(task.completed_at)}
          onToggle={() => toggle(task)}
          onOpen={() => open(task.id)}
        />
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      {/* Watson pruh */}
      <div
        className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3"
        style={{ boxShadow: "var(--w-shadow-sm)" }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ background: "var(--w-brass)", color: "var(--w-navy)" }}
        >
          <Icon name="dnes" size={20} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-navy">
            {greeting}
            {firstName ? `, ${firstName}` : ""}.
          </p>
          <p className="text-xs text-ink-2">
            {t("today.summaryToday", { count: g.today.length })}
            {g.overdue.length > 0
              ? ` · ${t("today.summaryOverdue", { count: g.overdue.length })}`
              : ""}
          </p>
        </div>
      </div>

      {/* Chytré přidání úkolu — parser přirozené češtiny (#7) */}
      <div className="mt-5">
        <QuickAdd
          projects={projects.map((p) => ({ id: p.id, name: p.name ?? "" }))}
          inboxId={inboxId}
        />
      </div>

      {/* Zpožděné — VLASTNÍ oddělená sekce (MASTER §11) */}
      {g.overdue.length > 0 && (
        <section className="mt-7">
          <button
            type="button"
            onClick={() => setOpenOverdue((s) => !s)}
            className="flex w-full items-center gap-2"
          >
            <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-overdue">
              {t("today.overdue")}
            </span>
            <span className="font-mono text-xs text-ink-3">{g.overdue.length}</span>
            <span className="ml-auto text-ink-3">{openOverdue ? "▾" : "▸"}</span>
          </button>
          {openOverdue && <ul className="mt-3 flex flex-col gap-2">{g.overdue.map(card)}</ul>}
        </section>
      )}

      {/* Dnešní úkoly */}
      <section className="mt-7">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-brass-text">
          {t("today.heading")}
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {g.today.map(card)}
          {g.today.length === 0 && (
            <li className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">
              {t("today.empty")}
            </li>
          )}
        </ul>
      </section>

      {/* Hotovo */}
      {g.done.length > 0 && (
        <section className="mt-7">
          <button
            type="button"
            onClick={() => setOpenDone((s) => !s)}
            className="flex w-full items-center gap-2"
          >
            <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-ink-3">
              {t("today.doneSection")}
            </span>
            <span className="font-mono text-xs text-ink-3">{g.done.length}</span>
            <span className="ml-auto text-ink-3">{openDone ? "▾" : "▸"}</span>
          </button>
          {openDone && <ul className="mt-3 flex flex-col gap-2">{g.done.map(card)}</ul>}
        </section>
      )}
    </div>
  );
}
