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
      await powerSync.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [prev, id]);
    },
    redo: async () => {
      await powerSync.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [next, id]);
    },
  });
}

type Row = Record<string, unknown>;

async function snapshotRows(sql: string, params: unknown[]): Promise<Row[]> {
  return (await powerSync.getAll<Row>(sql, params)) ?? [];
}

const reinsert = async (table: string, rows: Row[]) => {
  for (const r of rows) {
    const cols = Object.keys(r).filter((c) => r[c] !== null && r[c] !== undefined);
    await powerSync.execute(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((c) => r[c]),
    );
  }
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
  "checklist_items",
  "comments",
  "reminders",
  "task_occurrence_overrides",
] as const;

/**
 * Smazání úkolu s undo (tahák: „Smazat (s undo) ⌫"): rekurzivní snapshot úkolu + VŠECH
 * potomků (vnuci, R1 hloubka 3) a jejich podřízených dat, DELETE, undo = re-INSERT všeho.
 */
export async function deleteTaskWithUndo(taskId: string): Promise<void> {
  const ids = await descendantIds(taskId);
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(", ");
  const tasks = await snapshotRows(`SELECT * FROM tasks WHERE id IN (${ph})`, ids);
  const children: Record<string, Row[]> = {};
  for (const table of CHILD_TABLES) {
    children[table] = await snapshotRows(
      `SELECT * FROM ${table} WHERE task_id IN (${ph})`,
      ids,
    );
  }
  const doDelete = async () => {
    for (const table of CHILD_TABLES) {
      await powerSync.execute(`DELETE FROM ${table} WHERE task_id IN (${ph})`, ids);
    }
    await powerSync.execute(`DELETE FROM tasks WHERE id IN (${ph})`, ids);
  };
  await doDelete();
  pushUndo({
    undo: async () => {
      await reinsert("tasks", tasks);
      for (const table of CHILD_TABLES) {
        await reinsert(table, children[table] ?? []);
      }
    },
    redo: doDelete,
  });
}
