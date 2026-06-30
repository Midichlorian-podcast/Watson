import { useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useTaskDetail } from "../lib/taskDetail";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Den, na kterém úkol „visí": termín, jinak začátek. */
const taskDay = (t: TaskRow) => (t.due_date ?? t.start_date)?.slice(0, 10) ?? null;

/**
 * Měsíční kalendář (design handoff §9.6): mřížka pondělí-first, dnešek zvýrazněn,
 * max 3 úkoly/den + „+N další", klik na úkol → detail panel. Bez drag/resize (v2).
 * Výskyty opakování zatím neexpandujeme (žádné opakované úkoly v datech) — fáze occurrences.
 */
export function CalendarMonth({ tasks }: { tasks: TaskRow[] }) {
  const { t, i18n } = useTranslation();
  const { open } = useTaskDetail();
  const [offset, setOffset] = useState(0);

  const today = new Date();
  const todayIso = isoOf(today);
  const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = base.getFullYear();
  const month = base.getMonth();

  const weeks = useMemo(() => {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // pondělí = 0
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let i = 0; i < 7; i++) row.push(new Date(year, month, 1 - firstDow + w * 7 + i));
      out.push(row);
    }
    return out;
  }, [year, month]);

  const byDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const tk of tasks) {
      const d = taskDay(tk);
      if (!d) continue;
      const arr = m.get(d);
      if (arr) arr.push(tk);
      else m.set(d, [tk]);
    }
    return m;
  }, [tasks]);

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i))); // 2024-01-01 = pondělí
  }, [i18n.language]);

  const title = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
    base,
  );

  return (
    <div>
      {/* hlavička: období + navigace */}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display font-extrabold text-navy text-lg capitalize">{title}</h2>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            aria-label={t("calendar.prev")}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-3 hover:border-brass hover:text-ink"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setOffset(0)}
            className="rounded-lg border border-line px-3 py-1.5 font-display font-semibold text-ink text-xs hover:border-brass"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            aria-label={t("calendar.next")}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-3 hover:border-brass hover:text-ink"
          >
            ›
          </button>
        </div>
      </div>

      {/* dny v týdnu */}
      <div className="grid grid-cols-7 gap-1.5">
        {weekdayLabels.map((w) => (
          <div
            key={w}
            className="pb-1 text-center font-display font-bold text-ink-3 text-[11px] uppercase tracking-wider"
          >
            {w}
          </div>
        ))}
      </div>

      {/* mřížka */}
      <div className="grid grid-cols-7 gap-1.5">
        {weeks.flat().map((d) => {
          const iso = isoOf(d);
          const inMonth = d.getMonth() === month;
          const isToday = iso === todayIso;
          const list = byDay.get(iso) ?? [];
          const shown = list.slice(0, 3);
          const more = list.length - shown.length;
          return (
            <div
              key={iso}
              className="flex min-h-[104px] flex-col rounded-lg border p-1.5"
              style={{
                borderColor: isToday ? "var(--w-brass)" : "var(--w-line)",
                background: isToday
                  ? "var(--w-brass-soft)"
                  : inMonth
                    ? "var(--w-card)"
                    : "var(--w-panel-2)",
                opacity: inMonth ? 1 : 0.55,
              }}
            >
              <span
                className={`mb-1 font-mono text-xs ${isToday ? "font-bold text-brass-text" : "text-ink-3"}`}
              >
                {d.getDate()}
              </span>
              <div className="flex flex-col gap-0.5">
                {shown.map((tk) => {
                  const done = Boolean(tk.completed_at);
                  return (
                    <button
                      key={tk.id}
                      type="button"
                      onClick={() => open(tk.id)}
                      title={tk.name ?? ""}
                      className="flex items-center gap-1 truncate rounded-[4px] bg-panel-2 py-0.5 pr-1 pl-1.5 text-left text-[11px]"
                      style={{ borderLeft: `2px solid var(--w-p${tk.priority ?? 4})` }}
                    >
                      <span className={`truncate ${done ? "text-ink-3 line-through" : "text-ink"}`}>
                        {tk.name}
                      </span>
                    </button>
                  );
                })}
                {more > 0 && (
                  <span className="pl-1 text-[10px] text-ink-3">
                    {t("calendar.more", { more })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
