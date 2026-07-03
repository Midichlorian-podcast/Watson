import i18n from "@watson/i18n";
import { advanceChainForTask } from "./chainAdvance";
import { expandOccurrences, parseOccId, recurrenceKind } from "./occurrences";
import type { TaskRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";
import { showToast } from "./toast";

const pad = (n: number) => String(n).padStart(2, "0");
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Den termínu úkolu (YYYY-MM-DD) nebo null. */
export const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/** Upsert per-výskyt výjimky (exceptions prototypu) — done/skip jednoho výskytu. */
export async function setOccurrenceOverride(
  taskId: string,
  projectId: string | null,
  iso: string,
  patch: { done?: boolean; skipped?: boolean },
) {
  const rows = await powerSync.getAll<{ id: string; done: number | null; skipped: number | null }>(
    "SELECT id, done, skipped FROM task_occurrence_overrides WHERE task_id = ? AND occ_date = ? LIMIT 1",
    [taskId, iso],
  );
  const ex = rows[0];
  if (ex) {
    await powerSync.execute(
      "UPDATE task_occurrence_overrides SET done = ?, skipped = ? WHERE id = ?",
      [patch.done ?? !!ex.done ? 1 : 0, patch.skipped ?? !!ex.skipped ? 1 : 0, ex.id],
    );
  } else {
    await powerSync.execute(
      `INSERT INTO task_occurrence_overrides (id, task_id, project_id, occ_date, done, skipped, created_at)
       VALUES (uuid(), ?, ?, ?, ?, ?, ?)`,
      [taskId, projectId, iso, patch.done ? 1 : 0, patch.skipped ? 1 : 0, new Date().toISOString()],
    );
  }
}

/** Lidský label výskytu „čt 2. 7." (prototyp _occLabel). */
export const occLabel = (iso: string) => {
  const d = iso.slice(0, 10);
  return `${wdShort(d)} ${+d.slice(8, 10)}. ${+d.slice(5, 7)}.`;
};

/**
 * Provázané zaškrtnutí ↔ stav „Hotovo" (R9), offline-first zápis. Kroky postupů → advance.
 * Virtuální výskyt (`id@ISO`) → jen per-výskyt výjimka. Opakovaný base úkol → posun řady
 * na další výskyt (prototyp toggleDone, ř. 2482) s respektem ke konci opakování.
 */
export async function toggleTask(task: TaskRow) {
  // Výskyt řady → přepnout done výjimky, řadu nechat být.
  const occ = parseOccId(task.id);
  if (occ) {
    const nowDone = !task.completed_at;
    await setOccurrenceOverride(occ.taskId, task.project_id, occ.iso, { done: nowDone });
    return;
  }
  const nowDone = !task.completed_at;
  const kind = recurrenceKind(task.recurrence_rule);
  const due = task.due_date?.slice(0, 10);
  if (nowDone && kind && due) {
    // Konec opakování z rule JSON (endKind/until/count + doneCount).
    let rule: Record<string, unknown> = {};
    try {
      rule = JSON.parse(task.recurrence_rule ?? "{}") as Record<string, unknown>;
    } catch {
      /* ponech prázdné */
    }
    const doneCount = (typeof rule.doneCount === "number" ? rule.doneCount : 0) + 1;
    const endKind = typeof rule.endKind === "string" ? rule.endKind : "never";
    const reachedCount =
      endKind === "count" && typeof rule.count === "number" && doneCount >= rule.count;
    const [next] = expandOccurrences({
      baseISO: due,
      kind,
      fromISO: isoPlus(due, 1),
      toISO: isoPlus(due, 800),
      cap: 1,
    });
    const pastUntil =
      endKind === "until" && typeof rule.until === "string" && next && next > rule.until;
    if (next && !reachedCount && !pastUntil) {
      const nextStart = task.start_date ? `${next}T${task.start_date.slice(11)}` : null;
      await powerSync.execute(
        "UPDATE tasks SET due_date = ?, start_date = ?, recurrence_rule = ? WHERE id = ?",
        [next, nextStart, JSON.stringify({ ...rule, doneCount }), task.id],
      );
      showToast(`${i18n.t("detail.movedTo")} ${occLabel(next)}`);
      return;
    }
  }
  // R9: zaškrtnutí ⇄ stav „Hotovo" — synchronizovat i status sloupec (prototyp toggleDone).
  const sts = await powerSync.getAll<{ id: string; is_done: number | null; position: number | null }>(
    `SELECT s.id, s.is_done, s.position FROM statuses s
     JOIN tasks t ON t.project_id = s.project_id WHERE t.id = ? ORDER BY s.position`,
    [task.id],
  );
  const doneStatus = sts.find((s) => s.is_done)?.id ?? null;
  const firstStatus = sts.find((s) => !s.is_done)?.id ?? sts[0]?.id ?? null;
  const nextStatus = nowDone
    ? (doneStatus ?? task.status_id)
    : task.status_id === doneStatus
      ? firstStatus
      : task.status_id;
  await powerSync.execute("UPDATE tasks SET completed_at = ?, status_id = ? WHERE id = ?", [
    nowDone ? new Date().toISOString() : null,
    nextStatus,
    task.id,
  ]);
  await advanceChainForTask(task.id, nowDone);
}

const isoPlus = (iso: string, n: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
