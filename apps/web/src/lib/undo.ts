/**
 * Globální undo/redo (⌘Z / ⌘⇧Z) — port historie prototypu (ř. 2206 + 2239 + 2259):
 * zásobník posledních ~40 mutací jako inverzní PowerSync operace. Mazání úkolu snapshotuje
 * řádek vč. dětí (assignments/checklist/comments/chain_step) a undo ho složí zpět.
 */
import i18n from "@watson/i18n";
import { API_URL } from "./api";
import { powerSync } from "./powersync/db";
import { showToast } from "./toast";

interface UndoEntry {
	undo: () => Promise<void>;
	redo: () => Promise<void>;
}

const stack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX = 40;

export function pushUndo(entry: UndoEntry) {
	stack.push(entry);
	if (stack.length > MAX) stack.shift();
	redoStack.length = 0;
}

export async function undo(): Promise<boolean> {
	const e = stack.pop();
	if (!e) return false;
	await e.undo();
	redoStack.push(e);
	showToast(i18n.t("cheat.undone"));
	return true;
}

export async function redo(): Promise<boolean> {
	const e = redoStack.pop();
	if (!e) return false;
	await e.redo();
	stack.push(e);
	showToast(i18n.t("cheat.redone"));
	return true;
}

/** Jednoduchá inverze UPDATE jednoho sloupce (completed_at, priority, due_date…).
 * Volat až PO úspěšném zápisu (D9) — push před execute by při selhání zápisu
 * nechal v zásobníku falešný záznam, jehož ⌘Z „vrací" změnu, která se nestala. */
export function pushColumnUndo(
	table: string,
	id: string,
	col: string,
	prev: unknown,
	next: unknown,
) {
	pushUndo({
		undo: async () => {
			await powerSync.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [prev, id]);
		},
		redo: async () => {
			await powerSync.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [next, id]);
		},
	});
}

/**
 * Smazání úkolu s undo. Autoritou je server command: celý rekurzivní strom,
 * meeting sidecar i podřízené řádky smaže v jedné PostgreSQL transakci a 24h
 * snapshot drží pouze server. Lokální více-op upload už nemůže skončit napůl.
 */
export async function deleteTaskWithUndo(taskId: string): Promise<void> {
	await deleteTasksWithUndo([taskId]);
}

async function command(path: "/api/tasks/delete" | "/api/tasks/restore", body: unknown) {
	const response = await fetch(`${API_URL}${path}`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const detail = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(detail.error ?? `HTTP ${response.status}`);
	}
	return (await response.json()) as { batchId?: string };
}

export async function deleteTasksWithUndo(taskIds: string[]): Promise<boolean> {
	const ids = [...new Set(taskIds)];
	if (!ids.length) return false;
	try {
		let result = await command("/api/tasks/delete", {
			taskIds: ids,
			operationId: crypto.randomUUID(),
		});
		if (!result.batchId) throw new Error("missing_undo_batch");
		let batchId = result.batchId;
		pushUndo({
			undo: async () => {
				await command("/api/tasks/restore", { batchId });
			},
			redo: async () => {
				result = await command("/api/tasks/delete", {
					taskIds: ids,
					operationId: crypto.randomUUID(),
				});
				if (!result.batchId) throw new Error("missing_undo_batch");
				batchId = result.batchId;
			},
		});
		return true;
	} catch {
		showToast(i18n.t("cheat.deleteFailed"));
		return false;
	}
}
