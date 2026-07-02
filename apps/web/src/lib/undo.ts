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

/**
 * Smazání úkolu s undo (tahák: „Smazat (s undo) ⌫"): snapshot úkolu + podřízených řádků,
 * DELETE, a undo = re-INSERT všeho.
 */
export async function deleteTaskWithUndo(taskId: string): Promise<void> {
  const tasks = await snapshotRows("SELECT * FROM tasks WHERE id = ? OR parent_id = ?", [
    taskId,
    taskId,
  ]);
  if (!tasks.length) return;
  const asg = await snapshotRows("SELECT * FROM assignments WHERE task_id = ?", [taskId]);
  const chk = await snapshotRows("SELECT * FROM checklist_items WHERE task_id = ?", [taskId]);
  const cmt = await snapshotRows("SELECT * FROM comments WHERE task_id = ?", [taskId]);
  const step = await snapshotRows("SELECT * FROM chain_steps WHERE task_id = ?", [taskId]);
  const doDelete = async () => {
    await powerSync.execute("DELETE FROM chain_steps WHERE task_id = ?", [taskId]);
    await powerSync.execute("DELETE FROM assignments WHERE task_id = ?", [taskId]);
    await powerSync.execute("DELETE FROM checklist_items WHERE task_id = ?", [taskId]);
    await powerSync.execute("DELETE FROM comments WHERE task_id = ?", [taskId]);
    await powerSync.execute("DELETE FROM tasks WHERE id = ? OR parent_id = ?", [taskId, taskId]);
  };
  await doDelete();
  pushUndo({
    undo: async () => {
      await reinsert("tasks", tasks);
      await reinsert("assignments", asg);
      await reinsert("checklist_items", chk);
      await reinsert("comments", cmt);
      await reinsert("chain_steps", step);
    },
    redo: doDelete,
  });
}
