import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@watson/i18n";
import { useAddTask } from "../lib/addTask";
import { expandOccurrences, occId, recurrenceKind } from "../lib/occurrences";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask, todayISO } from "../lib/tasks";
import { CalendarMonth } from "./CalendarMonth";

type Mode = "day" | "week" | "month";
type WeekView = "cols" | "grid";
type CalBorder = "priority" | "project";

const MODE_LS = "watson.calMode";
const WEEKVIEW_LS = "watson.calWeekView";
const DENSITY_LS = "watson.calDensity";
const BORDER_LS = "watson.calBorder";
const PLANNING_LS = "watson.calPlanning";

/** Pixely/minuta (prototyp PPMOPT, ř. 1912). */
const PPMOPT = { comfortable: 0.62, spacious: 0.95 } as const;
const MAX_LANES = 3;

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso: string) => new Date(`${iso}T00:00:00`);
const addDaysISO = (iso: string, n: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const fmtMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Den, na kterém úkol začíná (termín). */
export const tIso = (t: TaskRow) => (t.due_date ?? t.start_date)?.slice(0, 10) ?? null;
/** Konec vícedenního rozsahu (days sloupec; 1 den = totéž datum). */
export const tIsoEnd = (t: TaskRow) => {
  const s = tIso(t);
  if (!s) return null;
  const days = t.days ?? 1;
  return days > 1 ? addDaysISO(s, days - 1) : s;
};
/** Úkol zasahuje den (prototyp _hit, ř. 2632). */
const hit = (t: TaskRow, iso: string) => {
  const s = tIso(t);
  const e = tIsoEnd(t);
  return !!s && !!e && s <= iso && iso <= e;
};
/** Minuty od půlnoci ze start_date (null = bez času; 00:00 bereme jako bez času). */
export const startMin = (t: TaskRow): number | null => {
  const s = t.start_date;
  if (!s || s.length < 16) return null;
  const h = +s.slice(11, 13);
  const m = +s.slice(14, 16);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h === 0 && m === 0) return null;
  return h * 60 + m;
};
const endMin = (t: TaskRow): number => {
  const s = startMin(t) ?? 0;
  return Math.min(1440, s + (t.duration_min ?? 60));
};
const isVirtual = (t: TaskRow) => t.id.includes("@");
const baseId = (t: TaskRow) => t.id.split("@")[0] ?? t.id;

/** České genitivy měsíců + dny (verbatim prototyp ř. 3109-3110). */
const MNG = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const WD = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const WD2 = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

/** Světlý tint z hex barvy úkolu (data-tc prototypu). */
const tcTint = (hex: string) => `color-mix(in srgb, ${hex} 12%, var(--w-card))`;

/** Lane layout překrývajících se bloků (port layoutDay, ř. 2248–2255). */
function layoutDay(items: { id: string; s: number; e: number }[]) {
  const sorted = [...items].sort((a, b) => a.s - b.s || a.e - b.e);
  const map = new Map<string, { lane: number; cols: number }>();
  let cluster: { id: string; s: number; e: number; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = cluster.length ? Math.max(...cluster.map((x) => x.lane)) + 1 : 1;
    for (const x of cluster) map.set(x.id, { lane: x.lane, cols });
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) flush();
    const used = new Set(cluster.filter((x) => x.e > it.s).map((x) => x.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return map;
}

/** Kruhový checkbox kalendáře (port calCheck, ř. 2762). */
function CalCheck({ t: tk, size, style }: { t: TaskRow; size: number; style?: CSSProperties }) {
  const done = Boolean(tk.completed_at);
  return (
    <button
      type="button"
      aria-label={done ? "Označit jako nehotové" : "Dokončit"}
      onClick={(e) => {
        e.stopPropagation();
        if (!isVirtual(tk)) void toggleTask(tk);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        border: `1.6px solid ${done ? "var(--w-success-ink)" : "var(--w-ink-3)"}`,
        background: done ? "var(--w-success-ink)" : "var(--w-card)",
        cursor: "pointer",
        ...style,
      }}
    >
      {done && <span style={{ color: "#fff", fontSize: size - 6, lineHeight: 1 }}>✓</span>}
    </button>
  );
}

interface DragCreate {
  iso: string;
  start: number;
  end: number;
}
interface BlockDrag {
  id: string;
  mode: "move" | "top" | "bottom";
  startY: number;
  startX: number;
  s0: number;
  e0: number;
  iso0: string;
  iso: string;
  s: number;
  e: number;
  moved: boolean;
}

/**
 * Kalendář 1:1 dle prototypu: Den / Týden (Sloupce|Mřížka) / Měsíc, projekce opakování,
 * vícedenní pruhy, pás CELÝ DEN, drag move/create/resize, lanes + „+N", now-line se štítkem,
 * gear menu (hustota / barevný okraj / Plánování panel), klik do prázdna = nový úkol.
 */
export function Calendar({ tasks }: { tasks: TaskRow[] }) {
  const { t } = useTranslation();
  const { open } = useTaskDetail();
  const { openAdd } = useAddTask();
  const projects = useProjects();
  const projColor = (id: string | null) =>
    (id ? projects.find((p) => p.id === id)?.color : null) ?? "var(--w-ink-3)";
  const projName = (id: string | null) =>
    (id ? projects.find((p) => p.id === id)?.name : null) ?? "";

  const [mode, setModeState] = useState<Mode>(() => {
    const m = localStorage.getItem(MODE_LS);
    return m === "day" || m === "month" ? m : "week";
  });
  const [weekView, setWeekViewState] = useState<WeekView>(() =>
    localStorage.getItem(WEEKVIEW_LS) === "grid" ? "grid" : "cols",
  );
  const [density, setDensity] = useState<keyof typeof PPMOPT>(() =>
    localStorage.getItem(DENSITY_LS) === "spacious" ? "spacious" : "comfortable",
  );
  const [calBorder, setCalBorder] = useState<CalBorder>(() =>
    localStorage.getItem(BORDER_LS) === "project" ? "project" : "priority",
  );
  const [planningOn, setPlanningOn] = useState(() => localStorage.getItem(PLANNING_LS) === "1");
  const [gearOpen, setGearOpen] = useState(false);
  // Kotevní datum (calCur) — drží se při přepínání režimů (prototyp ř. 2578).
  const [cur, setCur] = useState<Date>(() => new Date());
  const PPM = PPMOPT[density];

  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem(MODE_LS, m);
  };
  const setWeekView = (v: WeekView) => {
    setWeekViewState(v);
    localStorage.setItem(WEEKVIEW_LS, v);
  };

  const todayIso = todayISO();
  const gridScrollRef = useRef<HTMLDivElement>(null);

  const shiftCur = (dir: number) => {
    setCur((c) => {
      const d = new Date(c);
      if (mode === "day") d.setDate(d.getDate() + dir);
      else if (mode === "week") d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir, 1);
      return d;
    });
  };
  const goToday = () => {
    setCur(new Date());
    const el = gridScrollRef.current;
    if (el) {
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      el.scrollTop = Math.max(0, nowMin * PPM - 90);
    }
  };

  /** Dny zobrazeného období. */
  const { days, rangeLabel, monthBase } = useMemo(() => {
    if (mode === "day") {
      const label = `${cur.getDate()}. ${MNG[cur.getMonth()]} · ${WD[cur.getDay()]}`;
      return { days: [new Date(cur)], rangeLabel: label, monthBase: cur };
    }
    if (mode === "week") {
      const mon = new Date(cur);
      mon.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
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
    const base = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const label = `${["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"][base.getMonth()]} ${base.getFullYear()}`;
    return { days: [], rangeLabel: label, monthBase: base };
  }, [mode, cur]);

  /** Úkoly viditelného rozsahu + virtuální výskyty opakování (port calTasks, ř. 2633). */
  const calTasks = useMemo(() => {
    let fromI: string;
    let toI: string;
    if (mode === "month") {
      fromI = isoOf(new Date(monthBase.getFullYear(), monthBase.getMonth(), 1));
      toI = isoOf(new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0));
    } else {
      fromI = isoOf(days[0] ?? new Date());
      toI = isoOf(days[days.length - 1] ?? new Date());
    }
    const out: TaskRow[] = [...tasks];
    for (const tk of tasks) {
      const kind = recurrenceKind(tk.recurrence_rule);
      const base = tIso(tk);
      if (!kind || !base || tk.completed_at) continue;
      for (const od of expandOccurrences({ baseISO: base, kind, fromISO: fromI, toISO: toI, cap: 62 })) {
        if (od === base) continue;
        out.push({
          ...tk,
          id: occId(tk.id, od),
          due_date: od,
          start_date: tk.start_date ? `${od}T${tk.start_date.slice(11)}` : null,
          completed_at: null,
        });
      }
    }
    return out;
  }, [tasks, mode, days, monthBase]);

  // ── zkratky ←/→ / d / 1-3 (guard na otevřený detail — prototyp ř. 2228) ────
  const { openId } = useTaskDetail();
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey || openIdRef.current) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        shiftCur(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        shiftCur(1);
      } else if (e.key === "d" || e.key === "D") goToday();
      else if (e.key === "1") setMode("day");
      else if (e.key === "2") setMode("week");
      else if (e.key === "3") setMode("month");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mode]);

  // Horizontální wheel navigace (port calWheel, ř. 2671).
  const wheelAcc = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    wheelAcc.current += e.deltaX;
    let steps = 0;
    while (Math.abs(wheelAcc.current) >= 32 && steps < 8) {
      shiftCur(wheelAcc.current > 0 ? 1 : -1);
      wheelAcc.current += wheelAcc.current > 0 ? -32 : 32;
      steps++;
    }
  };

  const borderColorOf = (tk: TaskRow) =>
    calBorder === "project" ? projColor(tk.project_id) : `var(--w-p${tk.priority ?? 4})`;

  /** Zápis přesunu úkolu (drag): nový den + volitelně čas. */
  const moveTask = async (id: string, iso: string, min: number | null) => {
    if (id.includes("@")) return; // per-výskyt výjimky odloženy (RECONCILIACE §17)
    const tk = tasks.find((x) => x.id === id);
    if (!tk) return;
    await powerSync.execute("UPDATE tasks SET due_date = ?, start_date = ? WHERE id = ?", [
      iso,
      min != null ? `${iso}T${fmtMin(min)}:00` : null,
      id,
    ]);
  };

  const chevron = (dir: -1 | 1) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d={dir === -1 ? "M9 3 L5 7 L9 11" : "M5 3 L9 7 L5 11"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div className="flex min-h-0 flex-col" onWheel={onWheel}>
      {/* toolbar — lišta s border-b (prototyp ř. 491–503) */}
      <div
        className="flex flex-wrap items-center border-line border-b"
        style={{ gap: 12, padding: "10px 4px" }}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftCur(-1)}
            aria-label={t("calendar.prev")}
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-ink-2 hover:bg-panel-2"
          >
            {chevron(-1)}
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-line px-3 py-1.5 font-display font-semibold text-ink-2 text-xs hover:border-brass hover:text-brass-text"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => shiftCur(1)}
            aria-label={t("calendar.next")}
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-ink-2 hover:bg-panel-2"
          >
            {chevron(1)}
          </button>
        </div>
        <span
          className="whitespace-nowrap font-display font-extrabold text-ink capitalize"
          style={{ fontSize: 16 }}
        >
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
                ["cols", t("calendar.weekCols"), t("calendar.colsTitle")],
                ["grid", t("calendar.weekGrid"), t("calendar.gridTitle")],
              ] as const
            ).map(([k, l, title]) => (
              <button
                key={k}
                type="button"
                title={title}
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
        {mode !== "month" && (
          <div className="relative">
            <button
              type="button"
              title={t("calendar.gearTitle")}
              onClick={() => setGearOpen((o) => !o)}
              className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-line text-ink-2 hover:border-brass"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M8 1.8 V3.4 M8 12.6 V14.2 M1.8 8 H3.4 M12.6 8 H14.2 M3.6 3.6 L4.8 4.8 M11.2 11.2 L12.4 12.4 M12.4 3.6 L11.2 4.8 M4.8 11.2 L3.6 12.4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {gearOpen && (
              <div
                className="absolute border border-line bg-card"
                style={{
                  top: 40,
                  right: 0,
                  width: 212,
                  borderRadius: 12,
                  boxShadow: "var(--w-shadow)",
                  padding: 12,
                  zIndex: 20,
                  animation: "wPop .14s ease",
                }}
              >
                <GearSection label={t("calendar.density")}>
                  {(
                    [
                      ["comfortable", t("calendar.densityBalanced")],
                      ["spacious", t("calendar.densityAiry")],
                    ] as const
                  ).map(([k, l]) => (
                    <GearTab
                      key={k}
                      on={density === k}
                      onClick={() => {
                        setDensity(k);
                        localStorage.setItem(DENSITY_LS, k);
                      }}
                    >
                      {l}
                    </GearTab>
                  ))}
                </GearSection>
                <GearSection label={t("calendar.borderTitle")}>
                  {(
                    [
                      ["priority", t("calendar.borderPriority")],
                      ["project", t("calendar.borderProject")],
                    ] as const
                  ).map(([k, l]) => (
                    <GearTab
                      key={k}
                      on={calBorder === k}
                      onClick={() => {
                        setCalBorder(k);
                        localStorage.setItem(BORDER_LS, k);
                      }}
                    >
                      {l}
                    </GearTab>
                  ))}
                </GearSection>
                <GearSection label={t("calendar.sidePanel")}>
                  <GearTab
                    on={planningOn}
                    onClick={() => {
                      setPlanningOn((v) => {
                        localStorage.setItem(PLANNING_LS, v ? "0" : "1");
                        return !v;
                      });
                    }}
                  >
                    {t("calendar.planning")}
                  </GearTab>
                </GearSection>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-stretch">
        <div className="min-w-0 flex-1">
          {mode === "month" ? (
            <CalendarMonth
              tasks={calTasks}
              controlledBase={monthBase}
              borderColorOf={borderColorOf}
              onOpenDay={(d) => {
                setCur(d);
                setMode("day");
              }}
              onDropDay={(id, iso, min) => void moveTask(id, iso, min)}
            />
          ) : mode === "week" && weekView === "cols" ? (
            <WeekColumns
              days={days}
              calTasks={calTasks}
              todayIso={todayIso}
              borderColorOf={borderColorOf}
              projColor={projColor}
              onOpen={(tk) => open(baseId(tk))}
              onDrop={(id, iso) => void moveTask(id, iso, null)}
            />
          ) : (
            <TimeGrid
              days={days}
              calTasks={calTasks}
              todayIso={todayIso}
              PPM={PPM}
              narrowWeek={mode === "week"}
              borderColorOf={borderColorOf}
              projColor={projColor}
              projName={projName}
              scrollRef={gridScrollRef}
              onOpen={(tk) => open(baseId(tk))}
              onAdd={(iso, min, dur) =>
                openAdd({ date: iso, time: min != null ? fmtMin(min) : undefined, duration: dur })
              }
              onMove={moveTask}
              onOpenDay={(iso) => {
                setCur(fromISO(iso));
                setMode("day");
              }}
            />
          )}
        </div>
        {planningOn && mode !== "month" && (
          <PlanningPanel tasks={tasks} todayIso={todayIso} projColor={projColor} onOpen={open} />
        )}
      </div>
    </div>
  );
}

function GearSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        className="font-display font-bold text-ink-3 uppercase"
        style={{ fontSize: 9.5, letterSpacing: ".06em", marginBottom: 5 }}
      >
        {label}
      </div>
      <div className="flex flex-wrap" style={{ gap: 5 }}>
        {children}
      </div>
    </div>
  );
}

function GearTab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer font-display font-semibold"
      style={{
        fontSize: 11.5,
        padding: "5px 10px",
        borderRadius: 8,
        border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
        background: on ? "var(--w-brass-soft)" : "transparent",
        color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
      }}
    >
      {children}
    </button>
  );
}

/* ── Týden „Sloupce" (port buildWeekList, ř. 2599–2620) ─────────────────── */

function WeekColumns({
  days,
  calTasks,
  todayIso,
  borderColorOf,
  projColor,
  onOpen,
  onDrop,
}: {
  days: Date[];
  calTasks: TaskRow[];
  todayIso: string;
  borderColorOf: (t: TaskRow) => string;
  projColor: (id: string | null) => string;
  onOpen: (t: TaskRow) => void;
  onDrop: (id: string, iso: string) => void;
}) {
  return (
    <div>
      {/* hlavičková lišta */}
      <div className="flex border-line border-b">
        {days.map((d) => {
          const iso = isoOf(d);
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              className="min-w-0 flex-1 border-line border-l text-center"
              style={{ padding: "7px 4px", background: isToday ? "var(--w-brass-soft)" : undefined }}
            >
              <div
                className="font-display font-bold uppercase"
                style={{
                  fontSize: 10.5,
                  letterSpacing: ".03em",
                  color: isToday ? "var(--w-brass-text)" : "var(--w-ink-3)",
                }}
              >
                {WD2[d.getDay()]}
              </div>
              <div
                className="font-mono"
                style={{ fontSize: 15, color: isToday ? "var(--w-brass-text)" : "var(--w-ink-2)" }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      {/* ploché sloupce */}
      <div className="flex" style={{ minHeight: 340 }}>
        {days.map((d) => {
          const iso = isoOf(d);
          const isToday = iso === todayIso;
          const wknd = d.getDay() === 0 || d.getDay() === 6;
          const list = calTasks
            .filter((tk) => hit(tk, iso))
            .sort((a, b) => (startMin(a) ?? -1) - (startMin(b) ?? -1));
          return (
            <div
              key={iso}
              className="flex min-w-0 flex-1 flex-col border-line border-l"
              style={{
                gap: 4,
                padding: "6px 4px",
                background: isToday
                  ? "rgba(198,138,62,.05)"
                  : wknd
                    ? "rgba(120,120,140,.04)"
                    : undefined,
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                if (id) onDrop(id, iso);
              }}
            >
              {list.length === 0 && (
                <div className="text-center" style={{ fontSize: 11, opacity: 0.5, marginTop: 8 }}>
                  —
                </div>
              )}
              {list.map((tk) => {
                const sm = startMin(tk);
                const done = Boolean(tk.completed_at);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: drag chip; klávesnice řeší list view
                  <div
                    key={tk.id}
                    draggable={!isVirtual(tk)}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", tk.id)}
                    onClick={() => onOpen(tk)}
                    title={`${tk.name ?? ""} · ${sm != null ? `${fmtMin(sm)}–${fmtMin(endMin(tk))}` : "celý den"}`}
                    className="relative cursor-grab rounded-[7px] bg-card"
                    style={{
                      borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
                      padding: "5px 6px",
                      boxShadow: "var(--w-shadow-sm)",
                      opacity: done ? 0.55 : 1,
                      background: !done && tk.color ? tcTint(tk.color) : undefined,
                    }}
                  >
                    <CalCheck t={tk} size={13} style={{ position: "absolute", top: 3, right: 3 }} />
                    <div className="flex items-start" style={{ gap: 4, paddingRight: 14 }}>
                      <span
                        className="mt-1 shrink-0 rounded-full"
                        style={{ width: 6, height: 6, background: projColor(tk.project_id) }}
                      />
                      <span
                        className="font-display font-semibold"
                        style={{
                          fontSize: 11.5,
                          color: done ? "var(--w-ink-3)" : "var(--w-ink)",
                          textDecoration: done ? "line-through" : "none",
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {tk.name}
                        {tk.recurrence ? (
                          <span style={{ color: "var(--w-brass-text)" }}> ↻</span>
                        ) : null}
                      </span>
                    </div>
                    <div
                      className="font-mono"
                      style={{
                        fontSize: 9.5,
                        marginTop: 2,
                        color: sm == null ? "var(--w-brass-text)" : "var(--w-ink-3)",
                      }}
                    >
                      {sm == null ? "Celý den" : `${fmtMin(sm)}–${fmtMin(endMin(tk))}`}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Časová mřížka den/týden + pás CELÝ DEN ─────────────────────────────── */

function TimeGrid({
  days,
  calTasks,
  todayIso,
  PPM,
  narrowWeek,
  borderColorOf,
  projColor,
  projName,
  scrollRef,
  onOpen,
  onAdd,
  onMove,
  onOpenDay,
}: {
  days: Date[];
  calTasks: TaskRow[];
  todayIso: string;
  PPM: number;
  narrowWeek: boolean;
  borderColorOf: (t: TaskRow) => string;
  projColor: (id: string | null) => string;
  projName: (id: string | null) => string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOpen: (t: TaskRow) => void;
  onAdd: (iso: string, min: number | null, dur?: number) => void;
  onMove: (id: string, iso: string, min: number | null) => Promise<void>;
  onOpenDay: (iso: string) => void;
}) {
  const { t } = useTranslation();
  const H = 1440 * PPM;
  const weekGridRef = useRef<HTMLDivElement>(null);
  const allDayRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  const [create, setCreate] = useState<DragCreate | null>(null);
  const [drag, setDrag] = useState<BlockDrag | null>(null);
  const dragRef = useRef<BlockDrag | null>(null);
  const suppressClick = useRef(false);

  // now-line refresh (60 s)
  useEffect(() => {
    const id = setInterval(
      () => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()),
      60_000,
    );
    return () => clearInterval(id);
  }, []);

  // výchozí scroll na 7:00
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, 7 * 60 * PPM - 8);
  }, [PPM, scrollRef]);

  const isos = days.map(isoOf);
  const snap = (m: number) => Math.max(0, Math.min(1425, Math.round(m / 15) * 15));

  /** Sloupec dle clientX (cross-day drag, ř. 2691). */
  const colAt = (clientX: number): string | null => {
    const el = weekGridRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const idx = Math.floor(((clientX - r.left) / r.width) * isos.length);
    return isos[Math.max(0, Math.min(isos.length - 1, idx))] ?? null;
  };
  const minAt = (clientY: number): number => {
    const el = weekGridRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return snap((clientY - r.top + (scrollRef.current?.scrollTop ?? 0) - (r.top - r.top)) / PPM);
  };

  // ── blok: move/resize (port calBlockDown/_calMove/_calUp) ──
  const blockDown = (tk: TaskRow, mode2: BlockDrag["mode"]) => (e: ReactPointerEvent) => {
    if (isVirtual(tk)) return;
    e.preventDefault();
    e.stopPropagation();
    const s0 = startMin(tk) ?? 0;
    const st: BlockDrag = {
      id: tk.id,
      mode: mode2,
      startY: e.clientY,
      startX: e.clientX,
      s0,
      e0: endMin(tk),
      iso0: tIso(tk) ?? todayIso,
      iso: tIso(tk) ?? todayIso,
      s: s0,
      e: endMin(tk),
      moved: false,
    };
    dragRef.current = st;
    setDrag(st);
    const onMoveEv = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dmin = Math.round((ev.clientY - cur.startY) / PPM / 15) * 15;
      let next = { ...cur };
      if (Math.abs(ev.clientY - cur.startY) > 4 || Math.abs(ev.clientX - cur.startX) > 4)
        next.moved = true;
      if (cur.mode === "move") {
        const dur = cur.e0 - cur.s0;
        const ns = Math.max(0, Math.min(1440 - dur, cur.s0 + dmin));
        next = { ...next, s: ns, e: ns + dur, iso: colAt(ev.clientX) ?? cur.iso };
      } else if (cur.mode === "top") {
        next = { ...next, s: Math.max(0, Math.min(cur.e0 - 15, cur.s0 + dmin)) };
      } else {
        next = { ...next, e: Math.min(1440, Math.max(cur.s0 + 15, cur.e0 + dmin)) };
      }
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", onUp);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!cur) return;
      if (!cur.moved) {
        onOpen(tk);
        return;
      }
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 80);
      // puštění nad pásem CELÝ DEN → celodenní (ř. 2700)
      const band = allDayRef.current?.getBoundingClientRect();
      if (band && ev.clientY < band.bottom && ev.clientY > band.top) {
        await onMove(cur.id, cur.iso, null);
        return;
      }
      if (cur.mode === "move") {
        await onMove(cur.id, cur.iso, cur.s);
      } else {
        const s = cur.mode === "top" ? cur.s : cur.s0;
        const e2 = cur.mode === "bottom" ? cur.e : cur.e0;
        await powerSync.execute(
          "UPDATE tasks SET start_date = ?, duration_min = ? WHERE id = ?",
          [`${cur.iso0}T${fmtMin(s)}:00`, e2 - s, cur.id],
        );
      }
    };
    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", onUp);
  };

  // ── drag-create v prázdném sloupci (port _calCreateDown, ř. 2667) ──
  const createDown = (iso: string) => (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-evblock]")) return;
    const colEl = e.currentTarget as HTMLElement;
    const rect = colEl.getBoundingClientRect();
    const anchor = snap((e.clientY - rect.top) / PPM);
    let moved = false;
    const st = { iso, start: anchor, end: anchor + 30 };
    setCreate(st);
    const onMoveEv = (ev: PointerEvent) => {
      moved = true;
      const m = snap((ev.clientY - rect.top) / PPM);
      setCreate({
        iso,
        start: Math.min(anchor, m),
        end: Math.max(Math.min(anchor, m) + 15, Math.max(anchor, m)),
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", onUp);
      setCreate(null);
      if (moved) {
        const m = snap((ev.clientY - rect.top) / PPM);
        const s = Math.min(anchor, m);
        const e2 = Math.max(Math.min(anchor, m) + 15, Math.max(anchor, m));
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 80);
        onAdd(iso, s, e2 - s);
      }
    };
    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", onUp);
  };

  const gridClickAdd = (iso: string) => (e: React.MouseEvent) => {
    if (suppressClick.current) return;
    if ((e.target as HTMLElement).closest("[data-evblock]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onAdd(iso, snap((e.clientY - rect.top) / PPM));
  };

  // ── data pro pás CELÝ DEN ──
  const multiDay = calTasks.filter((tk) => {
    const s = tIso(tk);
    const e2 = tIsoEnd(tk);
    return (
      startMin(tk) == null &&
      s &&
      e2 &&
      e2 > s &&
      isos.some((iso) => iso >= s && iso <= e2)
    );
  });
  // stack řádků pruhů
  const barRows: TaskRow[][] = [];
  for (const tk of multiDay) {
    const s = tIso(tk) ?? "";
    const e2 = tIsoEnd(tk) ?? "";
    let placed = false;
    for (const row of barRows) {
      if (row.every((o) => (tIsoEnd(o) ?? "") < s || (tIso(o) ?? "") > e2)) {
        row.push(tk);
        placed = true;
        break;
      }
    }
    if (!placed) barRows.push([tk]);
  }

  return (
    <div className="rounded-[12px] border border-line bg-card">
      {/* hlavička dnů (jen týden; den view ji nemá — ř. 2846) */}
      {isos.length > 1 && (
        <div className="flex" style={{ marginLeft: 46 }}>
          {days.map((d) => {
            const iso = isoOf(d);
            const isToday = iso === todayIso;
            return (
              <div key={iso} className="min-w-0 flex-1 text-center" style={{ padding: "6px 0 4px" }}>
                <div
                  className="font-display font-bold uppercase"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: ".03em",
                    color: isToday ? "var(--w-brass-text)" : "var(--w-ink-3)",
                  }}
                >
                  {WD2[d.getDay()]}
                </div>
                <div
                  className="font-mono"
                  style={{ fontSize: 15, color: isToday ? "var(--w-brass-text)" : "var(--w-ink-2)" }}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* pás CELÝ DEN (ř. 2798–2826) */}
      <div
        ref={allDayRef}
        className="relative flex border-line border-b"
        style={{ minHeight: 30, background: "var(--w-panel-2)" }}
      >
        <div
          className="flex items-start justify-end font-mono uppercase"
          style={{ width: 46, flex: "none", fontSize: 8.5, color: "var(--w-ink-3)", padding: "6px 6px 0 0", letterSpacing: ".04em" }}
        >
          {t("calendar.allDayBand")}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* vícedenní pruhy */}
          {barRows.length > 0 && (
            <div className="relative" style={{ height: barRows.length * 23 + 2 }}>
              {barRows.map((row, ri) =>
                row.map((tk) => {
                  const s = tIso(tk) ?? "";
                  const e2 = tIsoEnd(tk) ?? "";
                  const li = Math.max(0, isos.findIndex((x) => x >= s));
                  let riIdx = isos.length - 1;
                  for (let i = isos.length - 1; i >= 0; i--) {
                    const v = isos[i];
                    if (v !== undefined && v <= e2) {
                      riIdx = i;
                      break;
                    }
                  }
                  const leftPct = (li / isos.length) * 100;
                  const wPct = ((riIdx - li + 1) / isos.length) * 100;
                  const done = Boolean(tk.completed_at);
                  const daysN = tk.days ?? 1;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: kalendářní pruh, klik = detail
                    <div
                      key={tk.id}
                      onClick={() => onOpen(tk)}
                      title={`${tk.name ?? ""} · ${daysN} ${t("today.daysUnit")}`}
                      className="absolute flex cursor-pointer items-center bg-card"
                      style={{
                        top: ri * 23 + 2,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${wPct}% - 4px)`,
                        height: 20,
                        gap: 5,
                        borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
                        borderRadius: 6,
                        padding: "0 6px",
                        boxShadow: "var(--w-shadow-sm)",
                        opacity: done ? 0.55 : 1,
                        background: !done && tk.color ? tcTint(tk.color) : undefined,
                        zIndex: 3,
                      }}
                    >
                      <CalCheck t={tk} size={12} />
                      <span
                        className="min-w-0 truncate font-display font-semibold"
                        style={{ fontSize: 11, color: done ? "var(--w-ink-3)" : "var(--w-ink)" }}
                      >
                        {tk.name}
                      </span>
                      <span className="ml-auto shrink-0 font-mono" style={{ fontSize: 9, color: "var(--w-ink-3)" }}>
                        {daysN} {t("today.daysUnit")}
                      </span>
                    </div>
                  );
                }),
              )}
            </div>
          )}
          {/* jednodenní celodenní chipy per sloupec */}
          <div className="flex">
            {isos.map((iso) => {
              const list = calTasks.filter(
                (tk) => startMin(tk) == null && (tk.days ?? 1) <= 1 && tIso(tk) === iso,
              );
              const isToday = iso === todayIso;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: klik do prázdna = nový úkol
                <div
                  key={iso}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-adchip]")) return;
                    onAdd(iso, null);
                  }}
                  className="flex min-w-0 flex-1 flex-col border-line border-l"
                  style={{
                    gap: 3,
                    padding: 4,
                    background: isToday ? "var(--w-brass-soft)" : undefined,
                    minHeight: 26,
                    cursor: "pointer",
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (id && !id.includes("@")) void onMove(id, iso, null);
                  }}
                >
                  {list.map((tk) => {
                    const done = Boolean(tk.completed_at);
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: chip, klik = detail
                      <div
                        key={tk.id}
                        data-adchip
                        draggable={!isVirtual(tk)}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", tk.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(tk);
                        }}
                        className="flex cursor-grab items-center rounded-[6px] border border-line bg-card"
                        style={{
                          gap: 5,
                          padding: "3px 7px 3px 8px",
                          borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
                          opacity: done ? 0.55 : 1,
                          background: !done && tk.color ? tcTint(tk.color) : undefined,
                        }}
                      >
                        <CalCheck t={tk} size={13} />
                        <span
                          className="shrink-0 rounded-full"
                          style={{ width: 6, height: 6, background: projColor(tk.project_id) }}
                        />
                        <span
                          className="font-display font-semibold"
                          style={{
                            fontSize: 11.5,
                            color: done ? "var(--w-ink-3)" : "var(--w-ink)",
                            textDecoration: done ? "line-through" : "none",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {tk.name}
                          {tk.recurrence ? " ↻" : ""}
                        </span>
                      </div>
                    );
                  })}
                  {isos.length === 1 && list.length === 0 && (
                    <span className="font-body" style={{ fontSize: 11, color: "var(--w-ink-3)", padding: "2px 4px" }}>
                      {t("calendar.noAllDay")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* mřížka */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
        <div ref={weekGridRef} className="flex" style={{ height: H + 40, position: "relative", paddingBottom: 40 }}>
          {/* hodinová osa (0–24 vč.) */}
          <div style={{ width: 46, flex: "none", position: "relative" }}>
            {Array.from({ length: 25 }, (_, h) => (
              <span
                key={h}
                className="absolute right-1.5 font-mono text-ink-3"
                style={{ top: h * 60 * PPM - 6, fontSize: 10 }}
              >
                {pad(h)}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const iso = isoOf(d);
            const isToday = iso === todayIso;
            const wknd = d.getDay() === 0 || d.getDay() === 6;
            const timed = calTasks.filter((tk) => startMin(tk) != null && hit(tk, iso));
            const lanes = layoutDay(
              timed.map((tk) => ({ id: tk.id, s: startMin(tk) ?? 0, e: endMin(tk) })),
            );
            const hiddenByLane = timed.filter((tk) => (lanes.get(tk.id)?.lane ?? 0) >= MAX_LANES);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: klik do prázdna = nový úkol s časem
              <div
                key={iso}
                onClick={gridClickAdd(iso)}
                onPointerDown={createDown(iso)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (!id || id.includes("@")) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  void onMove(id, iso, snap((e.clientY - rect.top) / PPM));
                }}
                className="relative min-w-0 flex-1 border-line border-l"
                style={{
                  background: isToday
                    ? "var(--w-brass-soft)"
                    : wknd
                      ? "rgba(120,120,140,.045)"
                      : undefined,
                }}
              >
                {/* hodinové linky */}
                {Array.from({ length: 25 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-0 left-0 border-line border-t"
                    style={{ top: h * 60 * PPM }}
                  />
                ))}
                {/* now line + štítek (ř. 2624) */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute right-0 left-0"
                    style={{ top: nowMin * PPM, height: 2, background: "var(--w-overdue)", zIndex: 6 }}
                  >
                    <div
                      className="absolute rounded-full"
                      style={{ left: -4, top: -3, width: 8, height: 8, background: "var(--w-overdue)" }}
                    />
                    <span
                      className="absolute font-mono font-bold"
                      style={{
                        left: 4,
                        top: -15,
                        fontSize: 9,
                        color: "#fff",
                        background: "var(--w-overdue)",
                        borderRadius: 4,
                        padding: "1px 4px",
                      }}
                    >
                      {fmtMin(nowMin)}
                    </span>
                  </div>
                )}
                {/* drag-create ghost (ř. 2670) */}
                {create && create.iso === iso && (
                  <div
                    className="pointer-events-none absolute right-1 left-1"
                    style={{
                      top: create.start * PPM,
                      height: (create.end - create.start) * PPM,
                      background: "var(--w-brass-soft)",
                      border: "1.5px dashed var(--w-brass)",
                      borderRadius: 6,
                      zIndex: 8,
                    }}
                  >
                    <span
                      className="font-mono font-bold"
                      style={{ fontSize: 9.5, color: "var(--w-brass-text)", padding: "2px 5px", display: "inline-block" }}
                    >
                      {fmtMin(create.start)}–{fmtMin(create.end)}
                    </span>
                  </div>
                )}
                {/* bloky */}
                {timed.map((tk) => {
                  const lay = lanes.get(tk.id) ?? { lane: 0, cols: 1 };
                  if (lay.lane >= MAX_LANES) return null;
                  const isDragging = drag?.id === tk.id;
                  const s = isDragging && drag ? drag.s : (startMin(tk) ?? 0);
                  const e2 = isDragging && drag ? drag.e : endMin(tk);
                  const showInCol = isDragging && drag ? drag.iso === iso : true;
                  if (isDragging && drag && drag.iso !== iso && drag.iso0 === iso && drag.mode === "move") {
                    // blok se táhne do jiného sloupce — v původním nezobrazovat
                  }
                  if (!showInCol && drag?.mode === "move") return null;
                  const cols = Math.min(lay.cols, MAX_LANES);
                  const wPct = lay.cols > MAX_LANES ? 100 / 3.8 : 100 / cols;
                  const leftPct = lay.lane * (lay.cols > MAX_LANES ? 100 / 3.8 : 100 / cols);
                  const hPx = Math.max(22, (e2 - s) * PPM);
                  const narrow = narrowWeek && (wPct < 46 || lay.cols > 1);
                  const done = Boolean(tk.completed_at);
                  const nameLines = Math.max(1, Math.floor((hPx - 14) / 13));
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer drag blok; klik = detail
                    <div
                      key={tk.id}
                      data-evblock={tk.id}
                      onPointerDown={blockDown(tk, "move")}
                      title={`${tk.name ?? ""} · ${fmtMin(s)}–${fmtMin(e2)} · ${projName(tk.project_id)}`}
                      className="absolute overflow-hidden rounded-md border border-line bg-card"
                      style={{
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${wPct}% - 6px)`,
                        top: s * PPM,
                        height: hPx,
                        borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
                        padding: "3px 5px",
                        zIndex: isDragging ? 9 : 5,
                        opacity: done ? 0.58 : 1,
                        boxShadow: "var(--w-shadow-sm)",
                        cursor: isDragging ? "grabbing" : "grab",
                        background: !done && tk.color ? tcTint(tk.color) : undefined,
                        touchAction: "none",
                      }}
                    >
                      {/* resize úchyty */}
                      <div
                        onPointerDown={blockDown(tk, "top")}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, cursor: "ns-resize", zIndex: 4 }}
                      />
                      <div
                        onPointerDown={blockDown(tk, "bottom")}
                        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 5, cursor: "ns-resize", zIndex: 4 }}
                      />
                      {isDragging && drag?.moved && (
                        <span
                          className="absolute font-mono"
                          style={{
                            top: 2,
                            right: 2,
                            fontSize: 9.5,
                            color: "#fff",
                            background: "var(--w-navy)",
                            borderRadius: 4,
                            padding: "1px 4px",
                            zIndex: 10,
                          }}
                        >
                          {fmtMin(s)}
                        </span>
                      )}
                      <CalCheck
                        t={tk}
                        size={narrow ? 12 : 13}
                        style={narrow ? { position: "absolute", top: 3, right: 3 } : { float: "right", marginLeft: 3 }}
                      />
                      <span
                        className="mt-0.5 mr-1 inline-block shrink-0 rounded-full align-middle"
                        style={{ width: 6, height: 6, background: projColor(tk.project_id) }}
                      />
                      <span
                        className="font-display font-semibold"
                        style={{
                          fontSize: narrow ? 10.5 : 11,
                          color: done ? "var(--w-ink-3)" : "var(--w-ink)",
                          textDecoration: done ? "line-through" : "none",
                          display: "-webkit-box",
                          WebkitLineClamp: nameLines,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {tk.name}
                        {tk.recurrence ? " ↻" : ""}
                      </span>
                      {hPx >= 58 && !narrow && (
                        <div className="mt-0.5 flex items-center" style={{ gap: 4 }}>
                          <span
                            className="min-w-0 truncate font-body"
                            style={{ fontSize: 9.5, color: "var(--w-ink-3)" }}
                          >
                            {projName(tk.project_id)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* +N skrytých (ř. 2755) */}
                {hiddenByLane.length > 0 && (
                  <button
                    type="button"
                    title={`${hiddenByLane.length} ${t("calendar.moreInTime")}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDay(iso);
                    }}
                    className="absolute font-display font-bold"
                    style={{
                      right: 2,
                      top: (startMin(hiddenByLane[0] ?? ({} as TaskRow)) ?? 0) * PPM,
                      width: `calc(${100 / 3.8}% - 4px)`,
                      height: 30,
                      border: "1px dashed var(--w-ink-3)",
                      background: "var(--w-panel-2)",
                      borderRadius: 6,
                      fontSize: 11,
                      zIndex: 5,
                    }}
                  >
                    +{hiddenByLane.length}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Postranní panel Plánování (ř. 533–554) ─────────────────────────────── */

function PlanningPanel({
  tasks,
  todayIso,
  projColor,
  onOpen,
}: {
  tasks: TaskRow[];
  todayIso: string;
  projColor: (id: string | null) => string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const overdue = tasks.filter(
    (tk) => !tk.completed_at && tIso(tk) && (tIso(tk) ?? "") < todayIso,
  );
  const noTime = tasks.filter(
    (tk) => !tk.completed_at && tIso(tk) === todayIso && startMin(tk) == null,
  );
  const reschedule = async () => {
    for (const tk of overdue) {
      await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [todayIso, tk.id]);
    }
  };
  const group = (label: string, list: TaskRow[], resch?: boolean) =>
    list.length > 0 && (
      <div style={{ marginBottom: 14 }}>
        <div className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
          <span className="font-display font-bold text-ink" style={{ fontSize: 12 }}>
            {label}
          </span>
          <span className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
            {list.length}
          </span>
          {resch && (
            <button
              type="button"
              onClick={() => void reschedule()}
              className="ml-auto font-display font-semibold text-brass-text hover:underline"
              style={{ fontSize: 11 }}
            >
              {t("today.reschedule")}
            </button>
          )}
        </div>
        <div className="flex flex-col" style={{ gap: 5 }}>
          {list.map((tk) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: drag karta do mřížky; klik = detail
            <div
              key={tk.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", tk.id)}
              onClick={() => onOpen(tk.id)}
              className="flex cursor-grab items-center rounded-[8px] border border-line bg-card hover:border-brass"
              style={{ gap: 7, padding: "6px 8px" }}
            >
              <span
                className="shrink-0 rounded-full"
                style={{ width: 7, height: 7, background: projColor(tk.project_id) }}
              />
              <span className="min-w-0 flex-1 truncate font-display font-semibold text-ink" style={{ fontSize: 12.5 }}>
                {tk.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div
      className="border-line border-l"
      style={{ width: 272, flex: "none", padding: 16, overflowY: "auto" }}
    >
      <div className="font-display font-extrabold text-ink" style={{ fontSize: 14 }}>
        {t("calendar.planning")}
      </div>
      <div className="font-body text-ink-3" style={{ fontSize: 11.5, margin: "4px 0 14px", lineHeight: 1.5 }}>
        {t("calendar.planningHint")}
      </div>
      {group(t("today.overdue"), overdue, true)}
      {group(t("calendar.noDate"), noTime)}
    </div>
  );
}
