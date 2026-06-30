import { useQuery as usePsQuery } from "@powersync/react";
import type { ProjectRow, SectionRow, StatusRow } from "./powersync/AppSchema";

/**
 * Projekty jako jednotný offline-first zdroj z PowerSync (ne přes API).
 * Barva projektu = tělo karet úkolů (R6).
 */
export function useProjects() {
  const { data } = usePsQuery<ProjectRow>(
    "SELECT * FROM projects WHERE archived_at IS NULL ORDER BY name",
  );
  return data ?? [];
}

export function useProject(id: string | undefined) {
  const { data } = usePsQuery<ProjectRow>("SELECT * FROM projects WHERE id = ? LIMIT 1", [
    id ?? "",
  ]);
  return data?.[0];
}

export function useSections(projectId: string | undefined) {
  const { data } = usePsQuery<SectionRow>(
    "SELECT * FROM sections WHERE project_id = ? ORDER BY position, created_at",
    [projectId ?? ""],
  );
  return data ?? [];
}

export function useStatuses(projectId: string | undefined) {
  const { data } = usePsQuery<StatusRow>(
    "SELECT * FROM statuses WHERE project_id = ? ORDER BY position, created_at",
    [projectId ?? ""],
  );
  return data ?? [];
}
