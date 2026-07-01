import i18n from "@watson/i18n";
import { advanceChainForTask } from "./chainAdvance";
import type { TaskRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";

const pad = (n: number) => String(n).padStart(2, "0");
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Den termínu úkolu (YYYY-MM-DD) nebo null. */
export const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/** Provázané zaškrtnutí ↔ stav „Hotovo" (R9), offline-first zápis. Kroky postupů → advance. */
export async function toggleTask(task: TaskRow) {
  const nowDone = !task.completed_at;
  await powerSync.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", [
    nowDone ? new Date().toISOString() : null,
    task.id,
  ]);
  await advanceChainForTask(task.id, nowDone);
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

const hhmm = (dt: Date) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

/** Deadline vlaječka „do pá 27. 6." (prototyp deadlineLabel, seed ř. 2158). */
export function deadlineLabel(deadlineRaw: string | null) {
  if (!deadlineRaw) return undefined;
  const d = deadlineRaw.slice(0, 10);
  const dt = fromISO(d);
  return `do ${wdShort(d)} ${dt.getDate()}. ${dt.getMonth() + 1}.`;
}

/**
 * Termín pro ŘÁDEK úkolu (prototyp timeLabel/dueLabel, ř. 2902–2903 + submitTask 2463–2466):
 * dnes s časem = „09:00–10:30" (konec = start + trvání), jiné dny s časem = „zítra · 13:00",
 * vícedenní = „N dní", datum v příštím týdnu = „{den} · příští týden".
 */
export function rowDue(task: TaskRow, t: (k: string) => string) {
  const dueRaw = task.due_date;
  if (!dueRaw) return undefined;
  const d = dueRaw.slice(0, 10);
  const tdy = todayISO();
  const start = task.start_date ? new Date(task.start_date) : null;
  const time = start ? hhmm(start) : null;
  const days = task.days ?? 1;

  if (d < tdy) return { label: `${t("today.duePastLower")} · ${wdShort(d)}`, overdue: true };
  if (days > 1) return { label: `${time ? `${time} · ` : ""}${days} ${t("today.daysUnit")}`, overdue: false };
  if (d === tdy) {
    if (start) {
      const end = new Date(start.getTime() + (task.duration_min ?? 30) * 60_000);
      return { label: `${hhmm(start)}–${hhmm(end)}`, overdue: false };
    }
    return { label: t("today.todayLower"), overdue: false };
  }
  const base = dueLabel(dueRaw, t).label;
  // Datum v příštím kalendářním týdnu → „{den} · příští týden" (prototyp ř. 2180).
  const now = fromISO(tdy);
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + (((1 - now.getDay() + 7) % 7) || 7));
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  const dt = fromISO(d);
  if (dt >= nextMonday && dt <= nextSunday && d !== todayISO()) {
    return {
      label: `${wdShort(d)} · ${t("today.nextWeekLower")}${time ? ` · ${time}` : ""}`,
      overdue: false,
    };
  }
  return { label: `${base}${time ? ` · ${time}` : ""}`, overdue: false };
}
