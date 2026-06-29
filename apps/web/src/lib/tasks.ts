import type { TaskRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Den termínu úkolu (YYYY-MM-DD) nebo null. */
export const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/** Provázané zaškrtnutí ↔ stav „Hotovo" (R9), offline-first zápis. */
export async function toggleTask(task: TaskRow) {
  await powerSync.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", [
    task.completed_at ? null : new Date().toISOString(),
    task.id,
  ]);
}

/** Štítek termínu pro TaskCard (po termínu červeně, dnes, jinak datum). */
export function dueLabel(dueRaw: string, t: (k: string) => string) {
  const d = dueRaw.slice(0, 10);
  const tdy = todayISO();
  if (d < tdy) return { label: `${t("today.duePast")} · ${d}`, overdue: true };
  if (d === tdy) return { label: t("nav.today"), overdue: false };
  return { label: d, overdue: false };
}
