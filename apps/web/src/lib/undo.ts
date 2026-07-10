/**
 * Globální undo/redo (⌘Z / ⌘⇧Z) — port historie prototypu (ř. 2206 + 2239 + 2259):
 * zásobník posledních ~40 mutací jako inverzní PowerSync operace. Mazání úkolu snapshotuje
 * řádek vč. dětí (assignments/checklist/comments/chain_step) a undo ho složí zpět.
 */
import i18n from "@watson/i18n";
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

/** Jednoduchá inverze UPDATE jednoho sloupce (completed_at, priority, due_date…). */
export function pushColumnUndo(
	table: string,
	id: string,
	col: string,
	prev: unknown,
	next: unknown,
) {
	pushUndo({
		undo: async () => {
			await powerSync.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [
				prev,
				id,
			]);
		},
		redo: async () => {
			await powerSync.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [
				next,
				id,
			]);
		},
	});
}

type Row = Record<string, unknown>;

async function snapshotRows(sql: string, params: unknown[]): Promise<Row[]> {
	return (await powerSync.getAll<Row>(sql, params)) ?? [];
}

/** Kontext s .execute — buď globální powerSync, nebo transakce (tx). */
type Exec = { execute: (sql: string, params?: unknown[]) => Promise<unknown> };

const reinsert = async (db: Exec, table: string, rows: Row[]) => {
	for (const r of rows) {
		const cols = Object.keys(r).filter(
			(c) => r[c] !== null && r[c] !== undefined,
		);
		await db.execute(
			`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
			cols.map((c) => r[c]),
		);
	}
};

/**
 * Rodiče PŘED dětmi (parent_id FK): server aplikuje upload op-by-op — podúkol vložený
 * před svým rodičem by spadl na FK (400) a op se zahodí → tichá ztráta podúkolu na
 * serveru. Snapshot ze SELECT nemá zaručené pořadí, proto topologicky seřadit.
 */
const parentsFirst = (rows: Row[]): Row[] => {
	const ids = new Set(rows.map((r) => r.id as string));
	const inserted = new Set<string>();
	const ordered: Row[] = [];
	let remaining = [...rows];
	while (remaining.length) {
		const next = remaining.filter((r) => {
			const pid = r.parent_id as string | null | undefined;
			return !pid || !ids.has(pid) || inserted.has(pid);
		});
		if (!next.length) break; // cyklus — nemělo by nastat (R1), zbytek vlož jak je
		for (const r of next) {
			ordered.push(r);
			inserted.add(r.id as string);
		}
		remaining = remaining.filter((r) => !inserted.has(r.id as string));
	}
	return [...ordered, ...remaining];
};

/** Id úkolu + VŠECH potomků do hloubky (R1 = max 3 úrovně; CTE zvládne libovolnou). */
async function descendantIds(taskId: string): Promise<string[]> {
	const rows = await powerSync.getAll<{ id: string }>(
		`WITH RECURSIVE des(id) AS (
       SELECT id FROM tasks WHERE id = ?
       UNION ALL SELECT t.id FROM tasks t JOIN des ON t.parent_id = des.id
     ) SELECT id FROM des`,
		[taskId],
	);
	return rows.map((r) => r.id);
}

const CHILD_TABLES = [
	"chain_steps",
	"assignments",
	"comments",
	"reminders",
	"task_occurrence_overrides",
] as const;

/**
 * Smazání úkolu s undo (tahák: „Smazat (s undo) ⌫"): rekurzivní snapshot úkolu + VŠECH
 * potomků (vnuci, R1 hloubka 3) a jejich podřízených dat, DELETE, undo = re-INSERT všeho.
 */
export async function deleteTaskWithUndo(taskId: string): Promise<void> {
	return deleteTasksWithUndo([taskId]);
}

/**
 * Hromadné smazání s JEDNÍM undo záznamem (prototyp bulkDelete, ř. 3138 — celá dávka
 * se vrací jedním ⌘Z). Sjednocuje snapshot všech úkolů + potomků do jedné transakce.
 */
export async function deleteTasksWithUndo(taskIds: string[]): Promise<void> {
	const seen = new Set<string>();
	for (const tid of taskIds) {
		for (const id of await descendantIds(tid)) seen.add(id);
	}
	const ids = [...seen];
	if (!ids.length) return;
	const ph = ids.map(() => "?").join(", ");
	const tasks = await snapshotRows(
		`SELECT * FROM tasks WHERE id IN (${ph})`,
		ids,
	);
	const children: Record<string, Row[]> = {};
	for (const table of CHILD_TABLES) {
		children[table] = await snapshotRows(
			`SELECT * FROM ${table} WHERE task_id IN (${ph})`,
			ids,
		);
	}
	// Lokální atomicita: smazání úkolu + všech podřízených dat v JEDNÉ transakci (pád uprostřed
	// jinak nechá sirotky / half-deleted stav). Upload fronta to pošle jako jednu CRUD transakci.
	const doDelete = () =>
		powerSync.writeTransaction(async (tx) => {
			for (const table of CHILD_TABLES) {
				await tx.execute(`DELETE FROM ${table} WHERE task_id IN (${ph})`, ids);
			}
			await tx.execute(`DELETE FROM tasks WHERE id IN (${ph})`, ids);
		});
	await doDelete();
	pushUndo({
		undo: () =>
			powerSync.writeTransaction(async (tx) => {
				await reinsert(tx, "tasks", parentsFirst(tasks));
				for (const table of CHILD_TABLES) {
					await reinsert(tx, table, children[table] ?? []);
				}
			}),
		redo: doDelete,
	});
}
