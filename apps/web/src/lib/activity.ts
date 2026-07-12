/**
 * Sdílené logování historie úkolu (task_activity) — jeden zapisovač pro VŠECHNY
 * mutace, ne jen detail úkolu (audit „logging-audit-backup": historie dřív
 * vynechávala vytvoření, odškrtnutí v seznamu, hromadné akce, řetězce).
 *
 * task_activity je append-only overlay (insert-only, nesyncuje se dolů) — zapisuje
 * se přes PowerSync write-path, čte se on-demand z API. project_id je NOT NULL
 * (denormalizace pro scoping), takže bez projektu se nezapisuje.
 */
import { powerSync } from "./powersync/db";

export async function logTaskActivity(
	taskId: string,
	projectId: string | null | undefined,
	userId: string | undefined | null,
	field: string,
	oldValue: string | null,
	newValue: string | null,
): Promise<void> {
	if (!projectId) return; // task_activity.project_id je NOT NULL
	try {
		await powerSync.execute(
			"INSERT INTO task_activity (id, task_id, project_id, user_id, field, old_value, new_value, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?)",
			[taskId, projectId, userId ?? null, field, oldValue, newValue, new Date().toISOString()],
		);
	} catch {
		/* historie je best-effort — selhání logu nesmí shodit vlastní akci */
	}
}
