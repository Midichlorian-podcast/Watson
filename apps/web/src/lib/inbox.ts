import type { ProjectRow, TaskRow } from "./powersync/AppSchema";

/** Inbox projekty (Schránka) — sdílené s triage obrazovkou. */
export const INBOX_NAMES = new Set(["Doručené", "Inbox"]);

export const inboxProjectIds = (projects: ProjectRow[]) =>
	new Set(
		projects.filter((p) => INBOX_NAMES.has(p.name ?? "")).map((p) => p.id),
	);

/**
 * Netriážovaný úkol Schránky (bez termínu v inbox projektu) — do Dnes/Úkolů/počtů
 * nepatří, dokud ho uživatel nenaplánuje nebo nepřesune (prototyp inbox triage).
 */
export const isInboxTask = (t: TaskRow, inboxIds: Set<string>) =>
	!t.due_date &&
	!t.completed_at &&
	!!t.project_id &&
	inboxIds.has(t.project_id);
