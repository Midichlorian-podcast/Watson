import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { USER_COLORS } from "../lib/colors";
import type { ProjectRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjectDetail } from "../lib/projectDetail";

/** Patch sloupců projektu (write-path: tabulka `projects`, self-členství). */
async function patchProject(id: string, data: Record<string, unknown>) {
  const cols = Object.keys(data);
  if (cols.length === 0) return;
  const sets = cols.map((c) => `${c} = ?`).join(", ");
  await powerSync.execute(`UPDATE projects SET ${sets} WHERE id = ?`, [
    ...cols.map((c) => data[c]),
    id,
  ]);
}

export function ProjectDetailPanel() {
  const { openId, close } = useProjectDetail();
  if (!openId) return null;
  return <Panel id={openId} onClose={close} />;
}

function Panel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: rows } = usePsQuery<ProjectRow>("SELECT * FROM projects WHERE id = ? LIMIT 1", [
    id,
  ]);
  const project = rows?.[0];
  const { data: stats } = usePsQuery<{ total: number; done: number }>(
    "SELECT count(*) AS total, count(completed_at) AS done FROM tasks WHERE project_id = ?",
    [id],
  );
  const { data: memberRows } = usePsQuery<{ c: number }>(
    "SELECT count(*) AS c FROM project_members WHERE project_id = ?",
    [id],
  );

  const [name, setName] = useState("");
  useEffect(() => {
    if (project) setName(project.name ?? "");
  }, [project]);

  if (!project) return null;
  const total = stats?.[0]?.total ?? 0;
  const done = stats?.[0]?.done ?? 0;
  const openCount = total - done;
  const members = memberRows?.[0]?.c ?? 0;
  const archived = Boolean(project.archived_at);
  const dot = project.color ?? "var(--w-ink-3)";

  return (
    <>
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0 z-30 bg-navy/20"
      />
      <aside
        className="fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col bg-card"
        style={{ boxShadow: "var(--w-shadow)", borderLeft: `4px solid ${dot}` }}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-line border-b px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
          <span className="font-display font-semibold text-ink-3 text-sm">
            {t("projects.detailTitle")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <Icon name="zavrit" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name.trim() && name !== project.name && void patchProject(id, { name: name.trim() })
            }
            className="w-full bg-transparent font-display font-bold text-lg text-navy outline-none"
          />

          {/* BARVA */}
          <Section label={t("projects.color")}>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void patchProject(id, { color: null })}
                className="grid h-6 w-6 place-items-center rounded-md border border-line text-ink-3"
                style={{ background: "var(--w-card)" }}
                aria-label={t("projects.colorDefault")}
              >
                {!project.color && "✓"}
              </button>
              {USER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void patchProject(id, { color: c })}
                  className="h-6 w-6 rounded-md"
                  style={{
                    background: c,
                    outline: project.color === c ? "2px solid var(--w-navy)" : "none",
                    outlineOffset: "1px",
                  }}
                  aria-label={c}
                />
              ))}
            </div>
          </Section>

          {/* STAV */}
          <Section label={t("projects.status")}>
            <div className="flex gap-1.5">
              <Seg active={!archived} onClick={() => void patchProject(id, { archived_at: null })}>
                {t("projects.statusActive")}
              </Seg>
              <Seg
                active={archived}
                onClick={() => void patchProject(id, { archived_at: new Date().toISOString() })}
              >
                {t("projects.statusArchived")}
              </Seg>
            </div>
          </Section>

          {/* STATISTIKY */}
          <div className="mt-5 grid grid-cols-3 gap-2 border-line border-t pt-4">
            <Stat value={openCount} label={t("projects.statOpen")} />
            <Stat value={done} label={t("projects.statDone")} tone="success" />
            <Stat value={total} label={t("projects.statTotal")} />
          </div>

          {/* ČLENOVÉ */}
          <div className="mt-4 flex items-center gap-2 border-line border-t pt-4 text-ink-2 text-sm">
            <Icon name="prirazeni" size={15} />
            {t("projects.members", { count: members })}
          </div>
        </div>

        {/* patička */}
        <div className="flex gap-2 border-line border-t bg-card px-4 py-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              void navigate({ to: "/ukoly", search: { projekt: id } });
            }}
            className="flex-1 rounded-lg bg-navy px-4 py-2 font-display font-semibold text-sm text-white hover:bg-navy-2"
          >
            {t("projects.viewTasks")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 font-display font-semibold text-ink text-sm hover:border-brass"
          >
            {t("common.cancel")}
          </button>
        </div>
      </aside>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <span className="font-display font-semibold text-ink-3 text-xs uppercase tracking-[0.06em]">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-3 py-1.5 font-display font-semibold text-xs"
      style={{
        borderColor: active ? "var(--w-brass)" : "var(--w-line)",
        background: active ? "var(--w-brass-soft)" : "transparent",
        color: active ? "var(--w-brass-text)" : "var(--w-ink-3)",
      }}
    >
      {children}
    </button>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "success" }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2 text-center">
      <div
        className={`font-mono text-xl ${tone === "success" ? "text-[var(--w-success-ink)]" : "text-navy"}`}
      >
        {value}
      </div>
      <div className="text-[11px] text-ink-3">{label}</div>
    </div>
  );
}
