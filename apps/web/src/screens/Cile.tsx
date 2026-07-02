import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { API_URL } from "../lib/api";
import { GSTAT, type GoalStatusKind, goalElapsed, goalProgress, goalStatus } from "../lib/goals";
import type { GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useWorkspace, useWorkspaces } from "../lib/workspace";

type Member = { id: string; name: string; email: string; image: string | null };
type MilestoneRow = {
  id: string;
  goal_id: string | null;
  label: string | null;
  done: number | null;
  position: number | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

const PERIODIC_KEY: Record<string, string> = {
  week: "goals.perWeek",
  month: "goals.perMonth",
  quarter: "goals.perQuarter",
  year: "goals.perYear",
};

function fmtDue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return `do ${d.getDate()}. ${d.getMonth() + 1}.`;
}

/** Cíle — taby dle scope, karty s progresem z reálných úkolů, builder + detail (1:1 dle Cloud Design). */
export function Cile() {
  const { t } = useTranslation();
  const projects = useProjects();
  const { data: workspaces } = useWorkspaces();
  const { activeWs } = useWorkspace();
  const wsP = workspaces?.find((w) => w.id === activeWs)?.isPersonal ?? false;

  const [tab, setTab] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: goals } = usePsQuery<GoalRow>(
    "SELECT * FROM goals WHERE workspace_id = ? ORDER BY created_at",
    [activeWs ?? ""],
  );
  const { data: goalProjects } = usePsQuery<{ goal_id: string | null; project_id: string | null }>(
    "SELECT goal_id, project_id FROM goal_projects",
  );
  const { data: milestones } = usePsQuery<MilestoneRow>(
    "SELECT id, goal_id, label, done, position FROM goal_milestones ORDER BY position, created_at",
  );
  const { data: tasks } = usePsQuery<TaskRow>(
    "SELECT id, project_id, completed_at, due_date FROM tasks",
  );
  const { data: assignments } = usePsQuery<{ task_id: string | null; user_id: string | null }>(
    "SELECT task_id, user_id FROM assignments",
  );
  const { data: team } = useQuery({
    queryKey: ["wsMembers", activeWs],
    enabled: !!activeWs,
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("members");
      return (await r.json()).members as Member[];
    },
  });
  const members = team ?? [];
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "";

  const wsProjectIds = useMemo(
    () => new Set(projects.filter((p) => p.workspace_id === activeWs).map((p) => p.id)),
    [projects, activeWs],
  );
  const linksByGoal = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const gp of goalProjects ?? []) {
      if (!gp.goal_id || !gp.project_id) continue;
      const arr = m.get(gp.goal_id) ?? [];
      arr.push(gp.project_id);
      m.set(gp.goal_id, arr);
    }
    return m;
  }, [goalProjects]);
  const assigneesByTask = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of assignments ?? []) {
      if (!a.task_id || !a.user_id) continue;
      const s = m.get(a.task_id) ?? new Set();
      s.add(a.user_id);
      m.set(a.task_id, s);
    }
    return m;
  }, [assignments]);

  /** Úkoly odpovídající cíli: prostor ∩ propojené projekty ∩ (scope=person → přiřazené vlastníkovi). */
  const goalTasks = useMemo(() => {
    return (g: GoalRow): TaskRow[] => {
      const links = linksByGoal.get(g.id) ?? [];
      const linkSet = new Set(links);
      return (tasks ?? []).filter((tk) => {
        if (!tk.project_id || !wsProjectIds.has(tk.project_id)) return false;
        if (links.length > 0 && !linkSet.has(tk.project_id)) return false;
        if (g.scope === "person" && g.owner_id) {
          if (!assigneesByTask.get(tk.id)?.has(g.owner_id)) return false;
        }
        return true;
      });
    };
  }, [tasks, wsProjectIds, linksByGoal, assigneesByTask]);

  /** Karta cíle — progres + stav. */
  const view = useMemo(() => {
    const tdy = todayISO();
    return (goals ?? []).map((g) => {
      const ts = goalTasks(g);
      let projectPct: { pct: number; count: number } | undefined;
      if (g.metric === "project") {
        const ids = linksByGoal.get(g.id) ?? [];
        let w = 0;
        let p = 0;
        for (const pid of ids) {
          const pts = (tasks ?? []).filter((tk) => tk.project_id === pid);
          const done = pts.filter((tk) => tk.completed_at).length;
          const pct = pts.length ? Math.round((done / pts.length) * 100) : 0;
          w += pts.length;
          p += pct * pts.length;
        }
        projectPct = { pct: w ? Math.round(p / w) : 0, count: ids.length };
      }
      const pr = goalProgress(g.metric ?? "completion", ts, g.target ?? 0, projectPct);
      const overdue = !!g.due_date && g.due_date.slice(0, 10) < tdy;
      const elapsed = goalElapsed(g.created_at, g.due_date, tdy);
      const st = goalStatus(pr.pct, elapsed, overdue, false);
      const links = (linksByGoal.get(g.id) ?? [])
        .map((pid) => projects.find((p) => p.id === pid))
        .filter(Boolean);
      return { g, pr, st, elapsed, overdue, links };
    });
  }, [goals, goalTasks, linksByGoal, tasks, projects]);

  const tabs: [string, string][] = wsP
    ? [["personal", t("goals.tabPersonal")]]
    : [
        ["team", t("goals.tabTeam")],
        ["project", t("goals.tabProject")],
        ["person", t("goals.tabPerson")],
      ];
  const activeTab = tab && tabs.some(([k]) => k === tab) ? tab : (tabs[0]?.[0] ?? "team");
  const shown = wsP ? view : view.filter((v) => (v.g.scope ?? "team") === activeTab);
  const tabCount = (k: string) =>
    wsP ? view.length : view.filter((v) => (v.g.scope ?? "team") === k).length;

  const selected = view.find((v) => v.g.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-[1080px]" style={{ padding: "20px 22px 90px" }}>
      {/* taby + Nový cíl */}
      <div className="mb-4 flex flex-wrap items-center" style={{ gap: 14 }}>
        <div
          className="inline-flex rounded-[10px] border border-line bg-panel-2"
          style={{ padding: 3 }}
        >
          {tabs.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setTab(k);
                setSelectedId(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-[7px] font-display font-semibold"
              style={{
                fontSize: 13,
                padding: "6px 14px",
                background: k === activeTab ? "var(--w-card)" : "transparent",
                color: k === activeTab ? "var(--w-ink)" : "var(--w-ink-3)",
              }}
            >
              {l}
              <span className="font-mono" style={{ fontSize: 11, opacity: 0.7 }}>
                {tabCount(k)}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[10px] font-display font-semibold text-white hover:brightness-105"
          style={{ background: "var(--w-brass)", padding: "9px 15px", fontSize: 13 }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> {t("goals.newGoal")}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="text-center" style={{ padding: "60px 20px" }}>
          <div className="font-body text-ink-3" style={{ fontSize: 14 }}>
            {t("goals.empty")}
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-3.5 rounded-[10px] font-display font-bold text-white hover:brightness-105"
            style={{ background: "var(--w-brass)", padding: "9px 16px", fontSize: 13 }}
          >
            + {t("goals.newGoal")}
          </button>
        </div>
      ) : (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(330px,100%), 1fr))" }}
        >
          {shown.map(({ g, pr, st, links }) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedId(g.id)}
              className="flex flex-col rounded-2xl border border-line bg-card text-left transition-shadow hover:shadow-md"
              style={{ padding: 18, boxShadow: "var(--w-shadow-sm)" }}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className="flex-1 font-display font-bold text-ink"
                  style={{ fontSize: 15.5, lineHeight: 1.25 }}
                >
                  {g.name}
                </span>
                <StatusBadge st={st} />
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-2.5">
                <span className="font-mono text-ink-2" style={{ fontSize: 13 }}>
                  {pr.label}
                </span>
                <span
                  className="whitespace-nowrap font-display font-bold text-ink"
                  style={{ fontSize: 18 }}
                >
                  {pr.pct}&nbsp;%
                </span>
              </div>
              <div
                className="mt-2 overflow-hidden rounded-full bg-panel-2"
                style={{ height: 8 }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, pr.pct)}%`,
                    background: GSTAT[st][3],
                  }}
                />
              </div>
              <div className="mt-3.5 flex items-center gap-2">
                <span
                  title={memberName(g.owner_id)}
                  className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white"
                  style={{ width: 24, height: 24, background: "var(--w-avatar)", fontSize: 10 }}
                >
                  {initials(memberName(g.owner_id) || "?")}
                </span>
                {links.map(
                  (p) =>
                    p && (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 font-display font-semibold text-ink-3"
                        style={{ fontSize: 10.5 }}
                      >
                        <span
                          className="rounded-full"
                          style={{ width: 7, height: 7, background: p.color ?? "var(--w-line)" }}
                        />
                        {p.name}
                      </span>
                    ),
                )}
                <span className="ml-auto inline-flex items-center gap-2">
                  {g.periodic && g.periodic !== "none" && (
                    <span
                      className="inline-flex items-center gap-0.5 font-display font-semibold text-brass-text"
                      style={{ fontSize: 10 }}
                    >
                      ↻ {t(PERIODIC_KEY[g.periodic] ?? "goals.perNone")}
                    </span>
                  )}
                  <span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
                    {fmtDue(g.due_date)}
                  </span>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {modalOpen && activeWs && (
        <GoalModal
          workspaceId={activeWs}
          personal={wsP}
          defaultScope={wsP ? "personal" : activeTab}
          members={members}
          projects={projects.filter((p) => p.workspace_id === activeWs)}
          onClose={() => setModalOpen(false)}
        />
      )}

      {selected && (
        <GoalDetail
          data={selected}
          milestones={(milestones ?? []).filter((m) => m.goal_id === selected.g.id)}
          ownerName={memberName(selected.g.owner_id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ st }: { st: GoalStatusKind }) {
  const [label, bg, color, dot] = GSTAT[st];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-display font-semibold"
      style={{ fontSize: 11, padding: "3px 10px", background: bg, color }}
    >
      <span className="rounded-full" style={{ width: 6, height: 6, background: dot }} />
      {label}
    </span>
  );
}

/** Builder „Nový cíl" — scope/metrika/projekt/target/vlastník/termín/opakování → INSERT přes PowerSync. */
function GoalModal({
  workspaceId,
  personal,
  defaultScope,
  members,
  projects,
  onClose,
}: {
  workspaceId: string;
  personal: boolean;
  defaultScope: string;
  members: Member[];
  projects: { id: string; name: string | null }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [scope, setScope] = useState(defaultScope);
  const [metric, setMetric] = useState("count");
  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState("");
  const [ownerId, setOwnerId] = useState(members[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [periodic, setPeriodic] = useState("none");

  // Esc zavře builder; vlastník se dosadí, jakmile dorazí členové prostoru.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  useEffect(() => {
    if (!ownerId && members[0]) setOwnerId(members[0].id);
  }, [members, ownerId]);

  const HELP: Record<string, string> = {
    completion: t("goals.helpCompletion"),
    ontime: t("goals.helpOntime"),
    count: t("goals.helpCount"),
    project: t("goals.helpProject"),
  };

  const create = async () => {
    const nm = name.trim();
    if (!nm) return onClose();
    const gid = crypto.randomUUID();
    const tgt = Number.parseInt(target, 10) || (metric === "count" ? 10 : metric === "project" ? 100 : 90);
    await powerSync.execute(
      "INSERT INTO goals (id, workspace_id, name, scope, metric, target, due_date, periodic, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [gid, workspaceId, nm, scope, metric, tgt, due || null, periodic, ownerId || null, new Date().toISOString()],
    );
    if (projectId) {
      await powerSync.execute(
        "INSERT INTO goal_projects (id, goal_id, project_id, workspace_id) VALUES (uuid(), ?, ?, ?)",
        [gid, projectId, workspaceId],
      );
    }
    onClose();
  };

  const seg = (on: boolean) => ({
    fontSize: 12.5,
    padding: "7px 13px",
    borderRadius: 9,
    background: on ? "var(--w-card)" : "transparent",
    color: on ? "var(--w-ink)" : "var(--w-ink-3)",
  });

  return (
    <>
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0"
        style={{ background: "rgba(10,14,20,.42)", zIndex: 50 }}
      />
      <div
        className="pointer-events-none fixed inset-0 flex items-start justify-center"
        style={{ zIndex: 51, paddingTop: "9vh" }}
      >
        <div
          className="pointer-events-auto max-h-[84vh] overflow-auto rounded-2xl border border-line bg-card"
          style={{ width: 560, maxWidth: "94vw", boxShadow: "var(--w-shadow)", padding: "18px 20px" }}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex-1 font-display font-bold text-ink" style={{ fontSize: 16 }}>
              {t("goals.newGoal")}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.cancel")}
              className="grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
            >
              <Icon name="zavrit" size={15} />
            </button>
          </div>

          <input
            // biome-ignore lint/a11y/noAutofocus: builder modal
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("goals.namePlaceholder")}
            className="w-full rounded-[10px] border border-line bg-panel-2 font-display font-semibold text-ink outline-none focus:border-brass"
            style={{ padding: "12px 13px", fontSize: 15 }}
          />

          {!personal && (
            <>
              <FieldLabel>{t("goals.scope")}</FieldLabel>
              <div className="inline-flex rounded-[10px] border border-line bg-panel-2" style={{ padding: 3 }}>
                {(
                  [
                    ["team", t("goals.scopeTeam")],
                    ["project", t("goals.scopeProject")],
                    ["person", t("goals.scopePerson")],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setScope(k)} className="font-display font-semibold" style={seg(scope === k)}>
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}

          <FieldLabel>{t("goals.metric")}</FieldLabel>
          <div className="inline-flex flex-wrap rounded-[10px] border border-line bg-panel-2" style={{ padding: 3 }}>
            {(
              [
                ["completion", t("goals.metricCompletion")],
                ["ontime", t("goals.metricOntime")],
                ["count", t("goals.metricCount")],
                ["project", t("goals.metricProject")],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMetric(k)} className="font-display font-semibold" style={seg(metric === k)}>
                {l}
              </button>
            ))}
          </div>
          <p className="mt-2 font-body text-ink-3" style={{ fontSize: 12, lineHeight: 1.45 }}>
            {HELP[metric]}
          </p>

          <div className="mt-3 flex flex-wrap gap-3">
            <div style={{ flex: 1, minWidth: 150 }}>
              <FieldLabel>{t("goals.project")}</FieldLabel>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none"
                style={{ padding: "9px 11px", fontSize: 13 }}
              >
                <option value="">{t("goals.wholeWorkspace")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {metric !== "project" && (
              <div style={{ width: 150 }}>
                <FieldLabel>{t("goals.target")}</FieldLabel>
                <div
                  className="flex items-center gap-1.5 rounded-[9px] border border-line bg-panel-2"
                  style={{ padding: "8px 11px" }}
                >
                  <input
                    type="number"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="w-full border-none bg-transparent font-mono text-ink outline-none"
                    style={{ fontSize: 14 }}
                  />
                  <span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 12 }}>
                    {metric === "count" ? t("goals.targetUnitTasks") : "%"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            <div style={{ flex: 1, minWidth: 150 }}>
              <FieldLabel>{t("goals.owner")}</FieldLabel>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none"
                style={{ padding: "9px 11px", fontSize: 13 }}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: 150 }}>
              <FieldLabel>{t("goals.due")}</FieldLabel>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="w-full rounded-[9px] border border-line bg-panel-2 font-mono text-ink outline-none"
                style={{ padding: "9px 11px", fontSize: 13 }}
              />
            </div>
          </div>

          <FieldLabel>{t("goals.periodic")}</FieldLabel>
          <div className="inline-flex flex-wrap rounded-[10px] border border-line bg-panel-2" style={{ padding: 3 }}>
            {(
              [
                ["none", t("goals.perNone")],
                ["week", t("goals.perWeek")],
                ["month", t("goals.perMonth")],
                ["quarter", t("goals.perQuarter")],
                ["year", t("goals.perYear")],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPeriodic(k)} className="font-display font-semibold" style={seg(periodic === k)}>
                {l}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2.5 border-line border-t pt-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[9px] border border-line font-display font-semibold text-ink-2 hover:border-ink-3"
              style={{ padding: "9px 15px", fontSize: 13 }}
            >
              {t("goals.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!name.trim()}
              className="rounded-[9px] font-display font-bold text-white hover:brightness-105 disabled:opacity-50"
              style={{ background: "var(--w-brass)", padding: "9px 17px", fontSize: 13 }}
            >
              {t("goals.create")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <div
      className="mt-3.5 mb-1.5 font-display font-bold text-ink-3 uppercase"
      style={{ fontSize: 10.5, letterSpacing: ".05em" }}
    >
      {children}
    </div>
  );
}

/** Detail cíle — pravý panel: stav + progres + tempo + milníky + smazání. */
function GoalDetail({
  data,
  milestones,
  ownerName,
  onClose,
}: {
  data: {
    g: GoalRow;
    pr: ReturnType<typeof goalProgress>;
    st: GoalStatusKind;
    elapsed: number;
    links: ({ id: string; name: string | null; color: string | null } | undefined)[];
  };
  milestones: MilestoneRow[];
  ownerName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { g, pr, st, elapsed, links } = data;
  const [msText, setMsText] = useState("");

  const pace =
    pr.pct >= 100
      ? t("goals.paceDone")
      : st === "risk"
        ? t("goals.paceRisk", { pct: pr.pct, elapsed })
        : st === "over"
          ? t("goals.paceOver")
          : t("goals.paceTrack");

  const addMilestone = async () => {
    if (!msText.trim() || !g.workspace_id) return;
    await powerSync.execute(
      "INSERT INTO goal_milestones (id, goal_id, workspace_id, label, done, position, created_at) VALUES (uuid(), ?, ?, ?, 0, ?, ?)",
      [g.id, g.workspace_id, msText.trim(), milestones.length, new Date().toISOString()],
    );
    setMsText("");
  };
  const toggleMs = (m: MilestoneRow) =>
    void powerSync.execute("UPDATE goal_milestones SET done = ? WHERE id = ?", [m.done ? 0 : 1, m.id]);
  const remove = async () => {
    await powerSync.execute("DELETE FROM goal_milestones WHERE goal_id = ?", [g.id]);
    await powerSync.execute("DELETE FROM goal_projects WHERE goal_id = ?", [g.id]);
    await powerSync.execute("DELETE FROM goals WHERE id = ?", [g.id]);
    onClose();
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0 z-30 bg-navy/20"
      />
      <aside
        className="fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col overflow-y-auto bg-card"
        style={{ boxShadow: "var(--w-shadow)" }}
      >
        <div className="flex items-center gap-2 border-line border-b px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-brass-text" aria-hidden>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <StatusBadge st={st} />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <Icon name="zavrit" size={16} />
          </button>
        </div>

        <div className="flex-1 px-4 py-3">
          <h2 className="font-display font-bold text-navy" style={{ fontSize: 19, lineHeight: 1.25 }}>
            {g.name}
          </h2>

          <div className="mt-4 flex items-baseline justify-between">
            <span className="font-mono text-ink-2" style={{ fontSize: 13 }}>
              {pr.label}
            </span>
            <span className="font-display font-bold text-ink" style={{ fontSize: 22 }}>
              {pr.pct} %
            </span>
          </div>
          <div className="mt-2 overflow-hidden rounded-full bg-panel-2" style={{ height: 8 }}>
            <div
              style={{ height: "100%", width: `${Math.min(100, pr.pct)}%`, background: GSTAT[st][3] }}
            />
          </div>
          <p className="mt-1.5 font-body text-ink-3" style={{ fontSize: 12 }}>
            {pr.sub}
            {g.due_date ? ` · ${t("goals.elapsedLabel", { elapsed })}` : ""}
          </p>

          <div
            className="mt-3 rounded-[11px] bg-brass-soft px-3.5 py-3 font-body text-ink-2"
            style={{ fontSize: 13, lineHeight: 1.5 }}
          >
            {pace}
          </div>

          {/* meta */}
          <div className="mt-4 border-line border-t pt-3">
            <MetaRow label={t("goals.owner")} value={ownerName || "—"} />
            <MetaRow
              label={t("goals.project")}
              value={
                links.length > 0
                  ? links.map((p) => p?.name ?? "").join(" · ")
                  : t("goals.filterWhole")
              }
            />
            {g.due_date && <MetaRow label={t("goals.due")} value={fmtDue(g.due_date)} />}
            {g.periodic && g.periodic !== "none" && (
              <MetaRow label={t("goals.periodic")} value={t(PERIODIC_KEY[g.periodic] ?? "goals.perNone")} />
            )}
          </div>

          {/* milníky */}
          <div className="mt-4 border-line border-t pt-3">
            <span className="font-display font-semibold text-ink-3 text-xs">
              {t("goals.milestones")}
              {milestones.length > 0 &&
                ` · ${milestones.filter((m) => m.done).length}/${milestones.length}`}
            </span>
            <ul className="mt-2 flex flex-col gap-1">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleMs(m)}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[9px] text-white"
                    style={{
                      borderColor: m.done ? "var(--w-success)" : "var(--w-line)",
                      background: m.done ? "var(--w-success)" : "transparent",
                    }}
                  >
                    {m.done ? "✓" : ""}
                  </button>
                  <span className={`text-sm ${m.done ? "text-ink-3 line-through" : "text-ink"}`}>
                    {m.label}
                  </span>
                </li>
              ))}
            </ul>
            <input
              value={msText}
              onChange={(e) => setMsText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addMilestone()}
              placeholder={t("goals.addMilestone")}
              className="mt-2 w-full rounded-lg border border-line border-dashed bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brass"
            />
          </div>
        </div>

        <div className="border-line border-t px-4 py-3">
          <button
            type="button"
            onClick={() => void remove()}
            className="w-full rounded-[10px] border border-line font-display font-semibold text-overdue hover:bg-overdue-soft"
            style={{ padding: "9px 0", fontSize: 13 }}
          >
            {t("goals.delete")}
          </button>
        </div>
      </aside>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-display font-semibold text-ink-3 text-xs">{label}</span>
      <span className="text-right font-body text-ink text-sm">{value}</span>
    </div>
  );
}
