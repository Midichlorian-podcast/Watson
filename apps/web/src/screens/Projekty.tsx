import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";
import { useTranslation } from "@watson/i18n";
import { Button, Chip, Icon } from "@watson/ui";
import type { ProjectRow } from "../lib/powersync/AppSchema";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjects } from "../lib/projects";

type Counts = { open: number; done: number; total: number };
const ZERO: Counts = { open: 0, done: 0, total: 0 };

/**
 * Projekty — plochý grid karet (design handoff: auto-fill minmax 290px).
 * Detail = pravý slide-in panel (ProjectDetailPanel). Sekce v prototypu nejsou —
 * úkoly visí přímo na projektu; karta ukazuje REÁLNÉ počty z `tasks`.
 */
export function Projekty() {
  const { t } = useTranslation();
  const projects = useProjects();
  const { open } = useProjectDetail();

  const { data: taskRows } = usePsQuery<{ project_id: string | null; completed_at: string | null }>(
    "SELECT project_id, completed_at FROM tasks",
  );
  const { data: memberRows } = usePsQuery<{ project_id: string | null }>(
    "SELECT project_id FROM project_members",
  );

  const counts = useMemo(() => {
    const m = new Map<string, Counts>();
    for (const tk of taskRows ?? []) {
      const k = tk.project_id ?? "";
      const c = m.get(k) ?? { open: 0, done: 0, total: 0 };
      c.total++;
      if (tk.completed_at) c.done++;
      else c.open++;
      m.set(k, c);
    }
    return m;
  }, [taskRows]);

  const memberCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of memberRows ?? []) {
      const k = r.project_id ?? "";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [memberRows]);

  return (
    <div className="mx-auto max-w-[1080px] px-[22px] pt-6 pb-24">
      <header className="flex items-center gap-3">
        <h1 className="font-display text-[17px] font-extrabold text-ink">
          {t("projects.heading")}
        </h1>
        <Button variant="primary" className="ml-auto" disabled title={t("projects.newSoon")}>
          <Icon name="pridat" size={16} />
          {t("projects.new")}
        </Button>
      </header>

      {projects.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line border-dashed px-4 py-12 text-center text-ink-3 text-sm">
          {t("projects.empty")}
        </p>
      ) : (
        <div
          className="mt-6 grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}
        >
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              counts={counts.get(p.id) ?? ZERO}
              members={memberCounts.get(p.id) ?? 0}
              onOpen={() => open(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  counts,
  members,
  onOpen,
}: {
  project: ProjectRow;
  counts: Counts;
  members: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-2xl border border-line bg-card p-4 text-left shadow-[var(--w-shadow-sm)] transition hover:-translate-y-0.5 hover:shadow-[var(--w-shadow)]"
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: project.color ?? "var(--w-ink-3)" }}
        />
        <span className="min-w-0 flex-1 truncate font-display font-bold text-[15px] text-ink">
          {project.name}
        </span>
        {project.archived_at && <Chip>{t("projects.archived")}</Chip>}
      </div>

      <div className="mt-3 flex items-end gap-1.5">
        <span className="font-mono text-2xl text-navy leading-none">{counts.open}</span>
        <span className="mb-0.5 text-ink-3 text-xs">
          {t("projects.openOfTotal", { total: counts.total })}
        </span>
      </div>

      {counts.total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--w-brass)" }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
            <span>{t("projects.pctDone", { pct })}</span>
            {members > 0 && <span>{t("projects.members", { count: members })}</span>}
          </div>
        </div>
      )}
    </button>
  );
}
