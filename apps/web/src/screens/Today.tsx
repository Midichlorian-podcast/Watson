import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { QuickAdd } from "../components/QuickAdd";
import { TaskItem } from "../components/TaskItem";
import { WorkspaceChips } from "../components/WorkspaceChips";
import {
  DEFAULT_TOOLBAR,
  TasksToolbar,
  type ToolbarState,
  filterTasks,
  sortTasks,
} from "../components/TasksToolbar";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useFlowSteps } from "../lib/flowSteps";
import { filterByQuery, useListSearch } from "../lib/listSearch";
import type { ProjectRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { useWatson } from "../lib/watson";
import { useWorkspace } from "../lib/workspace";

type Member = { id: string; name: string };

const todayISO = () => new Date().toISOString().slice(0, 10);
const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/**
 * Dnes — 1:1 dle Cloud Design: Watson strip (brass-soft) + workspace kontext + skupiny
 * „Zpožděné" (s akcí Přeplánovat) a „{datum} · Dnes · {den}". Karty = sdílený TaskCard řádek.
 */
export function Today() {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const { toggleWatson } = useWatson();
  const [openDone, setOpenDone] = useState(false);

  const projects = useProjects();
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
  const inboxId = projects[0]?.id;

  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date, created_at DESC",
  );
  const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
  const [wsFilter, setWsFilter] = useState<string | null>(null);
  const { q: searchQ } = useListSearch();
  const flowSteps = useFlowSteps();
  const navigate = useNavigate();
  const userId = session?.user?.id;
  const { activeWs } = useWorkspace();
  const { data: allAsg } = usePsQuery<{ task_id: string | null; user_id: string | null }>(
    "SELECT task_id, user_id FROM assignments ORDER BY created_at",
  );
  const { data: allSteps } = usePsQuery<{
    chain_id: string | null;
    task_id: string | null;
    position: number | null;
  }>("SELECT chain_id, task_id, position FROM chain_steps ORDER BY position");
  const { data: team } = useQuery({
    queryKey: ["wsMembersFull", activeWs],
    enabled: !!activeWs,
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("members");
      return (await r.json()).members as Member[];
    },
  });

  const g = useMemo(() => {
    const tdy = todayISO();
    const all = tasks ?? [];
    // Spící kroky postupů se v Dnes nezobrazují (README ř. 73) + filtr dle workspace chipů.
    // Podúkoly jen s VLASTNÍM termínem (bez termínu žijí v detailu rodiče, ne v Dnes).
    const awake = all.filter((x) => {
      if (x.parent_id && !x.due_date) return false;
      const fs = flowSteps.get(x.id);
      if (fs && (fs.state === "dormant" || fs.state === "waiting")) return false;
      if (wsFilter) {
        const p = x.project_id ? projMap.get(x.project_id) : undefined;
        if (p?.workspace_id !== wsFilter) return false;
      }
      return true;
    });
    const opn = filterByQuery(sortTasks(filterTasks(awake.filter((x) => !x.completed_at), tb), tb), searchQ);
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
  }, [tasks, tb, flowSteps, wsFilter, projMap, searchQ]);

  // Pořadí pro ↑/↓ v detailu (prototyp _navIds).
  const { setNavIds } = useTaskDetail();
  useEffect(() => {
    setNavIds([...g.overdue, ...g.today].map((x) => x.id));
  }, [g.overdue, g.today, setNavIds]);

  /** „Tvůj další krok v postupech" — VŠECHNY aktivní kroky přiřazené mně (prototyp myFlowSteps, ř. 396–406). */
  const myFlowSteps = useMemo(() => {
    const mine = new Set(
      (allAsg ?? []).filter((a) => a.user_id === userId).map((a) => a.task_id),
    );
    const asgFirst = new Map<string, string>();
    for (const a of allAsg ?? []) {
      if (a.task_id && a.user_id && !asgFirst.has(a.task_id)) asgFirst.set(a.task_id, a.user_id);
    }
    const nameOf = new Map((team ?? []).map((m) => [m.id, m.name] as const));
    const byChain = new Map<string, { task_id: string | null; position: number | null }[]>();
    for (const s of allSteps ?? []) {
      if (!s.chain_id) continue;
      const arr = byChain.get(s.chain_id) ?? [];
      arr.push(s);
      byChain.set(s.chain_id, arr);
    }
    const out: { task: TaskRow; fs: NonNullable<ReturnType<typeof flowSteps.get>>; blocking?: string }[] = [];
    for (const tk of tasks ?? []) {
      if (tk.completed_at || !mine.has(tk.id)) continue;
      const fs = flowSteps.get(tk.id);
      if (fs?.state !== "active") continue;
      // „pak předáš → {jméno}" = přiřazený člověk NÁSLEDUJÍCÍHO kroku (prototyp f.blocking).
      const next = (byChain.get(fs.chainId) ?? []).find((s) => (s.position ?? 0) + 1 === fs.pos + 1);
      const nextUid = next?.task_id ? asgFirst.get(next.task_id) : undefined;
      out.push({ task: tk, fs, blocking: nextUid ? nameOf.get(nextUid) : undefined });
    }
    return out;
  }, [tasks, allAsg, allSteps, team, flowSteps, userId]);

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
      <TaskItem
        key={task.id}
        task={task}
        project={p ? { name: p.name, color: p.color, workspace_id: p.workspace_id } : undefined}
        flow={flowSteps.get(task.id)}
      />
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
        {/* Workspace chipy Vše/Moje/… (prototyp ř. 342–346) */}
        <WorkspaceChips value={wsFilter} onChange={setWsFilter} />

        {/* Chytré přidání úkolu (parser, #7) */}
        <QuickAdd
          projects={projects.map((p: ProjectRow) => ({ id: p.id, name: p.name ?? "" }))}
          people={(team ?? []).map((m) => ({
            id: m.id,
            name: m.name,
            initials: m.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0] ?? "")
              .join("")
              .toUpperCase(),
          }))}
          inboxId={inboxId}
        />

        {/* Tvůj další krok v postupech (prototyp ř. 396–406) */}
        {myFlowSteps.length > 0 && (
          <>
            <div
              className="flex items-center gap-2 font-display font-bold text-ink"
              style={{ margin: "16px 0 8px", padding: "0 4px", fontSize: 13 }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                className="shrink-0"
                style={{ color: "var(--w-brass)" }}
                aria-hidden
              >
                <path
                  d="M2 5h7l-2-2M14 11H7l2 2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t("today.flowNextTitle")}
            </div>
            {myFlowSteps.map((f) => (
              <button
                key={f.task.id}
                type="button"
                onClick={() =>
                  void navigate({ to: "/postupy", search: { postup: f.fs.chainId } })
                }
                className="flex w-full items-center rounded-[11px] border border-line text-left hover:border-brass"
                style={{ gap: 11, padding: "11px 13px", marginBottom: 8, background: "var(--w-brass-soft)" }}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 7, height: 7, background: "var(--w-brass)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display font-bold text-ink" style={{ fontSize: 13.5 }}>
                    {f.task.name}
                  </div>
                  <div className="truncate font-body text-ink-3" style={{ fontSize: 11.5 }}>
                    {f.fs.name}
                    {f.blocking ? ` · ${t("today.thenHandOff")} → ${f.blocking}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-brass-text" style={{ fontSize: 11.5 }}>
                  {f.fs.pos}/{f.fs.total}
                </span>
              </button>
            ))}
          </>
        )}

        {/* toolbar (filtr+řazení; Dokončené sekce má vlastní toggle) */}
        <div className="mt-4">
          <TasksToolbar state={tb} onChange={setTb} hideDone />
        </div>

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
