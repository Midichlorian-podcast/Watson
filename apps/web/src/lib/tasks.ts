import i18n from "@watson/i18n";
import type { TaskRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";

const pad = (n: number) => String(n).padStart(2, "0");
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Den termínu úkolu (YYYY-MM-DD) nebo null. */
export const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/** Provázané zaškrtnutí ↔ stav „Hotovo" (R9), offline-first zápis. */
export async function toggleTask(task: TaskRow) {
  await powerSync.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", [
    task.completed_at ? null : new Date().toISOString(),
    task.id,
  ]);
}

const fromISO = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
};
const wdShort = (d: string) =>
  new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(fromISO(d));

/**
 * Štítek termínu pro TaskCard (1:1 dle designu): po termínu = „po termínu · {den}" (červeně),
 * dnes/zítra slovy, jinak „{den v týdnu} {d. m.}".
 */
export function dueLabel(dueRaw: string, t: (k: string) => string) {
  const d = dueRaw.slice(0, 10);
  const tdy = todayISO();
  if (d < tdy) return { label: `${t("today.duePastLower")} · ${wdShort(d)}`, overdue: true };
  if (d === tdy) return { label: t("today.todayLower"), overdue: false };
  const tm = new Date();
  tm.setDate(tm.getDate() + 1);
  const tmISO = `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(tm.getDate())}`;
  if (d === tmISO) return { label: t("today.tomorrowLower"), overdue: false };
  const dt = fromISO(d);
  return { label: `${wdShort(d)} ${dt.getDate()}. ${dt.getMonth() + 1}.`, overdue: false };
}
