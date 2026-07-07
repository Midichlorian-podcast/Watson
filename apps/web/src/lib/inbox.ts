import type { ProjectRow, TaskRow } from "./powersync/AppSchema";

/** Inbox projekty (Schránka) — sdílené s triage obrazovkou. */
export const INBOX_NAMES = new Set(["Doručené", "Inbox"]);

export const inboxProjectIds = (projects: ProjectRow[]) =>
	new Set(
		projects.filter((p) => INBOX_NAMES.has(p.name ?? "")).map((p) => p.id),
	);

/**
 * Cílový projekt pro quick-add bez `#projektu` = osobní Schránka aktivního prostoru (R8).
 * NIKDY „první projekt v seznamu" (ten je řazený podle názvu → úkol by spadl do náhodného projektu).
 */
export const pickInboxId = (
	projects: ProjectRow[],
	activeWs?: string | null,
): string | undefined => {
	const inbox = projects.filter((p) => INBOX_NAMES.has(p.name ?? ""));
	return (
		inbox.find((p) => p.workspace_id === activeWs)?.id ??
		inbox[0]?.id ??
		projects.find((p) => p.workspace_id === activeWs)?.id ??
		projects[0]?.id
	);
};

/**
 * Netriážovaný úkol Schránky (bez termínu v inbox projektu) — do Dnes/Úkolů/počtů
 * nepatří, dokud ho uživatel nenaplánuje nebo nepřesune (prototyp inbox triage).
 */
export const isInboxTask = (t: TaskRow, inboxIds: Set<string>) =>
	!t.due_date &&
	!t.completed_at &&
	!!t.project_id &&
	inboxIds.has(t.project_id);
