import { useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";

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
  const projects = useProjects();
  const projColor = (id: string | null) =>
    (id ? projects.find((p) => p.id === id)?.color : null) ?? "var(--w-ink-3)";
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
              className="flex min-h-[126px] flex-col gap-[3px] overflow-hidden rounded-[10px] border p-1.5"
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
                className="font-mono"
                style={{
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 400,
                  color: isToday ? "var(--w-brass-text)" : "var(--w-ink-2)",
                }}
              >
                {d.getDate()}
              </span>
              {shown.map((tk) => {
                const done = Boolean(tk.completed_at);
                return (
                  <div
                    key={tk.id}
                    onClick={() => open(tk.id)}
                    title={tk.name ?? ""}
                    className="flex cursor-pointer items-center gap-1 rounded-[4px]"
                    style={{
                      background: "var(--w-panel-2)",
                      borderLeft: `2px solid ${done ? "var(--w-line)" : `var(--w-p${tk.priority ?? 4})`}`,
                      padding: "2px 4px",
                      opacity: done ? 0.55 : 1,
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleTask(tk);
                      }}
                      aria-label={done ? "Označit jako nehotové" : "Dokončit"}
                      className="grid shrink-0 place-items-center rounded-full"
                      style={{
                        width: 11,
                        height: 11,
                        border: `1.6px solid ${done ? "var(--w-success-ink)" : "var(--w-ink-3)"}`,
                        background: done ? "var(--w-success-ink)" : "transparent",
                      }}
                    >
                      {done && <span style={{ color: "#fff", fontSize: 7, lineHeight: 1 }}>✓</span>}
                    </button>
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 5, height: 5, background: projColor(tk.project_id) }}
                    />
                    <span
                      className="truncate"
                      style={{
                        fontSize: 10.5,
                        color: done ? "var(--w-ink-3)" : "var(--w-ink)",
                        textDecoration: done ? "line-through" : "none",
                      }}
                    >
                      {tk.name}
                    </span>
                  </div>
                );
              })}
              {more > 0 && (
                <span
                  className="font-display font-bold"
                  style={{ fontSize: 10, color: "var(--w-brass-text)", padding: "2px 5px" }}
                >
                  {t("calendar.more", { more })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
