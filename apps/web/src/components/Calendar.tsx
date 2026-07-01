import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@watson/i18n";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { CalendarMonth } from "./CalendarMonth";

type Mode = "day" | "week" | "month";
type WeekView = "cols" | "grid";
const MODE_LS = "watson.calMode";
const PPM = 0.62; // pixely / minuta (prototyp PPMOPT.comfortable, ř. 1911)

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const taskDay = (t: TaskRow) => (t.due_date ?? t.start_date)?.slice(0, 10) ?? null;
/** Minuty od půlnoci ze start_date (null = bez času / 00:00 bereme jako bez času). */
const startMin = (t: TaskRow): number | null => {
  const s = t.start_date;
  if (!s || s.length < 16) return null;
  const h = +s.slice(11, 13);
  const m = +s.slice(14, 16);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h === 0 && m === 0) return null;
  return h * 60 + m;
};

/** České genitivy měsíců + dny (verbatim prototyp ř. 3109-3110). */
const MNG = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const WD = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

/**
 * Kalendář — Den / Týden (Sloupce|Mřížka) / Měsíc + range label + zkratky ←/→/d/1-3
 * (1:1 dle Cloud Design; drag-create/resize odloženo — RECONCILIACE §25).
 */
export function Calendar({ tasks }: { tasks: TaskRow[] }) {
  const { t, i18n } = useTranslation();
  const { open } = useTaskDetail();
  const projects = useProjects();
  const projColor = (id: string | null) =>
    (id ? projects.find((p) => p.id === id)?.color : null) ?? "var(--w-ink-3)";

  const [mode, setModeState] = useState<Mode>(() => {
    const m = localStorage.getItem(MODE_LS);
    return m === "day" || m === "week" ? m : "month";
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    setOffset(0);
    localStorage.setItem(MODE_LS, m);
  };
  const [offset, setOffset] = useState(0);
  const [weekView, setWeekView] = useState<WeekView>("grid");

  const today = new Date();
  const todayIso = isoOf(today);

  /** Dny zobrazeného období (day: 1, week: Po–Ne, month: base date). */
  const { days, rangeLabel, monthBase } = useMemo(() => {
    if (mode === "day") {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const label = `${d.getDate()}. ${MNG[d.getMonth()]} · ${WD[d.getDay()]}`;
      return { days: [d], rangeLabel: label, monthBase: d };
    }
    if (mode === "week") {
      const mon = new Date(today);
      mon.setDate(today.getDate() - ((today.getDay() + 6) % 7) + offset * 7);
      const list = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mon);
        d.setDate(mon.getDate() + i);
        return d;
      });
      const sun = list[6] ?? mon;
      const label =
        mon.getMonth() === sun.getMonth()
          ? `${mon.getDate()}.–${sun.getDate()}. ${MNG[sun.getMonth()]} ${sun.getFullYear()}`
          : `${mon.getDate()}. ${MNG[mon.getMonth()]} – ${sun.getDate()}. ${MNG[sun.getMonth()]} ${sun.getFullYear()}`;
      return { days: list, rangeLabel: label, monthBase: mon };
    }
    const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const label = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(base);
    return { days: [], rangeLabel: label, monthBase: base };
  }, [mode, offset, i18n.language, todayIso]);

  // ── zkratky ←/→ / d / 1-3 (tahák) ──────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setOffset((o) => o - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setOffset((o) => o + 1);
      } else if (e.key === "d" || e.key === "D") {
        setOffset(0);
      } else if (e.key === "1") setMode("day");
      else if (e.key === "2") setMode("week");
      else if (e.key === "3") setMode("month");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const tk of tasks) {
      const d = taskDay(tk);
      if (!d) continue;
      m.set(d, [...(m.get(d) ?? []), tk]);
    }
    return m;
  }, [tasks]);

  return (
    <div>
      {/* toolbar (1:1: prev/Dnes/next + range + Den/Týden/Měsíc + týdenní Sloupce/Mřížka) */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            aria-label={t("calendar.prev")}
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-ink-2 hover:bg-panel-2"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setOffset(0)}
            className="rounded-lg border border-line px-3 py-1.5 font-display font-semibold text-ink-2 text-xs hover:border-brass hover:text-brass-text"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            aria-label={t("calendar.next")}
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-ink-2 hover:bg-panel-2"
          >
            ›
          </button>
        </div>
        <span className="whitespace-nowrap font-display font-extrabold text-ink capitalize" style={{ fontSize: 16 }}>
          {rangeLabel}
        </span>
        <div className="ml-auto flex rounded-[9px] border border-line bg-panel-2" style={{ padding: 3 }}>
          {(
            [
              ["day", t("calendar.viewDay")],
              ["week", t("calendar.viewWeek")],
              ["month", t("calendar.viewMonth")],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className="rounded-md font-display font-semibold"
              style={{
                fontSize: 12,
                padding: "5px 14px",
                background: mode === k ? "var(--w-card)" : "transparent",
                color: mode === k ? "var(--w-ink)" : "var(--w-ink-3)",
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {mode === "week" && (
          <div className="inline-flex rounded-lg border border-line bg-panel-2" style={{ padding: 3 }}>
            {(
              [
                ["cols", t("calendar.weekCols")],
                ["grid", t("calendar.weekGrid")],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setWeekView(k)}
                className="rounded-md font-display font-semibold"
                style={{
                  fontSize: 12,
                  padding: "5px 11px",
                  background: weekView === k ? "var(--w-card)" : "transparent",
                  color: weekView === k ? "var(--w-ink)" : "var(--w-ink-3)",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "month" ? (
        <CalendarMonth tasks={tasks} controlledBase={monthBase} />
      ) : mode === "week" && weekView === "cols" ? (
        <WeekColumns days={days} byDay={byDay} todayIso={todayIso} projColor={projColor} onOpen={open} />
      ) : (
        <TimeGrid days={days} byDay={byDay} todayIso={todayIso} projColor={projColor} onOpen={open} />
      )}
    </div>
  );
}

/** Týden „Sloupce" — 7 seznamových sloupců (čitelné názvy). */
function WeekColumns({
  days,
  byDay,
  todayIso,
  projColor,
  onOpen,
}: {
  days: Date[];
  byDay: Map<string, TaskRow[]>;
  todayIso: string;
  projColor: (id: string | null) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
      {days.map((d) => {
        const iso = isoOf(d);
        const isToday = iso === todayIso;
        return (
          <div
            key={iso}
            className="flex min-h-[300px] flex-col gap-1 rounded-[10px] border p-1.5"
            style={{
              borderColor: isToday ? "var(--w-brass)" : "var(--w-line)",
              background: isToday ? "var(--w-brass-soft)" : "var(--w-card)",
            }}
          >
            <DayHead d={d} isToday={isToday} />
            {(byDay.get(iso) ?? []).map((tk) => (
              <button
                key={tk.id}
                type="button"
                onClick={() => onOpen(tk.id)}
                className="rounded-[4px] bg-panel-2 text-left"
                style={{
                  borderLeft: `2px solid var(--w-p${tk.priority ?? 4})`,
                  padding: "3px 5px",
                  opacity: tk.completed_at ? 0.55 : 1,
                }}
              >
                <span className="mr-1 inline-block rounded-full align-middle" style={{ width: 5, height: 5, background: projColor(tk.project_id) }} />
                <span style={{ fontSize: 10.5, color: tk.completed_at ? "var(--w-ink-3)" : "var(--w-ink)", textDecoration: tk.completed_at ? "line-through" : "none" }}>
                  {tk.name}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Časová mřížka den/týden — hodinová osa 0–24, bloky dle start času + trvání, now-line. */
function TimeGrid({
  days,
  byDay,
  todayIso,
  projColor,
  onOpen,
}: {
  days: Date[];
  byDay: Map<string, TaskRow[]>;
  todayIso: string;
  projColor: (id: string | null) => string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const H = 1440 * PPM;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  // výchozí scroll na 7:00 (prototyp gridRef, ř. 2622)
  useEffect(() => {
    const el = gridRef.current;
    if (el) el.scrollTop = Math.max(0, 7 * 60 * PPM - 8);
  }, []);

  return (
    <div className="rounded-[12px] border border-line bg-card">
      {/* hlavičky dnů + celodenní pás */}
      <div className="flex border-line border-b">
        <div style={{ width: 46, flex: "none" }} />
        {days.map((d) => {
          const iso = isoOf(d);
          const allDay = (byDay.get(iso) ?? []).filter((tk) => startMin(tk) == null);
          return (
            <div key={iso} className="min-w-0 flex-1 border-line border-l" style={{ padding: "6px 6px 4px" }}>
              <DayHead d={d} isToday={iso === todayIso} />
              <div className="mt-1 flex flex-col gap-0.5">
                {allDay.slice(0, 3).map((tk) => (
                  <button
                    key={tk.id}
                    type="button"
                    onClick={() => onOpen(tk.id)}
                    title={`${t("calendar.allDay")} · ${tk.name ?? ""}`}
                    className="truncate rounded-[4px] bg-panel-2 text-left"
                    style={{
                      borderLeft: `2px solid var(--w-p${tk.priority ?? 4})`,
                      padding: "1px 5px",
                      fontSize: 10,
                      color: tk.completed_at ? "var(--w-ink-3)" : "var(--w-ink)",
                      textDecoration: tk.completed_at ? "line-through" : "none",
                    }}
                  >
                    {tk.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* mřížka */}
      <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "62vh" }}>
        <div className="flex" style={{ height: H, position: "relative" }}>
          {/* hodinová osa */}
          <div style={{ width: 46, flex: "none", position: "relative" }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-1.5 font-mono text-ink-3"
                style={{ top: h * 60 * PPM - 6, fontSize: 9.5 }}
              >
                {pad(h)}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const iso = isoOf(d);
            const timed = (byDay.get(iso) ?? []).filter((tk) => startMin(tk) != null);
            return (
              <div key={iso} className="relative min-w-0 flex-1 border-line border-l">
                {/* hodinové linky */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-0 left-0 border-line border-t"
                    style={{ top: h * 60 * PPM, opacity: 0.6 }}
                  />
                ))}
                {/* now line */}
                {iso === todayIso && (
                  <div
                    className="pointer-events-none absolute right-0 left-0"
                    style={{ top: nowMin * PPM, height: 2, background: "var(--w-overdue)", zIndex: 4 }}
                  >
                    <div
                      className="absolute rounded-full"
                      style={{ left: -4, top: -3, width: 8, height: 8, background: "var(--w-overdue)" }}
                    />
                  </div>
                )}
                {/* bloky */}
                {timed.map((tk) => {
                  const m = startMin(tk) ?? 0;
                  const dur = tk.duration_min ?? 60;
                  return (
                    <button
                      key={tk.id}
                      type="button"
                      data-evblock={tk.id}
                      onClick={() => onOpen(tk.id)}
                      className="absolute overflow-hidden rounded-md bg-panel-2 text-left"
                      style={{
                        left: 2,
                        right: 8,
                        top: m * PPM,
                        height: Math.max(20, dur * PPM),
                        borderLeft: `3px solid var(--w-p${tk.priority ?? 4})`,
                        border: "1px solid var(--w-line)",
                        borderLeftWidth: 3,
                        borderLeftColor: `var(--w-p${tk.priority ?? 4})`,
                        padding: "2px 6px",
                        zIndex: 5,
                        opacity: tk.completed_at ? 0.55 : 1,
                        boxShadow: "var(--w-shadow-sm)",
                      }}
                    >
                      <span className="font-mono text-ink-3" style={{ fontSize: 9 }}>
                        {pad(Math.floor(m / 60))}:{pad(m % 60)}
                      </span>
                      <span className="mx-1 inline-block rounded-full align-middle" style={{ width: 5, height: 5, background: projColor(tk.project_id) }} />
                      <span className="font-display font-semibold text-ink" style={{ fontSize: 10.5 }}>
                        {tk.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayHead({ d, isToday }: { d: Date; isToday: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="font-display font-bold uppercase"
        style={{ fontSize: 10, letterSpacing: ".05em", color: isToday ? "var(--w-brass-text)" : "var(--w-ink-3)" }}
      >
        {WD[d.getDay()]?.slice(0, 2)}
      </span>
      <span className="font-mono" style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "var(--w-brass-text)" : "var(--w-ink-2)" }}>
        {d.getDate()}.
      </span>
    </div>
  );
}
