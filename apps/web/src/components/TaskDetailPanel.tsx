import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { API_URL } from "../lib/api";
import { advanceChainForTask } from "../lib/chainAdvance";
import { useSession } from "../lib/auth-client";
import { USER_COLORS } from "../lib/colors";
import { parseOccId } from "../lib/occurrences";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProject } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { occLabel, rowDue, setOccurrenceOverride, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";

type Pri = 1 | 2 | 3 | 4;
type Member = { id: string; name: string; email: string; image: string | null };
type AssignMode = "single" | "shared_any" | "shared_all";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

/** Relativní čas komentáře („dnes 8:05" / „12. 6."). */
function whenLabel(iso: string | null, t: (k: string) => string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `${t("today.todayLower")} ${hm}`;
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

/** Patch sloupců úkolu lokálně (PowerSync upload → generický write-path). */
async function patch(id: string, data: Record<string, unknown>) {
  const cols = Object.keys(data);
  if (cols.length === 0) return;
  const sets = cols.map((c) => `${c} = ?`).join(", ");
  await powerSync.execute(`UPDATE tasks SET ${sets} WHERE id = ?`, [
    ...cols.map((c) => data[c]),
    id,
  ]);
}

/** Sekční nadpis (prototyp ř. 1024: 11px bold uppercase tracking .06em). */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="font-display font-bold text-ink-3 uppercase"
      style={{ fontSize: 11, letterSpacing: ".06em", margin: "20px 0 7px" }}
    >
      {children}
    </div>
  );
}

/** Brass checkbox (17px čtverec r5 pro položky / kruh pro osoby) s SVG fajfkou. */
function BrassCheck({
  done,
  onClick,
  round,
  size = 17,
}: {
  done: boolean;
  onClick: () => void;
  round?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={done ? "Označit jako nehotové" : "Dokončit"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid shrink-0 place-items-center hover:border-brass"
      style={{
        width: size,
        height: size,
        borderRadius: round ? "50%" : 5,
        border: done ? "none" : "2px solid var(--w-line)",
        background: done ? "var(--w-brass)" : "transparent",
      }}
    >
      {done && (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path
            d="M2 5.7 L4.3 8 L9 2.7"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export function TaskDetailPanel() {
  const { openId, close } = useTaskDetail();
  if (!openId) return null;
  return <Panel id={openId} onClose={close} />;
}

function Panel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { open, navIds } = useTaskDetail();
  const { data: session } = useSession();

  // Výskyt řady: virtuální id `base@ISO` → base úkol + banner + per-výskyt akce.
  const occ = parseOccId(id);
  const realId = occ?.taskId ?? id;

  // Esc zavře detail (jen když nad ním není vyšší vrstva); ↑/↓ (j/k) přepíná úkoly.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector("[data-esc-layer]")) return;
        onClose();
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = navIds.indexOf(id);
      if (i < 0) return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        if (i < navIds.length - 1) {
          e.preventDefault();
          open(navIds[i + 1] ?? id);
        }
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        if (i > 0) {
          e.preventDefault();
          open(navIds[i - 1] ?? id);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, navIds, id, open]);

  const { data: rows } = usePsQuery<TaskRow>("SELECT * FROM tasks WHERE id = ? LIMIT 1", [realId]);
  const task = rows?.[0];
  const { data: subs } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at",
    [realId],
  );
  const { data: depthRows } = usePsQuery<{ depth: number }>(
    `WITH RECURSIVE anc(id, parent_id, lvl) AS (
       SELECT id, parent_id, 1 FROM tasks WHERE id = ?
       UNION ALL SELECT t.id, t.parent_id, anc.lvl + 1 FROM tasks t JOIN anc ON t.id = anc.parent_id
     ) SELECT max(lvl) AS depth FROM anc`,
    [realId],
  );
  const depth = depthRows?.[0]?.depth ?? 1;

  const project = useProject(task?.project_id ?? undefined);
  const { data: checklist } = usePsQuery<{ id: string; text: string | null; checked: number | null }>(
    "SELECT id, text, checked FROM checklist_items WHERE task_id = ? ORDER BY position, created_at",
    [realId],
  );
  const { data: comments } = usePsQuery<{
    id: string;
    body: string | null;
    author_id: string | null;
    created_at: string | null;
  }>(
    "SELECT id, body, author_id, created_at FROM comments WHERE task_id = ? ORDER BY created_at",
    [realId],
  );
  const { data: assignRows } = usePsQuery<{
    id: string;
    user_id: string | null;
    completed_at: string | null;
  }>("SELECT id, user_id, completed_at FROM assignments WHERE task_id = ?", [realId]);
  const { data: reminders } = usePsQuery<{ id: string }>(
    "SELECT id FROM reminders WHERE task_id = ?",
    [realId],
  );
  const { data: statusRows } = usePsQuery<{ name: string | null; is_done: number | null; position: number | null }>(
    "SELECT s.name, s.is_done, s.position FROM statuses s JOIN tasks tk ON tk.status_id = s.id WHERE tk.id = ? LIMIT 1",
    [realId],
  );
  const { data: occRows } = usePsQuery<{ id: string; done: number | null; skipped: number | null }>(
    "SELECT id, done, skipped FROM task_occurrence_overrides WHERE task_id = ? AND occ_date = ? LIMIT 1",
    [realId, occ?.iso ?? ""],
  );
  const occOverride = occ ? occRows?.[0] : undefined;

  const projectId = task?.project_id ?? undefined;
  const { data: team } = useQuery({
    queryKey: ["projMembers", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/projects/${projectId}/members`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("members");
      return (await r.json()).members as Member[];
    },
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [descOpen, setDescOpen] = useState(false);
  const [subText, setSubText] = useState("");
  const [chkText, setChkText] = useState("");
  const [cmtText, setCmtText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (task) {
      setName(task.name ?? "");
      setDesc(task.description ?? "");
    }
  }, [task]);

  if (!task) return null;
  const done = occ ? Boolean(occOverride?.done) : Boolean(task.completed_at);
  const chk = checklist ?? [];
  const cmts = comments ?? [];
  const asg = assignRows ?? [];
  const members = team ?? [];
  const memberOf = (uid: string | null) => members.find((m) => m.id === uid);
  const mode = (task.assignment_mode ?? "single") as AssignMode;
  const assignedDone = asg.filter((a) => a.completed_at).length;
  const hasReminder = (reminders?.length ?? 0) > 0;
  const status = statusRows?.[0];
  const overdue = !done && !!task.due_date && task.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);

  const toggleDone = () => {
    if (occ) {
      void setOccurrenceOverride(realId, task.project_id, occ.iso, { done: !done });
      return;
    }
    void toggleTask(task);
  };
  const skipOcc = () => {
    if (!occ) return;
    void setOccurrenceOverride(realId, task.project_id, occ.iso, { skipped: true }).then(() => {
      showToast(`${t("detail.occSkipped")} · ${occLabel(occ.iso)}`);
      onClose();
    });
  };

  const toggleAssign = async (uid: string) => {
    const existing = asg.find((a) => a.user_id === uid);
    if (existing) await powerSync.execute("DELETE FROM assignments WHERE id = ?", [existing.id]);
    else
      await powerSync.execute(
        "INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
        [realId, task.project_id, uid, new Date().toISOString()],
      );
  };
  const togglePersonDone = (a: { id: string; completed_at: string | null }) =>
    void powerSync.execute("UPDATE assignments SET completed_at = ? WHERE id = ?", [
      a.completed_at ? null : new Date().toISOString(),
      a.id,
    ]);

  const addSub = async () => {
    if (!subText.trim() || depth >= 3) return;
    await powerSync.execute(
      "INSERT INTO tasks (id, project_id, parent_id, name, priority, created_at) VALUES (uuid(), ?, ?, ?, 4, ?)",
      [task.project_id, realId, subText.trim(), new Date().toISOString()],
    );
    setSubText("");
  };
  const addChk = async () => {
    if (!chkText.trim()) return;
    await powerSync.execute(
      "INSERT INTO checklist_items (id, task_id, project_id, text, checked, position) VALUES (uuid(), ?, ?, ?, 0, ?)",
      [realId, task.project_id, chkText.trim(), chk.length],
    );
    setChkText("");
  };
  const toggleChk = (cid: string, checked: number | null) =>
    void powerSync.execute("UPDATE checklist_items SET checked = ? WHERE id = ?", [
      checked ? 0 : 1,
      cid,
    ]);
  const addCmt = async () => {
    if (!cmtText.trim()) return;
    await powerSync.execute(
      "INSERT INTO comments (id, task_id, project_id, author_id, body, created_at) VALUES (uuid(), ?, ?, ?, ?, ?)",
      [realId, task.project_id, session?.user?.id ?? null, cmtText.trim(), new Date().toISOString()],
    );
    setCmtText("");
  };

  const duplicate = async () => {
    const nid = crypto.randomUUID();
    await powerSync.execute(
      `INSERT INTO tasks (id, project_id, section_id, parent_id, name, description, priority, color,
        due_date, start_date, deadline, duration_min, days, recurrence, recurrence_rule,
        recurrence_basis, assignment_mode, created_at)
       SELECT ?, project_id, section_id, parent_id, name || ' (kopie)', description, priority, color,
        due_date, start_date, deadline, duration_min, days, recurrence, recurrence_rule,
        recurrence_basis, assignment_mode, ? FROM tasks WHERE id = ?`,
      [nid, new Date().toISOString(), realId],
    );
    setMenuOpen(false);
    open(nid);
  };
  const copyLink = () => {
    void navigator.clipboard.writeText(`${location.origin}/ukoly?ukol=${realId}`);
    setMenuOpen(false);
    showToast(t("detail.linkCopied"));
  };
  const del = () => {
    void powerSync.execute("DELETE FROM tasks WHERE id = ?", [realId]);
    onClose();
  };

  // Watson hint (prototyp ř. 2930).
  const hint = overdue
    ? t("detail.hintOverdue")
    : mode === "shared_all"
      ? t("detail.hintAll")
      : t("detail.hintAny");

  const due = rowDue(task, t);
  const seriesRepeat = task.recurrence || t("detail.recurringTask");

  return (
    <>
      {/* backdrop */}
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0 z-30"
        style={{ background: "rgba(10,14,20,.34)" }}
      />
      <aside
        className="fixed top-0 right-0 z-40 flex h-full flex-col border-line border-l bg-card"
        style={{
          width: 444,
          maxWidth: "94vw",
          boxShadow: "var(--w-shadow)",
          animation: "wSlide .22s ease",
        }}
      >
        {/* header: tečka + projekt + ⋯ + × (ř. 977–991) */}
        <div className="flex items-center border-line border-b" style={{ gap: 9, padding: "13px 18px" }}>
          <span
            className="shrink-0 rounded-full"
            style={{ width: 9, height: 9, background: project?.color ?? "var(--w-ink-3)" }}
          />
          <span
            className="min-w-0 flex-1 truncate font-display font-semibold"
            style={{ fontSize: 13, color: "var(--w-ink-2)" }}
          >
            {project?.name ?? ""}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="⋯"
              className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <circle cx="8" cy="3.5" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="8" cy="12.5" r="1.4" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="absolute border border-line bg-card"
                style={{
                  top: 32,
                  right: 0,
                  width: 210,
                  borderRadius: 11,
                  boxShadow: "var(--w-shadow)",
                  padding: 5,
                  zIndex: 10,
                  animation: "wPop .14s ease",
                }}
              >
                <MenuItem icon="duplikovat" onClick={() => void duplicate()}>
                  {t("detail.duplicate")}
                </MenuItem>
                <MenuItem icon="odkaz" onClick={copyLink}>
                  {t("detail.copyLink")}
                </MenuItem>
                <div style={{ height: 1, background: "var(--w-line)", margin: "4px 6px" }} />
                <MenuItem icon="smazat" danger onClick={del}>
                  {t("detail.delete")}
                </MenuItem>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <Icon name="zavrit" size={16} />
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "0 18px 18px" }}>
          {/* banner výskytu (ř. 999–1008) */}
          {occ && (
            <div
              className="border border-line bg-panel-2"
              style={{ margin: "14px 0 0", padding: "11px 13px", borderRadius: 11 }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <span
                  className="font-display font-bold uppercase"
                  style={{ fontSize: 11, letterSpacing: ".05em", color: "var(--w-brass-text)" }}
                >
                  ↻ {t("detail.occSeries")}
                </span>
                <span className="font-mono" style={{ fontSize: 12 }}>
                  {occLabel(occ.iso)}
                </span>
              </div>
              <div className="font-body text-ink-3" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
                {seriesRepeat}. {t("detail.occHint")}
              </div>
              <button
                type="button"
                onClick={() => open(realId)}
                className="mt-1.5 font-display font-semibold hover:underline"
                style={{ fontSize: 12, color: "var(--w-brass-text)" }}
              >
                {t("detail.editSeries")}
              </button>
            </div>
          )}

          {/* checkbox + název (ř. 993–997) */}
          <div className="flex items-start" style={{ gap: 11, marginTop: 16 }}>
            <button
              type="button"
              onClick={toggleDone}
              aria-label={done ? t("today.doneSection") : t("common.done")}
              className="grid shrink-0 place-items-center rounded-full hover:border-brass"
              style={{
                width: 22,
                height: 22,
                marginTop: 2,
                border: done ? "none" : "2px solid var(--w-line)",
                background: done ? "var(--w-brass)" : "transparent",
              }}
            >
              {done && (
                <svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path
                    d="M2 5.7 L4.3 8 L9 2.7"
                    stroke="#fff"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== task.name && void patch(realId, { name: name.trim() })}
              className="w-full bg-transparent font-display text-ink outline-none"
              style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.25 }}
            />
          </div>

          {/* řádek chipů (ř. 1010–1016) — klik otevře editaci polí */}
          <div className="flex flex-wrap" style={{ gap: 8, margin: "16px 0 0" }}>
            <button
              type="button"
              onClick={() => setEditOpen((o) => !o)}
              className="cursor-pointer font-display font-semibold"
              style={{
                fontSize: 11.5,
                padding: "4px 10px",
                borderRadius: 999,
                background: "var(--w-card)",
                border: `1px solid ${task.priority === 1 ? "var(--w-ink-3)" : "var(--w-line)"}`,
                color:
                  task.priority === 1
                    ? "var(--w-ink)"
                    : task.priority === 4
                      ? "var(--w-ink-3)"
                      : "var(--w-ink-2)",
              }}
            >
              {t("detail.priority")} P{task.priority ?? 4}
            </button>
            {due && (
              <button
                type="button"
                onClick={() => setEditOpen((o) => !o)}
                className="cursor-pointer font-mono"
                style={{
                  fontSize: 11.5,
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: "var(--w-panel-2)",
                  color: due.overdue ? "var(--w-overdue)" : "var(--w-ink-2)",
                }}
              >
                {occ ? occLabel(occ.iso) : due.label}
              </button>
            )}
            {status?.name && (status.position ?? 0) > 0 && (
              <span
                className="font-display font-semibold"
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: (status.name ?? "").toLowerCase().includes("kontrol")
                    ? "var(--w-panel-2)"
                    : "var(--w-success-soft)",
                  color: (status.name ?? "").toLowerCase().includes("kontrol")
                    ? "var(--w-ink-2)"
                    : "var(--w-success-ink)",
                }}
              >
                {status.name}
              </span>
            )}
            {task.recurrence && (
              <span
                className="font-display font-semibold"
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--w-panel-2)",
                  color: "var(--w-ink-2)",
                }}
              >
                ↻ {t("detail.recurringPill")}
              </span>
            )}
            {hasReminder && (
              <span
                className="font-display font-semibold"
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--w-panel-2)",
                  color: "var(--w-ink-2)",
                }}
              >
                {t("detail.reminder")}
              </span>
            )}
          </div>

          {/* rozbalená editace polí (aditivní — klik na chip) */}
          {editOpen && !occ && (
            <div
              className="border border-line bg-panel-2"
              style={{ marginTop: 10, borderRadius: 11, padding: "10px 12px" }}
            >
              <div className="flex items-center" style={{ gap: 6 }}>
                {([1, 2, 3, 4] as Pri[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void patch(realId, { priority: p })}
                    className="font-display font-semibold"
                    style={{
                      fontSize: 12,
                      padding: "5px 13px",
                      borderRadius: 9,
                      border: `1px solid ${task.priority === p ? "var(--w-brass)" : "var(--w-line)"}`,
                      background: task.priority === p ? "var(--w-brass-soft)" : "transparent",
                      color: task.priority === p ? "var(--w-brass-text)" : "var(--w-ink-2)",
                    }}
                  >
                    P{p}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center" style={{ gap: 8, marginTop: 9 }}>
                {(
                  [
                    ["due_date", t("detail.due")],
                    ["deadline", t("detail.deadline")],
                  ] as const
                ).map(([col, label]) => (
                  <label key={col} className="flex items-center" style={{ gap: 6 }}>
                    <span className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
                      {label}
                    </span>
                    <input
                      type="date"
                      value={task[col] ? (task[col] ?? "").slice(0, 10) : ""}
                      onChange={(e) => void patch(realId, { [col]: e.target.value || null })}
                      className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-ink-2 text-xs outline-none focus:border-brass"
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 9 }}>
                <button
                  type="button"
                  onClick={() => void patch(realId, { color: null })}
                  aria-label="—"
                  className="grid place-items-center border border-line bg-card"
                  style={{ width: 20, height: 20, borderRadius: 6 }}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
                    <line x1="3" y1="11" x2="11" y2="3" stroke="var(--w-ink-3)" strokeWidth="1.3" />
                  </svg>
                </button>
                {USER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void patch(realId, { color: c })}
                    aria-label={c}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: c,
                      boxShadow:
                        task.color === c
                          ? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)"
                          : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Watson hint (ř. 1018–1021) */}
          <div
            className="flex items-start"
            style={{ gap: 9, margin: "18px 0 0", padding: "12px 14px", background: "var(--w-brass-soft)", borderRadius: 11 }}
          >
            <span
              className="flex shrink-0 items-center justify-center rounded-full"
              style={{
                width: 18,
                height: 18,
                border: "1.6px solid var(--w-brass)",
                color: "var(--w-brass-text)",
                fontWeight: 800,
                fontSize: 10,
              }}
            >
              W
            </span>
            <span className="font-body" style={{ fontSize: 13, color: "var(--w-ink-2)", lineHeight: 1.5 }}>
              {hint}
            </span>
          </div>

          {/* POPIS (ř. 1023–1026) */}
          {task.description || descOpen ? (
            <>
              <SectionLabel>{t("detail.description")}</SectionLabel>
              {descOpen ? (
                <textarea
                  // biome-ignore lint/a11y/noAutofocus: přepnutí do editace popisu
                  autoFocus
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onBlur={() => {
                    setDescOpen(false);
                    if (desc !== (task.description ?? ""))
                      void patch(realId, { description: desc || null });
                  }}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-ink text-sm outline-none focus:border-brass"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setDescOpen(true)}
                  className="w-full text-left font-body"
                  style={{ fontSize: 13.5, color: "var(--w-ink-2)", lineHeight: 1.55 }}
                >
                  {task.description}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setDescOpen(true)}
              className="mt-4 inline-flex items-center font-body text-ink-3 hover:text-brass-text"
              style={{ gap: 5, fontSize: 12 }}
            >
              {t("addmodal.addDesc")}
            </button>
          )}

          {/* PODÚKOLY (R1) */}
          <SectionLabel>
            {t("detail.subtasks")}
            {(subs?.length ?? 0) > 0 && ` · ${subs?.length}`}
          </SectionLabel>
          <ul>
            {(subs ?? []).map((s) => {
              const sd = Boolean(s.completed_at);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: toggle na klik do řádku (prototyp ř. 1031)
                <li
                  key={s.id}
                  onClick={() => void patch(s.id, { completed_at: sd ? null : new Date().toISOString() })}
                  className="flex cursor-pointer items-center border-line border-b"
                  style={{ gap: 10, padding: "7px 0" }}
                >
                  <BrassCheck
                    done={sd}
                    onClick={() => void patch(s.id, { completed_at: sd ? null : new Date().toISOString() })}
                  />
                  <span style={{ fontSize: 13, color: sd ? "var(--w-ink-3)" : "var(--w-ink)", textDecoration: sd ? "line-through" : "none" }}>
                    {s.name}
                  </span>
                </li>
              );
            })}
          </ul>
          {depth < 3 ? (
            <input
              value={subText}
              onChange={(e) => setSubText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addSub()}
              placeholder={t("detail.addSubtask")}
              className="mt-2 w-full rounded-lg border border-line border-dashed bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brass"
            />
          ) : (
            <p className="mt-2 text-ink-3 text-xs">{t("detail.maxDepth")}</p>
          )}

          {/* CHECKLIST (R1 — lehké položky) */}
          <SectionLabel>
            {t("detail.checklist")}
            {chk.length > 0 && ` · ${chk.filter((c) => c.checked).length}/${chk.length}`}
          </SectionLabel>
          <ul>
            {chk.map((c) => {
              const ck = Boolean(c.checked);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: toggle na klik do řádku
                <li
                  key={c.id}
                  onClick={() => toggleChk(c.id, c.checked)}
                  className="flex cursor-pointer items-center border-line border-b"
                  style={{ gap: 10, padding: "7px 0" }}
                >
                  <BrassCheck done={ck} onClick={() => toggleChk(c.id, c.checked)} />
                  <span style={{ fontSize: 13, color: ck ? "var(--w-ink-3)" : "var(--w-ink)", textDecoration: ck ? "line-through" : "none" }}>
                    {c.text}
                  </span>
                </li>
              );
            })}
          </ul>
          <input
            value={chkText}
            onChange={(e) => setChkText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addChk()}
            placeholder={t("detail.addChecklist")}
            className="mt-2 w-full rounded-lg border border-line border-dashed bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brass"
          />

          {/* PŘIŘAZENÍ (R2) — jen přiřazení + „+ Přiřadit" popover (ř. 1050–1059) */}
          <SectionLabel>{t("detail.assignment")}</SectionLabel>
          <ul>
            {asg.map((a) => {
              const m = memberOf(a.user_id);
              const pdone = Boolean(a.completed_at);
              return (
                <li key={a.id} className="flex items-center" style={{ gap: 10, padding: "5px 0" }}>
                  {mode === "shared_all" && (
                    <BrassCheck round size={18} done={pdone} onClick={() => togglePersonDone(a)} />
                  )}
                  <span
                    className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
                    style={{ width: 24, height: 24, fontSize: 10, color: "#fff", background: "var(--w-navy)" }}
                  >
                    {initials(m?.name ?? "?")}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--w-ink)" }}>{m?.name ?? "—"}</span>
                  <button
                    type="button"
                    onClick={() => a.user_id && void toggleAssign(a.user_id)}
                    aria-label={t("common.cancel")}
                    className="ml-auto text-ink-3 hover:text-overdue"
                    style={{ fontSize: 13 }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAssignOpen((o) => !o)}
              className="mt-1 inline-flex items-center font-display font-semibold text-ink-3 hover:border-brass hover:text-brass-text"
              style={{
                gap: 5,
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 9,
                border: "1px dashed var(--w-line)",
              }}
            >
              + {t("detail.assignBtn")}
            </button>
            {assignOpen && (
              <div
                className="absolute border border-line bg-card"
                style={{
                  top: 34,
                  left: 0,
                  width: 240,
                  borderRadius: 11,
                  boxShadow: "var(--w-shadow)",
                  padding: 6,
                  zIndex: 10,
                  animation: "wPop .14s ease",
                }}
              >
                {members.map((m) => {
                  const assigned = asg.some((a) => a.user_id === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => void toggleAssign(m.id)}
                      className="flex w-full items-center rounded-lg text-left hover:bg-panel-2"
                      style={{ gap: 9, padding: "6px 8px" }}
                    >
                      <span
                        className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
                        style={{
                          width: 24,
                          height: 24,
                          fontSize: 10,
                          color: "#fff",
                          background: "var(--w-navy)",
                          opacity: assigned ? 1 : 0.5,
                        }}
                      >
                        {initials(m.name)}
                      </span>
                      <span className="flex-1" style={{ fontSize: 13, color: "var(--w-ink)" }}>
                        {m.name}
                      </span>
                      {assigned && (
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path
                            d="M3 7.4 L6 10 L11 4"
                            stroke="var(--w-brass-text)"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
                {asg.length >= 2 && (
                  <div className="flex border-line border-t" style={{ gap: 5, marginTop: 5, paddingTop: 6 }}>
                    {(
                      [
                        ["shared_any", t("detail.assignAny")],
                        ["shared_all", t("detail.assignAll")],
                      ] as const
                    ).map(([m2, l]) => (
                      <button
                        key={m2}
                        type="button"
                        onClick={() => void patch(realId, { assignment_mode: m2 })}
                        className="font-display font-semibold"
                        style={{
                          fontSize: 11.5,
                          padding: "5px 10px",
                          borderRadius: 8,
                          border: `1px solid ${mode === m2 ? "var(--w-brass)" : "var(--w-line)"}`,
                          background: mode === m2 ? "var(--w-brass-soft)" : "transparent",
                          color: mode === m2 ? "var(--w-brass-text)" : "var(--w-ink-2)",
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {mode === "shared_all" && asg.length > 0 && (
            <div className="mt-1.5 text-ink-3" style={{ fontSize: 11.5 }}>
              {t("detail.assignAllHint", { done: assignedDone, total: asg.length })}
            </div>
          )}

          {/* KOMENTÁŘE · N (ř. 1062–1071) */}
          <SectionLabel>
            {t("detail.comments")} · {cmts.length}
          </SectionLabel>
          {cmts.map((cm) => {
            const m = memberOf(cm.author_id);
            return (
              <div key={cm.id} className="flex" style={{ gap: 9, marginBottom: 11 }}>
                <span
                  className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
                  style={{ width: 26, height: 26, fontSize: 10, color: "#fff", background: "var(--w-navy)" }}
                >
                  {initials(m?.name ?? "?")}
                </span>
                <div className="min-w-0">
                  <div className="font-display font-semibold" style={{ fontSize: 12.5, color: "var(--w-ink)" }}>
                    {m?.name ?? "—"}{" "}
                    <span className="font-body" style={{ fontSize: 11, color: "var(--w-ink-3)" }}>
                      · {whenLabel(cm.created_at, t)}
                    </span>
                  </div>
                  <div className="font-body" style={{ fontSize: 13, color: "var(--w-ink-2)", marginTop: 2 }}>
                    {cm.body}
                  </div>
                </div>
              </div>
            );
          })}
          <input
            value={cmtText}
            onChange={(e) => setCmtText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addCmt()}
            placeholder={t("detail.addComment")}
            className="w-full border border-line bg-panel-2 font-body text-ink outline-none focus:border-brass"
            style={{ borderRadius: 9, padding: "8px 11px", fontSize: 13 }}
          />
        </div>

        {/* footer akce (ř. 1073–1077) */}
        <div className="flex border-line border-t" style={{ gap: 9, padding: "13px 18px" }}>
          <button
            type="button"
            onClick={toggleDone}
            className="flex-1 cursor-pointer border-none font-display font-bold"
            style={{
              fontSize: 13,
              color: "#fff",
              background: "var(--w-brass)",
              borderRadius: 10,
              padding: 10,
            }}
          >
            {done ? t("detail.markUndone") : t("detail.markDone")}
          </button>
          {occ && (
            <button
              type="button"
              onClick={skipOcc}
              className="cursor-pointer border border-line bg-panel-2 font-display font-semibold text-ink-2"
              style={{ fontSize: 13, borderRadius: 10, padding: "10px 14px" }}
            >
              {t("detail.skip")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border border-line bg-panel-2 font-display font-semibold text-ink-2"
            style={{ fontSize: 13, borderRadius: 10, padding: "10px 14px" }}
          >
            {t("detail.close")}
          </button>
        </div>
      </aside>
    </>
  );
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: "duplikovat" | "odkaz" | "smazat";
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center rounded-lg text-left font-display font-semibold ${
        danger ? "hover:bg-overdue-soft" : "hover:bg-panel-2"
      }`}
      style={{
        gap: 9,
        padding: "8px 10px",
        fontSize: 12.5,
        color: danger ? "var(--w-overdue)" : "var(--w-ink-2)",
      }}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}
