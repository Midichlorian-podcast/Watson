import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { API_URL } from "../lib/api";
import { advanceChainForTask } from "../lib/chainAdvance";
import { USER_COLORS } from "../lib/colors";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProject } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-3 py-1.5">
      <span className="font-display font-semibold text-ink-3 text-xs">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function TaskDetailPanel() {
  const { openId, close } = useTaskDetail();
  if (!openId) return null;
  return <Panel id={openId} onClose={close} />;
}

function Panel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  // Esc zavře detail (prototyp: Esc zavírá selectedId)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const { data: rows } = usePsQuery<TaskRow>("SELECT * FROM tasks WHERE id = ? LIMIT 1", [id]);
  const task = rows?.[0];
  const { data: subs } = usePsQuery<TaskRow>(
    "SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at",
    [id],
  );
  const { data: depthRows } = usePsQuery<{ depth: number }>(
    `WITH RECURSIVE anc(id, parent_id, lvl) AS (
       SELECT id, parent_id, 1 FROM tasks WHERE id = ?
       UNION ALL SELECT t.id, t.parent_id, anc.lvl + 1 FROM tasks t JOIN anc ON t.id = anc.parent_id
     ) SELECT max(lvl) AS depth FROM anc`,
    [id],
  );
  const depth = depthRows?.[0]?.depth ?? 1;

  const project = useProject(task?.project_id ?? undefined);
  const { data: checklist } = usePsQuery<{
    id: string;
    text: string | null;
    checked: number | null;
  }>(
    "SELECT id, text, checked FROM checklist_items WHERE task_id = ? ORDER BY position, created_at",
    [id],
  );
  const { data: comments } = usePsQuery<{ id: string; body: string | null }>(
    "SELECT id, body FROM comments WHERE task_id = ? ORDER BY created_at",
    [id],
  );
  const { data: assignRows } = usePsQuery<{
    id: string;
    user_id: string | null;
    completed_at: string | null;
  }>("SELECT id, user_id, completed_at FROM assignments WHERE task_id = ?", [id]);
  const { data: reminders } = usePsQuery<{ id: string }>(
    "SELECT id FROM reminders WHERE task_id = ?",
    [id],
  );
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
  const [subText, setSubText] = useState("");
  const [chkText, setChkText] = useState("");
  const [cmtText, setCmtText] = useState("");
  useEffect(() => {
    if (task) {
      setName(task.name ?? "");
      setDesc(task.description ?? "");
    }
  }, [task]);

  if (!task) return null;
  const done = Boolean(task.completed_at);
  const chk = checklist ?? [];
  const cmts = comments ?? [];
  const asg = assignRows ?? [];
  const members = team ?? [];
  const mode = (task.assignment_mode ?? "single") as AssignMode;
  const assignedDone = asg.filter((a) => a.completed_at).length;
  const hasReminder = (reminders?.length ?? 0) > 0;

  const toggleDone = () => {
    void patch(id, { completed_at: done ? null : new Date().toISOString() });
    void advanceChainForTask(id, !done); // krok postupu → advance/rewind
  };

  const toggleAssign = async (uid: string) => {
    const existing = asg.find((a) => a.user_id === uid);
    if (existing) await powerSync.execute("DELETE FROM assignments WHERE id = ?", [existing.id]);
    else
      await powerSync.execute(
        "INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
        [id, task.project_id, uid, new Date().toISOString()],
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
      [task.project_id, id, subText.trim(), new Date().toISOString()],
    );
    setSubText("");
  };

  const addChk = async () => {
    if (!chkText.trim()) return;
    await powerSync.execute(
      "INSERT INTO checklist_items (id, task_id, project_id, text, checked, position) VALUES (uuid(), ?, ?, ?, 0, ?)",
      [id, task.project_id, chkText.trim(), chk.length],
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
      "INSERT INTO comments (id, task_id, project_id, body) VALUES (uuid(), ?, ?, ?)",
      [id, task.project_id, cmtText.trim()],
    );
    setCmtText("");
  };

  const dateInput = (col: "due_date" | "start_date" | "deadline", val: string | null) => (
    <input
      type="date"
      value={val ? val.slice(0, 10) : ""}
      onChange={(e) => void patch(id, { [col]: e.target.value || null })}
      className="rounded-lg border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink-2 outline-none focus:border-brass"
    />
  );

  return (
    <>
      {/* backdrop */}
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0 z-30 bg-navy/20"
      />
      <aside
        className="fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col overflow-y-auto bg-card"
        style={{
          boxShadow: "var(--w-shadow)",
          borderLeft: `4px solid var(--w-p${task.priority ?? 4})`,
        }}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-line border-b px-4 py-3">
          <button
            type="button"
            onClick={toggleDone}
            aria-label={done ? t("today.doneSection") : t("common.done")}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full border text-white text-xs"
            style={{
              borderColor: done ? "var(--w-success)" : "var(--w-line)",
              background: done ? "var(--w-success)" : "transparent",
            }}
          >
            {done ? "✓" : ""}
          </button>
          {project && (
            <span className="flex items-center gap-1.5 text-ink-3 text-xs">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: project.color ?? "var(--w-ink-3)" }}
              />
              {project.name}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void powerSync.execute("DELETE FROM tasks WHERE id = ?", [id]);
              onClose();
            }}
            aria-label={t("detail.delete")}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-overdue-soft hover:text-overdue"
          >
            <Icon name="smazat" size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <Icon name="zavrit" size={16} />
          </button>
        </div>

        <div className="flex-1 px-4 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name.trim() && name !== task.name && void patch(id, { name: name.trim() })
            }
            className={`w-full bg-transparent font-display text-lg font-bold outline-none ${done ? "text-ink-3 line-through" : "text-navy"}`}
          />

          {task.recurrence && (
            <div className="mt-1 inline-flex items-center gap-1 text-brass-text text-xs">
              <Icon name="opakovani" size={13} />
              {task.recurrence}
            </div>
          )}

          {hasReminder && (
            <span className="mt-1 ml-2 inline-flex items-center rounded-full bg-panel-2 px-2 py-0.5 font-display font-semibold text-ink-2 text-xs">
              {t("detail.reminder")}
            </span>
          )}

          <div className="mt-3 border-line border-t pt-2">
            <Field label={t("detail.priority")}>
              <div className="flex gap-1.5">
                {([1, 2, 3, 4] as Pri[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void patch(id, { priority: p })}
                    className="rounded-md border px-2 py-1 font-mono text-xs"
                    style={{
                      borderColor: task.priority === p ? `var(--w-p${p})` : "var(--w-line)",
                      color: `var(--w-p${p})`,
                      background: task.priority === p ? "var(--w-brass-soft)" : "transparent",
                    }}
                  >
                    P{p}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("detail.due")}>{dateInput("due_date", task.due_date)}</Field>
            <Field label={t("detail.start")}>{dateInput("start_date", task.start_date)}</Field>
            <Field label={t("detail.deadline")}>{dateInput("deadline", task.deadline)}</Field>

            <Field label={t("detail.color")}>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void patch(id, { color: null })}
                  className="h-5 w-5 rounded-full border border-line"
                  style={{ background: "var(--w-card)" }}
                  aria-label="—"
                />
                {USER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void patch(id, { color: c })}
                    className="h-5 w-5 rounded-full"
                    style={{
                      background: c,
                      outline: task.color === c ? "2px solid var(--w-navy)" : "none",
                      outlineOffset: "1px",
                    }}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
          </div>

          {/* popis */}
          <div className="mt-3 border-line border-t pt-2">
            <span className="font-display text-xs font-semibold text-ink-3">
              {t("detail.description")}
            </span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() =>
                desc !== (task.description ?? "") && void patch(id, { description: desc || null })
              }
              rows={3}
              placeholder={t("detail.descPlaceholder")}
              className="mt-1 w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-ink text-sm outline-none focus:border-brass"
            />
          </div>

          {/* podúkoly (R1) */}
          <div className="mt-3 border-line border-t pt-2">
            <span className="font-display text-xs font-semibold text-ink-3">
              {t("detail.subtasks")} {(subs?.length ?? 0) > 0 && `· ${subs?.length}`}
            </span>
            <ul className="mt-2 flex flex-col gap-1">
              {(subs ?? []).map((s) => {
                const sd = Boolean(s.completed_at);
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void patch(s.id, { completed_at: sd ? null : new Date().toISOString() })
                      }
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] text-white"
                      style={{
                        borderColor: sd ? "var(--w-success)" : "var(--w-line)",
                        background: sd ? "var(--w-success)" : "transparent",
                      }}
                    >
                      {sd ? "✓" : ""}
                    </button>
                    <span className={`text-sm ${sd ? "text-ink-3 line-through" : "text-ink"}`}>
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
          </div>

          {/* checklist */}
          <div className="mt-3 border-line border-t pt-2">
            <span className="font-display font-semibold text-ink-3 text-xs">
              {t("detail.checklist")}
              {chk.length > 0 && ` · ${chk.filter((c) => c.checked).length}/${chk.length}`}
            </span>
            <ul className="mt-2 flex flex-col gap-1">
              {chk.map((c) => {
                const ck = Boolean(c.checked);
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleChk(c.id, c.checked)}
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[9px] text-white"
                      style={{
                        borderColor: ck ? "var(--w-success)" : "var(--w-line)",
                        background: ck ? "var(--w-success)" : "transparent",
                      }}
                    >
                      {ck ? "✓" : ""}
                    </button>
                    <span className={`text-sm ${ck ? "text-ink-3 line-through" : "text-ink"}`}>
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
          </div>

          {/* přiřazení (R2) */}
          <div className="mt-3 border-line border-t pt-2">
            <span className="font-display font-semibold text-ink-3 text-xs">
              {t("detail.assignment")}
            </span>
            <div className="mt-2 flex gap-1.5">
              {(
                [
                  ["single", "assignSingle"],
                  ["shared_any", "assignAny"],
                  ["shared_all", "assignAll"],
                ] as const
              ).map(([m, key]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void patch(id, { assignment_mode: m })}
                  className="rounded-md border px-2 py-1 font-display font-semibold text-xs"
                  style={{
                    borderColor: mode === m ? "var(--w-brass)" : "var(--w-line)",
                    background: mode === m ? "var(--w-brass-soft)" : "transparent",
                    color: mode === m ? "var(--w-brass-text)" : "var(--w-ink-2)",
                  }}
                >
                  {t(`detail.${key}`)}
                </button>
              ))}
            </div>
            <div className="mt-2 text-ink-3 text-xs">
              {mode === "shared_all"
                ? t("detail.assignAllHint", { done: assignedDone, total: asg.length })
                : t("detail.assignAnyHint")}
            </div>
            {members.length === 0 ? (
              <p className="mt-2 text-ink-3 text-xs">{t("detail.noMembers")}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {members.map((m) => {
                  const a = asg.find((x) => x.user_id === m.id);
                  const assigned = Boolean(a);
                  const pdone = Boolean(a?.completed_at);
                  return (
                    <li key={m.id} className="flex items-center gap-2.5 py-1">
                      {mode === "shared_all" && assigned && a && (
                        <button
                          type="button"
                          onClick={() => togglePersonDone(a)}
                          aria-label={t("common.done")}
                          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[9px] text-white"
                          style={{
                            borderColor: pdone ? "var(--w-success)" : "var(--w-line)",
                            background: pdone ? "var(--w-success)" : "transparent",
                          }}
                        >
                          {pdone ? "✓" : ""}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleAssign(m.id)}
                        title={m.name}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display font-semibold text-[10px] text-white"
                        style={{
                          background: assigned ? "var(--w-navy)" : "var(--w-line)",
                          opacity: assigned ? 1 : 0.5,
                        }}
                      >
                        {initials(m.name)}
                      </button>
                      <span className={`text-sm ${assigned ? "text-ink" : "text-ink-3"}`}>
                        {m.name}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* komentáře */}
          <div className="mt-3 border-line border-t pt-2">
            <span className="font-display font-semibold text-ink-3 text-xs">
              {t("detail.comments")}
              {cmts.length > 0 && ` · ${cmts.length}`}
            </span>
            <ul className="mt-2 flex flex-col gap-2">
              {cmts.map((cm) => (
                <li key={cm.id} className="rounded-lg bg-panel-2 px-3 py-2 text-ink text-sm">
                  {cm.body}
                </li>
              ))}
            </ul>
            <textarea
              value={cmtText}
              onChange={(e) => setCmtText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addCmt();
              }}
              rows={2}
              placeholder={t("detail.addComment")}
              className="mt-2 w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-ink text-sm outline-none focus:border-brass"
            />
          </div>
        </div>
      </aside>
    </>
  );
}
