import { useQuery as usePsQuery } from "@powersync/react";
import i18n, { useTranslation } from "@watson/i18n";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useAddTask } from "../lib/addTask";
import { useSession } from "../lib/auth-client";
import {
	materializeRecurringTasks,
	type OccurrenceOverrideRow,
} from "../lib/occurrenceProjection";
import { parseOccId } from "../lib/occurrences";
import type {
	AvailabilityBlockRow,
	TaskRecurrencePrefixRow,
	TaskRow,
} from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import type { RecurrencePreviewInput } from "../lib/recurrenceCommands";
import { useRowMeta } from "../lib/rowMeta";
import { storageGet, storageSet } from "../lib/storage";
import {
	createTaskAvailabilityOverrides,
	preflightTaskAvailability,
	type TaskAvailabilityConflict,
} from "../lib/taskAvailability";
import { useTaskDetail } from "../lib/taskDetail";
import { rowDue, startMinOf, toggleTask } from "../lib/tasks";
import {
	dateInTimeZone,
	deviceTimeZone,
	minutesInTimeZone,
	wallTimeFromInstant,
	zonedDateTimeToIso,
} from "../lib/timeZone";
import { showToast } from "../lib/toast";
import { pushUndo } from "../lib/undo";
import { useIsMobile } from "../lib/useIsMobile";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import { useUserColors } from "../lib/userColors";
import { useWorkspace } from "../lib/workspace";
import { CalendarMonth } from "./CalendarMonth";
import { RecurrenceMoveDialog } from "./RecurrenceMoveDialog";

type Mode = "day" | "week" | "month";
type WeekView = "cols" | "grid";
type CalBorder = "priority" | "project";

const MODE_LS = "watson.calMode";
const WEEKVIEW_LS = "watson.calWeekView";
const DENSITY_LS = "watson.calDensity";
const BORDER_LS = "watson.calBorder";
const PLANNING_LS = "watson.calPlanning";
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

/** Pixely/minuta (prototyp PPMOPT, ř. 1912). */
const PPMOPT = { comfortable: 0.62, spacious: 0.95 } as const;
const MAX_LANES = 3;
// Pás CELÝ DEN: JEDEN per-den rozpočet. Vícedenní celodenní = defaultně tenká překryvná
// linka protínající sloupce (nezabírá kartu). V dni, kde je rozpočet plný, se linka na tom
// segmentu nekreslí a událost spadne do „+N" toho dne (odtud otevřitelná). Přeplněné chipy
// i přetečené vícedenní se tak kapují na „+N" — pás nikdy nescrolluje.
const ALLDAY_PER_COL = 3; // rozpočet karet CELÝ DEN na sloupec (jednodenní chipy), pak „+N"
const MAX_LINE_ROWS = 3; // max řádků tenkých vícedenních linek (nad rámec → „+N")
const LINE_ROW_H = 9; // výška řádku linky (klikací obálka)
const LINE_H = 5; // tloušťka samotné linky

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso: string) => new Date(`${iso}T00:00:00`);
export const addDaysISO = (iso: string, n: number) => {
	const d = fromISO(iso);
	d.setDate(d.getDate() + n);
	return isoOf(d);
};

export type CalendarAvailabilityBlock = AvailabilityBlockRow;

/** Část absolutního availability bloku, která patří do jednoho lokálního kalendářního dne. */
export function availabilitySegment(
	block: CalendarAvailabilityBlock,
	iso: string,
	timeZone: string,
): { start: number; end: number } | null {
	if (!block.starts_at || !block.ends_at || block.cancelled_at) return null;
	const dayStart = zonedDateTimeToIso(iso, "00:00", timeZone);
	const nextStart = zonedDateTimeToIso(addDaysISO(iso, 1), "00:00", timeZone);
	if (!dayStart || !nextStart) return null;
	const dayStartMs = Date.parse(dayStart);
	const nextStartMs = Date.parse(nextStart);
	const startMs = Math.max(Date.parse(block.starts_at), dayStartMs);
	const endMs = Math.min(Date.parse(block.ends_at), nextStartMs);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
	const start = startMs === dayStartMs ? 0 : minutesInTimeZone(new Date(startMs).toISOString(), timeZone);
	const end = endMs === nextStartMs ? 1440 : minutesInTimeZone(new Date(endMs).toISOString(), timeZone);
	return start === null || end === null || end <= start ? null : { start, end };
}
const fmtMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Den, na kterém úkol začíná (termín). */
export const tIso = (t: TaskRow) =>
	t.due_date ??
	(t.start_date && t.start_timezone
		? dateInTimeZone(t.start_timezone, new Date(t.start_date))
		: t.start_date?.slice(0, 10)) ??
	null;
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
/** Minuty od půlnoci ze start_date — sdílený parser (lib/tasks.startMinOf, P1-06 jeden zdroj). */
export const startMin = (t: TaskRow): number | null => startMinOf(t);
const endMin = (t: TaskRow): number => {
	const s = startMin(t) ?? 0;
	return Math.min(1440, s + (t.duration_min ?? 60));
};
/** Absolutní konec časovaného úkolu v minutách od půlnoci DNE ZAČÁTKU (může přesáhnout 1440). */
const endAbs = (t: TaskRow): number => (startMin(t) ?? 0) + (t.duration_min ?? 60);
/** Poslední den-offset, na který úkol zasahuje (0 = jen den začátku). */
const lastOffsetOf = (t: TaskRow): number => Math.floor((endAbs(t) - 1) / 1440);
/** Rozdíl dnů mezi dvěma ISO dny (b - a), celé dny. */
const dayOffsetISO = (a: string, b: string): number =>
	Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000);
const isVirtual = (t: TaskRow) => t.id.includes("@");

/** Krátký název dne dle jazyka (Po/Út… / Mon/Tue…). */
const wdShort = (d: Date) => new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(d);

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
	const { data: session } = useSession();
	return (
		<button
			type="button"
			aria-label={i18n.t(done ? "detail.ariaMarkUndone" : "detail.ariaComplete")}
			onClick={(e) => {
				e.stopPropagation();
				// actorId (R2): u shared_all přepni jen účast aktéra; virtuální výskyt → override.
				void toggleTask(tk, session?.user?.id);
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
	/** Cílový den při tažení přes dny (vícedenní create). */
	isoEnd?: string;
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
	/** Cílový den konce při resize „bottom" přes sloupce (den, kde je kurzor). */
	endIso: string;
	s: number;
	e: number;
	moved: boolean;
}

interface CalendarMovePlan {
	taskId: string;
	dueDate: string;
	startsAt: string | null;
	startTimezone: string | null;
	durationMin: number | null;
	previousDueDate: string | null;
	previousStartsAt: string | null;
	previousStartTimezone: string | null;
}

interface PendingEmergencyMove {
	move: CalendarMovePlan;
	conflicts: TaskAvailabilityConflict[];
}

interface PendingRecurrenceMove {
	taskId: string;
	input: RecurrencePreviewInput;
}

/**
 * Kalendář 1:1 dle prototypu: Den / Týden (Sloupce|Mřížka) / Měsíc, projekce opakování,
 * vícedenní pruhy, pás CELÝ DEN, drag move/create/resize, lanes + „+N", now-line se štítkem,
 * gear menu (hustota / barevný okraj / Plánování panel), klik do prázdna = nový úkol.
 */
export function Calendar({ tasks }: { tasks: TaskRow[] }) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const userTimeZone = session?.user?.timezone ?? deviceTimeZone();
	const { activeWs } = useWorkspace();
	const { data: availabilityRows } = usePsQuery<CalendarAvailabilityBlock>(
		"SELECT * FROM availability_blocks WHERE workspace_id = ? AND user_id = ? AND cancelled_at IS NULL",
		[activeWs ?? "", session?.user?.id ?? ""],
	);
	const availability = availabilityRows ?? [];
	const { open } = useTaskDetail();
	const { openAdd } = useAddTask();
	const projects = useProjects();
	const projColor = (id: string | null) =>
		(id ? projects.find((p) => p.id === id)?.color : null) ?? "var(--w-ink-3)";
	const projName = (id: string | null) =>
		(id ? projects.find((p) => p.id === id)?.name : null) ?? "";

	const [mode, setModeState] = useState<Mode>(() => {
		const m = storageGet(MODE_LS);
		return m === "day" || m === "month" ? m : "week";
	});
	const [weekView, setWeekViewState] = useState<WeekView>(() =>
		storageGet(WEEKVIEW_LS) === "grid" ? "grid" : "cols",
	);
	const [density, setDensity] = useState<keyof typeof PPMOPT>(() =>
		storageGet(DENSITY_LS) === "spacious" ? "spacious" : "comfortable",
	);
	const [calBorder, setCalBorder] = useState<CalBorder>(() =>
		storageGet(BORDER_LS) === "project" ? "project" : "priority",
	);
	const [planningOn, setPlanningOn] = useState(() => storageGet(PLANNING_LS) === "1");
	const [gearOpen, setGearOpen] = useState(false);
	const [pendingEmergencyMove, setPendingEmergencyMove] = useState<PendingEmergencyMove | null>(null);
	const [pendingRecurrenceMove, setPendingRecurrenceMove] =
		useState<PendingRecurrenceMove | null>(null);
	const [emergencyReason, setEmergencyReason] = useState("");
	const [emergencyBusy, setEmergencyBusy] = useState(false);
	const emergencyBusyRef = useRef(false);
	const emergencyInputRef = useRef<HTMLTextAreaElement>(null);
	const emergencyDialogRef = useOverlayLayer<HTMLDivElement>(Boolean(pendingEmergencyMove), () => {
		if (!emergencyBusyRef.current) setPendingEmergencyMove(null);
	});
	const isMobile = useIsMobile();
	useEffect(() => {
		if (!pendingEmergencyMove) return;
		setEmergencyReason("");
		setTimeout(() => emergencyInputRef.current?.focus(), 0);
	}, [pendingEmergencyMove]);
	// Kotevní datum (calCur) — týden je „rolující" od kotvy bez snapu (prototyp weekDates, ř. 2658);
	// při startu v týdnu kotvíme na pondělí (ekvivalent calToday, ř. 2661).
	const [cur, setCur] = useState<Date>(() => {
		const d = new Date(`${dateInTimeZone(userTimeZone)}T12:00:00`);
		const m = storageGet(MODE_LS);
		if (m !== "day" && m !== "month") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
		return d;
	});
	const PPM = PPMOPT[density];

	const setMode = useCallback((m: Mode) => {
		setModeState(m);
		storageSet(MODE_LS, m);
	}, []);
	const setWeekView = (v: WeekView) => {
		setWeekViewState(v);
		storageSet(WEEKVIEW_LS, v);
	};

	const todayIso = dateInTimeZone(userTimeZone);
	const gridScrollRef = useRef<HTMLDivElement>(null);

	// Full-bleed výška (prototyp ř. 490: flex sloupec height:100%) — obrazovky (Ukoly/Nadchazejici)
	// rodiči pevnou výšku nedávají, proto ji odvozujeme od horní hrany po spodek okna (28px = py-7).
	const rootRef = useRef<HTMLDivElement>(null);
	const [rootH, setRootH] = useState<number>();
	useEffect(() => {
		const upd = () => {
			const el = rootRef.current;
			if (el) setRootH(Math.max(420, window.innerHeight - el.getBoundingClientRect().top - 28));
		};
		upd();
		window.addEventListener("resize", upd);
		return () => window.removeEventListener("resize", upd);
	}, []);

	const shiftCur = useCallback((dir: number) => {
		setCur((c) => {
			const d = new Date(c);
			if (mode === "day") d.setDate(d.getDate() + dir);
			else if (mode === "week") d.setDate(d.getDate() + dir * 7);
			else d.setMonth(d.getMonth() + dir, 1);
			return d;
		});
	}, [mode]);
	const goToday = useCallback(() => {
		const d = new Date(`${dateInTimeZone(userTimeZone)}T12:00:00`);
		// Dnes v týdnu → snap kotvy na pondělí (prototyp calToday, ř. 2661).
		if (mode === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
		setCur(d);
		const el = gridScrollRef.current;
		if (el) {
			const nowMin = minutesInTimeZone(new Date().toISOString(), userTimeZone) ?? 0;
			el.scrollTop = Math.max(0, nowMin * PPM - 90);
		}
	}, [mode, PPM, userTimeZone]);
	const calendarLanguage = i18n.language;

	/** Dny zobrazeného období. Popisky přes Intl(i18n.language) — CS genitivy měsíců i EN. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: i18n.language je mutabilní hodnota singletonu a změna jazyka musí invalidovat Intl formátovače
	const { days, rangeLabel, monthBase } = useMemo(() => {
		const lang = calendarLanguage;
		const dayMonth = (d: Date) =>
			new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(d);
		const monthYear = (d: Date) =>
			new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(d);
		const weekdayLong = (d: Date) => new Intl.DateTimeFormat(lang, { weekday: "long" }).format(d);
		if (mode === "day") {
			const label = `${dayMonth(cur)} · ${weekdayLong(cur)}`;
			return { days: [new Date(cur)], rangeLabel: label, monthBase: cur };
		}
		if (mode === "week") {
			// Rolující týden od kotvy — bez snapu na pondělí (prototyp weekDates, ř. 2658).
			const first = new Date(cur);
			const list = Array.from({ length: 7 }, (_, i) => {
				const d = new Date(first);
				d.setDate(first.getDate() + i);
				return d;
			});
			const last = list[6] ?? first;
			const label =
				first.getMonth() === last.getMonth()
					? `${first.getDate()}.–${last.getDate()}. ${monthYear(last)}`
					: `${dayMonth(first)} – ${dayMonth(last)} ${last.getFullYear()}`;
			return { days: list, rangeLabel: label, monthBase: first };
		}
		const base = new Date(cur.getFullYear(), cur.getMonth(), 1);
		return { days: [], rangeLabel: monthYear(base), monthBase: base };
	}, [mode, cur, calendarLanguage]);

	// Per-výskyt výjimky (R4): skipped výskyty se nekreslí, done se propíše.
	const { data: ovr } = usePsQuery<OccurrenceOverrideRow>(
		`SELECT id, task_id, occ_date, done, skipped, override_due_date,
		        override_start_date, override_start_timezone, override_duration_min, updated_at
		 FROM task_occurrence_overrides`,
	);
	const { data: recurrencePrefixes } = usePsQuery<TaskRecurrencePrefixRow>(
		`SELECT id, task_id, project_id, anchor_date, end_date, recurrence_rule,
		        start_date, start_timezone, duration_min, created_by, version, created_at, updated_at
		 FROM task_recurrence_prefixes`,
	);

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
		return materializeRecurringTasks(tasks, ovr ?? [], fromI, toI, 62, recurrencePrefixes ?? []);
	}, [tasks, mode, days, monthBase, ovr, recurrencePrefixes]);

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
	}, [shiftCur, goToday, setMode]);

	// Horizontální wheel navigace (port calWheel, ř. 2671) — mimo měsíc roluje po 1 dni (shiftCur(dir)).
	const wheelAcc = useRef(0);
	const onWheel = (e: React.WheelEvent) => {
		if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
		wheelAcc.current += e.deltaX;
		let steps = 0;
		while (Math.abs(wheelAcc.current) >= 32 && steps < 8) {
			const dir = wheelAcc.current > 0 ? 1 : -1;
			if (mode === "month") shiftCur(dir);
			else
				setCur((c) => {
					const d = new Date(c);
					d.setDate(d.getDate() + dir);
					return d;
				});
			wheelAcc.current -= dir * 32;
			steps++;
		}
	};

	const borderColorOf = (tk: TaskRow) =>
		calBorder === "project" ? projColor(tk.project_id) : `var(--w-p${tk.priority ?? 4})`;

	/**
	 * Zápis přesunu úkolu (drag): nový den + volitelně čas. min=null zachová původní čas
	 * (prototyp monthDropTo, ř. 2710 — mění jen date); allDay=true čas smaže (pás CELÝ DEN, ř. 2700).
	 */
	const commitMove = async (move: CalendarMovePlan) => {
		const write = async (d: string | null, s: string | null, z: string | null) => {
			await powerSync.execute(
				"UPDATE tasks SET due_date = ?, start_date = ?, start_timezone = ? WHERE id = ?",
				[d, s, z, move.taskId],
			);
		};
		await write(move.dueDate, move.startsAt, move.startTimezone);
		pushUndo({
			undo: () =>
				write(move.previousDueDate, move.previousStartsAt, move.previousStartTimezone),
			redo: () => write(move.dueDate, move.startsAt, move.startTimezone),
		});
	};

	const moveTask = async (id: string, iso: string, min: number | null, allDay = false) => {
		const occurrence = parseOccId(id);
		const taskId = occurrence?.taskId ?? id;
		const baseTask = tasks.find((task) => task.id === taskId);
		const tk = calTasks.find((task) => task.id === id) ?? baseTask;
		if (!tk || !baseTask) return;
		let start: string | null = null;
		const zone = tk.start_timezone ?? userTimeZone;
		let requestedTime: string | null = null;
		if (!allDay) {
			if (min != null) requestedTime = fmtMin(min);
			else if (startMin(tk) != null && tk.start_date) {
				const wallTime = tk.start_timezone
					? wallTimeFromInstant(tk.start_date, tk.start_timezone)
					: tk.start_date.slice(11);
				requestedTime = wallTime?.slice(0, 5) ?? null;
			}
			start = requestedTime ? zonedDateTimeToIso(iso, requestedTime, zone) : null;
		}
		if (baseTask.recurrence_rule) {
			const occurrenceDate = occurrence?.iso ?? tIso(baseTask);
			if (!occurrenceDate) {
				showToast(t("calendar.recurringDragUnsupported"));
				return;
			}
			setPendingRecurrenceMove({
				taskId,
				input: {
					occurrenceDate,
					scope: "this_occurrence",
					schedule: {
						date: iso,
						time: allDay ? null : requestedTime,
						timeZone: allDay || !requestedTime ? null : zone,
						durationMin: allDay || !requestedTime ? null : tk.duration_min,
					},
					dstPolicy: "next_valid",
				},
			});
			return;
		}
		if (!allDay) {
			if ((min != null || tk.start_date) && !start) {
				showToast(t("addmodal.invalidLocalTime"));
				return;
			}
		}
		const nextZone = start ? zone : null;
		const move: CalendarMovePlan = {
			taskId,
			dueDate: iso,
			startsAt: start,
			startTimezone: nextZone,
			durationMin: tk.duration_min,
			previousDueDate: tk.due_date,
			previousStartsAt: tk.start_date,
			previousStartTimezone: tk.start_timezone,
		};
		if (start) {
			try {
				const availability = await preflightTaskAvailability(id, {
					startsAt: start,
					durationMin: tk.duration_min,
				});
				const strictNonFocus = availability.conflicts.filter(
					(conflict) => conflict.blocking && conflict.kind !== "focus",
				);
				if (strictNonFocus.length > 0) {
					showToast(
						t("calendar.availabilityStrictBlocked", {
							names: [...new Set(strictNonFocus.map((conflict) => conflict.assigneeName))].join(", "),
						}),
					);
					return;
				}
				const focusConflicts = availability.conflicts.filter(
					(conflict) => conflict.blocking && conflict.kind === "focus",
				);
				if (focusConflicts.length > 0) {
					setPendingEmergencyMove({ move, conflicts: focusConflicts });
					return;
				}
				const warnings = availability.conflicts.filter((conflict) => !conflict.blocking);
				if (warnings.length > 0) {
					showToast(
						t("calendar.availabilityWarning", {
							names: [...new Set(warnings.map((conflict) => conflict.assigneeName))].join(", "),
						}),
					);
				}
			} catch {
				// Offline-first: záměr neztratíme. Serverový DB guard při synchronizaci stále
				// odmítne nepovolený konflikt a uloží ho do Centra problémů.
				showToast(t("calendar.availabilityOffline"));
			}
		}
		await commitMove(move);
	};

	const confirmEmergencyMove = async () => {
		const pending = pendingEmergencyMove;
		const reason = emergencyReason.trim();
		if (!pending || reason.length < 8 || emergencyBusy || !pending.move.startsAt) return;
		emergencyBusyRef.current = true;
		setEmergencyBusy(true);
		try {
			await createTaskAvailabilityOverrides(pending.move.taskId, {
				overrides: pending.conflicts.map((conflict) => ({
					id: crypto.randomUUID(),
					blockId: conflict.blockId,
					assigneeId: conflict.assigneeId,
				})),
				reason,
				startsAt: pending.move.startsAt,
				durationMin: pending.move.durationMin,
			});
			await commitMove(pending.move);
			setPendingEmergencyMove(null);
			showToast(t("calendar.emergencySaved"));
		} catch {
			showToast(t("calendar.emergencyFailed"));
		} finally {
			emergencyBusyRef.current = false;
			setEmergencyBusy(false);
		}
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
		<div
			ref={rootRef}
			className="flex min-h-0 flex-col"
			style={{ height: rootH }}
			onWheel={onWheel}
		>
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
				<div
					className="ml-auto flex rounded-[9px] border border-line bg-panel-2"
					style={{ padding: 3 }}
				>
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
					<div
						className="inline-flex rounded-lg border border-line bg-panel-2"
						style={{ padding: 3 }}
					>
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
				{mode !== "month" && !isMobile && (
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
								{/* Hustota + Okraj jen v mřížkových režimech (prototyp showGridOpts, ř. 3241) */}
								{!(mode === "week" && weekView === "cols") && (
									<>
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
												storageSet(DENSITY_LS, k);
													}}
												>
													{l}
												</GearTab>
											))}
										</GearSection>
										<GearSection label={t("calendar.borderTitle")}>
											{/* cycle-chip s brass proužkem (prototyp cycleBorder, ř. 516) */}
											<GearChip
												on={calBorder === "project"}
												onClick={() => {
													const next: CalBorder = calBorder === "priority" ? "project" : "priority";
													setCalBorder(next);
											storageSet(BORDER_LS, next);
												}}
											>
												<span
													className="shrink-0 rounded-[2px]"
													style={{
														width: 3,
														height: 14,
														background: "var(--w-brass)",
													}}
												/>
												<span style={{ textTransform: "lowercase" }}>
													{calBorder === "project"
														? t("calendar.borderProject")
														: t("calendar.borderPriority")}
												</span>
											</GearChip>
										</GearSection>
									</>
								)}
								<GearSection label={t("calendar.sidePanel")}>
									<GearChip
										on={planningOn}
										onClick={() => {
											setPlanningOn((v) => {
										storageSet(PLANNING_LS, v ? "0" : "1");
												return !v;
											});
										}}
									>
										{/* ikona panelu (prototyp ř. 522) */}
										<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
											<rect
												x="2"
												y="3"
												width="12"
												height="10"
												rx="2"
												stroke="currentColor"
												strokeWidth="1.3"
											/>
											<line
												x1="10.5"
												y1="3"
												x2="10.5"
												y2="13"
												stroke="currentColor"
												strokeWidth="1.3"
											/>
										</svg>
										{t("calendar.planning")}
									</GearChip>
								</GearSection>
							</div>
						)}
					</div>
				)}
			</div>

			<div className="flex min-h-0 flex-1 items-stretch">
				{/* tělo kalendáře — flex sloupec, mřížka scrolluje uvnitř (prototyp ř. 532) */}
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					{mode === "month" ? (
						<CalendarMonth
							tasks={calTasks}
							availability={availability}
							timeZone={userTimeZone}
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
							availability={availability}
							timeZone={userTimeZone}
							todayIso={todayIso}
							borderColorOf={borderColorOf}
							projColor={projColor}
							onOpen={(tk) => open(tk.id)}
							onDrop={(id, iso) => void moveTask(id, iso, null)}
						/>
					) : (
						<TimeGrid
							days={days}
							calTasks={calTasks}
							availability={availability}
							todayIso={todayIso}
							timeZone={userTimeZone}
							PPM={PPM}
							borderColorOf={borderColorOf}
							projColor={projColor}
							projName={projName}
							scrollRef={gridScrollRef}
							onOpen={(tk) => open(tk.id)}
							onAdd={(iso, min, dur, days) =>
								openAdd({
									date: iso,
									time: min != null ? fmtMin(min) : undefined,
									duration: dur,
									days,
								})
							}
							onMove={moveTask}
							onOpenDay={(iso) => {
								setCur(fromISO(iso));
								setMode("day");
							}}
						/>
					)}
				</div>
				{planningOn && mode !== "month" && !isMobile && (
					<PlanningPanel tasks={tasks} todayIso={todayIso} projColor={projColor} onOpen={open} />
				)}
			</div>
			{pendingRecurrenceMove && (
				<RecurrenceMoveDialog
					taskId={pendingRecurrenceMove.taskId}
					input={pendingRecurrenceMove.input}
					onClose={() => setPendingRecurrenceMove(null)}
				/>
			)}
			{pendingEmergencyMove && (
				<div
					className="fixed inset-0 grid place-items-center bg-black/40 p-4"
					style={{ zIndex: "var(--w-layer-critical)" }}
				>
					<div
						ref={emergencyDialogRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby="focus-emergency-title"
						className="w-full max-w-[520px] rounded-2xl border border-line bg-card p-5 shadow-2xl"
					>
						<div className="mb-1 flex items-start gap-3">
							<div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-700">
								<span aria-hidden>!</span>
							</div>
							<div>
								<h2 id="focus-emergency-title" className="font-display font-extrabold text-base text-ink">
									{t("calendar.emergencyTitle")}
								</h2>
								<p className="mt-1 text-sm text-ink-2">{t("calendar.emergencyDesc")}</p>
							</div>
						</div>
						<ul className="my-4 space-y-2" aria-label={t("calendar.emergencyConflicts")}>
							{pendingEmergencyMove.conflicts.map((conflict) => (
								<li key={`${conflict.blockId}:${conflict.assigneeId}`} className="rounded-xl bg-panel-2 px-3 py-2 text-sm text-ink">
									<span className="font-semibold">{conflict.assigneeName}</span>
									{conflict.label ? ` · ${conflict.label}` : ""}
								</li>
							))}
						</ul>
						<label className="block font-display font-semibold text-sm text-ink" htmlFor="focus-emergency-reason">
							{t("calendar.emergencyReason")}
						</label>
						<textarea
							ref={emergencyInputRef}
							id="focus-emergency-reason"
							value={emergencyReason}
							onChange={(event) => setEmergencyReason(event.target.value)}
							maxLength={500}
							rows={3}
							placeholder={t("calendar.emergencyReasonPlaceholder")}
							className="mt-2 w-full resize-y rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brass"
						/>
						<p className="mt-1 text-xs text-ink-3">{t("calendar.emergencyAuditNote")}</p>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								disabled={emergencyBusy}
								onClick={() => setPendingEmergencyMove(null)}
								className="rounded-xl border border-line px-4 py-2 font-display font-semibold text-sm text-ink-2 hover:bg-panel-2 disabled:opacity-50"
							>
								{t("common.cancel")}
							</button>
							<button
								type="button"
								disabled={emergencyBusy || emergencyReason.trim().length < 8}
								onClick={() => void confirmEmergencyMove()}
								className="rounded-xl bg-amber-700 px-4 py-2 font-display font-semibold text-sm text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{emergencyBusy ? t("calendar.emergencySaving") : t("calendar.emergencyConfirm")}
							</button>
						</div>
					</div>
				</div>
			)}
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

/** Chip gear menu s ikonou/proužkem (prototyp data-chip, ř. 516/522). */
function GearChip({
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
			className="inline-flex cursor-pointer items-center font-display font-semibold"
			style={{
				gap: 6,
				fontSize: 12,
				padding: "6px 11px",
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
	availability,
	timeZone,
	todayIso,
	borderColorOf,
	projColor,
	onOpen,
	onDrop,
}: {
	days: Date[];
	calTasks: TaskRow[];
	availability: CalendarAvailabilityBlock[];
	timeZone: string;
	todayIso: string;
	borderColorOf: (t: TaskRow) => string;
	projColor: (id: string | null) => string;
	onOpen: (t: TaskRow) => void;
	onDrop: (id: string, iso: string) => void;
}) {
	const { t } = useTranslation();
	const uc = useUserColors();
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* hlavičková lišta */}
			<div className="flex flex-none border-line border-b">
				{days.map((d) => {
					const iso = isoOf(d);
					const isToday = iso === todayIso;
					return (
						<div
							key={iso}
							className="min-w-0 flex-1 border-line border-l text-center"
							style={{
								padding: "7px 4px",
								background: isToday ? "var(--w-brass-soft)" : undefined,
							}}
						>
							<div
								className="font-display font-bold uppercase"
								style={{
									fontSize: 10.5,
									letterSpacing: ".03em",
									color: isToday ? "var(--w-brass-text)" : "var(--w-ink-3)",
								}}
							>
								{wdShort(d)}
							</div>
							<div
								className="font-mono"
								style={{
									fontSize: 15,
									color: isToday ? "var(--w-brass-text)" : "var(--w-ink-2)",
								}}
							>
								{d.getDate()}
							</div>
						</div>
					);
				})}
			</div>
			{/* ploché sloupce — flex:1 min-height:0 overflow auto (prototyp ř. 2607) */}
			<div className="flex min-h-0 flex-1 items-stretch overflow-y-auto">
				{days.map((d) => {
					const iso = isoOf(d);
					const isToday = iso === todayIso;
					const wknd = d.getDay() === 0 || d.getDay() === 6;
					const list = calTasks
						.filter((tk) => hit(tk, iso))
						.sort((a, b) => (startMin(a) ?? -1) - (startMin(b) ?? -1));
					const availabilityToday = availability
						.map((block) => ({ block, segment: availabilitySegment(block, iso, timeZone) }))
						.filter(
							(value): value is { block: CalendarAvailabilityBlock; segment: { start: number; end: number } } =>
								Boolean(value.segment),
						)
						.sort((left, right) => left.segment.start - right.segment.start);
					return (
						<div role="region"
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
							{availabilityToday.map(({ block, segment }) => (
								<div
									key={`availability-${block.id}`}
									role="note"
									aria-label={`${t(`availability.kind.${block.kind ?? "unavailable"}`)} ${fmtMin(segment.start)}–${fmtMin(segment.end)}`}
									style={{
										border: "1px dashed var(--w-brass)",
										borderRadius: 7,
										padding: "5px 7px",
										background:
											block.kind === "focus"
												? "repeating-linear-gradient(135deg, var(--w-brass-soft), var(--w-brass-soft) 6px, var(--w-card) 6px, var(--w-card) 12px)"
												: "var(--w-panel-2)",
										color: "var(--w-brass-text)",
										fontSize: 10.5,
									}}
								>
									<strong>{t(`availability.kind.${block.kind ?? "unavailable"}`)}</strong>
									<div className="font-mono" style={{ marginTop: 2, fontSize: 9.5 }}>
										{fmtMin(segment.start)}–{fmtMin(segment.end)}
									</div>
								</div>
							))}
							{list.length === 0 && availabilityToday.length === 0 && (
								<div className="text-center" style={{ fontSize: 11, opacity: 0.5, marginTop: 8 }}>
									—
								</div>
							)}
							{list.map((tk) => {
								const sm = startMin(tk);
								const done = Boolean(tk.completed_at);
								return (
									<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										key={tk.id}
										draggable
										onDragStart={(e) => e.dataTransfer.setData("text/plain", tk.id)}
										onClick={() => onOpen(tk)}
										title={`${tk.name ?? ""} · ${sm != null ? `${fmtMin(sm)}–${fmtMin(endMin(tk))}` : t("calendar.allDay")}`}
										className="relative cursor-grab rounded-[7px] bg-card"
										style={{
											borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
											padding: "5px 6px",
											boxShadow: "var(--w-shadow-sm)",
											opacity: done ? 0.55 : 1,
											background:
												!done && uc(tk.id, tk.color)
													? tcTint(uc(tk.id, tk.color) as string)
													: undefined,
										}}
									>
										<CalCheck t={tk} size={13} style={{ position: "absolute", top: 3, right: 3 }} />
										<div className="flex items-start" style={{ gap: 4, paddingRight: 14 }}>
											<span
												className="mt-1 shrink-0 rounded-full"
												style={{
													width: 6,
													height: 6,
													background: projColor(tk.project_id),
												}}
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
													overflowWrap: "break-word",
													wordBreak: "break-word",
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
											{sm == null ? t("calendar.allDay") : `${fmtMin(sm)}–${fmtMin(endMin(tk))}`}
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
	availability,
	todayIso,
	timeZone,
	PPM,
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
	availability: CalendarAvailabilityBlock[];
	todayIso: string;
	timeZone: string;
	PPM: number;
	borderColorOf: (t: TaskRow) => string;
	projColor: (id: string | null) => string;
	projName: (id: string | null) => string;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	onOpen: (t: TaskRow) => void;
	onAdd: (iso: string, min: number | null, dur?: number, days?: number) => void;
	onMove: (id: string, iso: string, min: number | null, allDay?: boolean) => Promise<void>;
	onOpenDay: (iso: string) => void;
}) {
	const { t } = useTranslation();
	const { metaOf } = useRowMeta();
	const uc = useUserColors();
	const H = 1440 * PPM;
	const weekGridRef = useRef<HTMLDivElement>(null);
	const allDayRef = useRef<HTMLDivElement>(null);
	const [nowMin, setNowMin] = useState(
		() => minutesInTimeZone(new Date().toISOString(), timeZone) ?? 0,
	);
	const [create, setCreate] = useState<DragCreate | null>(null);
	const [drag, setDrag] = useState<BlockDrag | null>(null);
	const dragRef = useRef<BlockDrag | null>(null);
	const suppressClick = useRef(false);
	// Plovoucí náhled tažené karty (celodenní chip → mřížka) — vizuální feedback.
	const [chipGhost, setChipGhost] = useState<{
		name: string;
		x: number;
		y: number;
	} | null>(null);
	// Triage popover přetečených celodenních úkolů („+N") — odbav / otevři / přeplánuj.
	const [adPopover, setAdPopover] = useState<{
		iso: string;
		x: number;
		y: number;
	} | null>(null);

	// now-line refresh (60 s)
	useEffect(() => {
		const id = setInterval(() => {
			setNowMin(minutesInTimeZone(new Date().toISOString(), timeZone) ?? 0);
		}, 60_000);
		return () => clearInterval(id);
	}, [timeZone]);

	// výchozí scroll na 7:00
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = Math.max(0, 7 * 60 * PPM - 8);
	}, [PPM, scrollRef]);

	// Esc zavře triage popover přetečených celodenních úkolů (konzistence s ostatními overlayi).
	useEffect(() => {
		if (!adPopover) return;
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setAdPopover(null);
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [adPopover]);

	const isos = days.map(isoOf);
	const snap = (m: number) => Math.max(0, Math.min(1425, Math.round(m / 15) * 15));

	/** Sloupec dle clientX (cross-day drag, ř. 2691) — POZOR na 46px hodinovou osu vlevo. */
	const GUTTER = 46;
	const colAt = (clientX: number): string | null => {
		const el = weekGridRef.current;
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const usable = r.width - GUTTER;
		if (usable <= 0) return null;
		const idx = Math.floor(((clientX - r.left - GUTTER) / usable) * isos.length);
		return isos[Math.max(0, Math.min(isos.length - 1, idx))] ?? null;
	};

	// ── blok: move/resize (port calBlockDown/_calMove/_calUp) ──
	const blockDown = (tk: TaskRow, mode2: BlockDrag["mode"]) => (e: ReactPointerEvent) => {
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
			endIso: tIso(tk) ?? todayIso,
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
				next = {
					...next,
					s: ns,
					e: ns + dur,
					iso: colAt(ev.clientX) ?? cur.iso,
				};
			} else if (cur.mode === "top") {
				next = {
					...next,
					s: Math.max(0, Math.min(cur.e0 - 15, cur.s0 + dmin)),
				};
			} else {
				// bottom: konec může přejet do dalších dnů → endIso + minuta dle kurzoru
				const endIso = colAt(ev.clientX) ?? cur.iso0;
				const off = Math.max(0, dayOffsetISO(cur.iso0, endIso));
				const grid = weekGridRef.current?.getBoundingClientRect();
				const rawEnd = grid ? snap((ev.clientY - grid.top) / PPM) : Math.min(1440, cur.e0 + dmin);
				const em = off === 0 ? Math.max(cur.s0 + 15, rawEnd) : rawEnd;
				next = {
					...next,
					endIso: off === 0 ? cur.iso0 : endIso,
					e: em,
				};
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
			// puštění nad pásem CELÝ DEN → celodenní = explicitně smazat čas (ř. 2700)
			const band = allDayRef.current?.getBoundingClientRect();
			if (band && ev.clientY < band.bottom && ev.clientY > band.top) {
				await onMove(cur.id, cur.iso, null, true);
				return;
			}
			if (cur.mode === "move") {
				await onMove(cur.id, cur.iso, cur.s);
			} else if (cur.mode === "bottom") {
				// bottom může přejet přes dny → přesné trvání + počet dní
				const off = Math.max(0, dayOffsetISO(cur.iso0, cur.endIso));
				const dur = Math.max(15, off * 1440 + cur.e - cur.s0);
				const zone = tk.start_timezone ?? timeZone;
				const start = zonedDateTimeToIso(cur.iso0, `${fmtMin(cur.s0)}:00`, zone);
				if (!start) {
					showToast(t("addmodal.invalidLocalTime"));
					return;
				}
				await powerSync.execute(
					"UPDATE tasks SET start_date = ?, start_timezone = ?, duration_min = ?, days = ? WHERE id = ?",
					[start, zone, dur, off + 1, cur.id],
				);
			} else {
				// top: posun začátku v rámci dne (konec beze změny)
				const zone = tk.start_timezone ?? timeZone;
				const start = zonedDateTimeToIso(cur.iso0, `${fmtMin(cur.s)}:00`, zone);
				if (!start) {
					showToast(t("addmodal.invalidLocalTime"));
					return;
				}
				await powerSync.execute(
					"UPDATE tasks SET start_date = ?, start_timezone = ?, duration_min = ? WHERE id = ?",
					[start, zone, cur.e0 - cur.s, cur.id],
				);
			}
		};
		window.addEventListener("pointermove", onMoveEv);
		window.addEventListener("pointerup", onUp);
	};

	// ── drag-create: svisle = časový úkol; táhnutím přes dny = vícedenní ──
	// (port _calCreateDown, ř. 2667 + rozšíření o cross-day multi-day create)
	const dayCount = (a: string, b: string) =>
		Math.round(
			(new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000,
		) + 1;
	const createDown = (iso: string) => (e: ReactPointerEvent) => {
		if ((e.target as HTMLElement).closest("[data-evblock]")) return;
		const colEl = e.currentTarget as HTMLElement;
		const rect = colEl.getBoundingClientRect();
		const anchor = snap((e.clientY - rect.top) / PPM);
		let moved = false;
		setCreate({ iso, start: anchor, end: anchor + 30 });
		const onMoveEv = (ev: PointerEvent) => {
			moved = true;
			// Sloupce sdílí stejný horní okraj mřížky → clientY-rect.top platí pro každý sloupec.
			const m = snap((ev.clientY - rect.top) / PPM);
			const curIso = isos.length > 1 ? (colAt(ev.clientX) ?? iso) : iso;
			if (curIso === iso) {
				setCreate({
					iso,
					start: Math.min(anchor, m),
					end: Math.max(Math.min(anchor, m) + 15, Math.max(anchor, m)),
				});
			} else {
				// tažení do jiného dne → vícedenní span; drží se čas začátku (den dolů)
				// a živý čas konce (den, kde je kurzor) — pro dynamický náhled na minuty
				const forward = iso <= curIso;
				const startDay = forward ? iso : curIso;
				const endDay = forward ? curIso : iso;
				setCreate({
					iso: startDay,
					isoEnd: endDay,
					start: forward ? anchor : m,
					end: forward ? m : anchor,
				});
			}
		};
		const onUp = (ev: PointerEvent) => {
			window.removeEventListener("pointermove", onMoveEv);
			window.removeEventListener("pointerup", onUp);
			setCreate(null);
			if (!moved) return;
			suppressClick.current = true;
			setTimeout(() => {
				suppressClick.current = false;
			}, 80);
			const curIso = isos.length > 1 ? (colAt(ev.clientX) ?? iso) : iso;
			const m = snap((ev.clientY - rect.top) / PPM);
			if (curIso === iso) {
				const s = Math.min(anchor, m);
				const e2 = Math.max(Math.min(anchor, m) + 15, Math.max(anchor, m));
				onAdd(iso, s, e2 - s);
			} else {
				// vícedenní: přesný čas začátku (den dolů) i konce (den puštění) → přesné trvání v minutách
				const forward = iso <= curIso;
				const startDay = forward ? iso : curIso;
				const endDay = forward ? curIso : iso;
				const startMinV = forward ? anchor : m;
				const endMinV = forward ? m : anchor;
				const days = dayCount(startDay, endDay);
				const dur = Math.max(30, (days - 1) * 1440 + (endMinV - startMinV));
				onAdd(startDay, startMinV, dur, days);
			}
		};
		window.addEventListener("pointermove", onMoveEv);
		window.addEventListener("pointerup", onUp);
	};

	// ── celodenní chip: pointer-drag → do mřížky = časový úkol, nad pásem = přesun dne ──
	const allDayChipDown = (tk: TaskRow) => (e: ReactPointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const x0 = e.clientX;
		const y0 = e.clientY;
		let moved = false;
		const onMoveEv = (ev: PointerEvent) => {
			if (Math.abs(ev.clientY - y0) > 4 || Math.abs(ev.clientX - x0) > 4) moved = true;
			if (moved) setChipGhost({ name: tk.name ?? "", x: ev.clientX, y: ev.clientY });
		};
		const onUp = async (ev: PointerEvent) => {
			window.removeEventListener("pointermove", onMoveEv);
			window.removeEventListener("pointerup", onUp);
			setChipGhost(null);
			if (!moved) {
				onOpen(tk);
				return;
			}
			suppressClick.current = true;
			setTimeout(() => {
				suppressClick.current = false;
			}, 80);
			const targetIso = colAt(ev.clientX) ?? tIso(tk) ?? todayIso;
			const band = allDayRef.current?.getBoundingClientRect();
			// puštění zpět nad pásem CELÝ DEN → zůstane celodenní (jen případný přesun dne)
			if (band && ev.clientY >= band.top && ev.clientY <= band.bottom) {
				await onMove(tk.id, targetIso, null, true);
				return;
			}
			// puštění v časové mřížce → nastavit čas dle Y (mřížka scrolluje → přes weekGridRef top)
			const grid = weekGridRef.current?.getBoundingClientRect();
			if (!grid) return;
			const min = snap((ev.clientY - grid.top) / PPM);
			await onMove(tk.id, targetIso, Math.max(0, Math.min(1425, min)));
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

	// ── data pro pás CELÝ DEN ── JEDEN per-den rozpočet (ALLDAY_PER_COL karet).
	// Vícedenní celodenní = tenké linky protínající sloupce; v plném dni linka na tom segmentu
	// nekreslí a událost spadne do „+N" toho dne (odtud otevřitelná — i přetečená vícedenní).
	const isWeekBand = isos.length > 1;
	const isoKey = isos.join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: isoKey pokrývá isos (stabilní klíč).
	const allDay = useMemo(() => {
		type Seg = { tk: TaskRow; row: number; x0: number; x1: number };
		type Col = { chips: TaskRow[]; overflow: TaskRow[] };
		const alldayTk = calTasks.filter((tk) => startMin(tk) == null);
		// Den: vše celodenní přes hit() jako chipy (bez linek); rozpočet 3, zbytek „+N".
		if (!isWeekBand) {
			const iso = isos[0] ?? todayIso;
			const hits = alldayTk.filter((tk) => hit(tk, iso));
			const cols = new Map<string, Col>();
			cols.set(iso, {
				chips: hits.slice(0, ALLDAY_PER_COL),
				overflow: hits.slice(ALLDAY_PER_COL),
			});
			return { segs: [] as Seg[], stripRows: 0, cols };
		}
		const n = isos.length;
		// jednodenní celodenní chipy per sloupec + vícedenní celodenní (linky)
		const singleByIso = new Map<string, TaskRow[]>();
		for (const iso of isos) singleByIso.set(iso, []);
		const multi: TaskRow[] = [];
		for (const tk of alldayTk) {
			const s = tIso(tk);
			const e = tIsoEnd(tk);
			if (!s || !e) continue;
			if (e > s && (tk.days ?? 1) > 1) {
				if (isos.some((iso) => iso >= s && iso <= e)) multi.push(tk);
			} else singleByIso.get(s)?.push(tk);
		}
		// stack vícedenních do řádků (nepřekrývající se → stejný řádek)
		const rows: TaskRow[][] = [];
		for (const tk of multi) {
			const s = tIso(tk) ?? "";
			const e = tIsoEnd(tk) ?? "";
			let placed = false;
			for (const row of rows) {
				if (row.every((o) => (tIsoEnd(o) ?? "") < s || (tIso(o) ?? "") > e)) {
					row.push(tk);
					placed = true;
					break;
				}
			}
			if (!placed) rows.push([tk]);
		}
		const shown = rows.slice(0, MAX_LINE_ROWS);
		// den je plný, když jednodenní chipy vyčerpají rozpočet → tam se linka nekreslí
		const isFull = (iso: string) => (singleByIso.get(iso)?.length ?? 0) >= ALLDAY_PER_COL;
		const segs: Seg[] = [];
		shown.forEach((row, ri) => {
			for (const tk of row) {
				const s = tIso(tk) ?? "";
				const e = tIsoEnd(tk) ?? "";
				let run: number | null = null;
				for (let i = 0; i < n; i++) {
					const iso = isos[i] ?? "";
					const draw = iso >= s && iso <= e && !isFull(iso);
					if (draw) {
						if (run == null) run = i;
					} else if (run != null) {
						segs.push({ tk, row: ri, x0: run, x1: i - 1 });
						run = null;
					}
				}
				if (run != null) segs.push({ tk, row: ri, x0: run, x1: n - 1 });
			}
		});
		const drawnByCol = isos.map(() => new Set<string>());
		for (const sg of segs) for (let i = sg.x0; i <= sg.x1; i++) drawnByCol[i]?.add(sg.tk.id);
		const cols = new Map<string, Col>();
		isos.forEach((iso, idx) => {
			const singles = singleByIso.get(iso) ?? [];
			const multisCrossing = multi.filter((tk) => {
				const s = tIso(tk);
				const e = tIsoEnd(tk);
				return !!s && !!e && s <= iso && iso <= e;
			});
			// přetok = chipy nad rozpočet + vícedenní, které tu nemají nakreslenou linku
			const multiOverflow = multisCrossing.filter((tk) => !drawnByCol[idx]?.has(tk.id));
			cols.set(iso, {
				chips: singles.slice(0, ALLDAY_PER_COL),
				overflow: [...singles.slice(ALLDAY_PER_COL), ...multiOverflow],
			});
		});
		const stripRows = segs.length ? Math.max(...segs.map((s) => s.row)) + 1 : 0;
		return { segs, stripRows, cols };
	}, [calTasks, isWeekBand, isoKey, todayIso]);

	return (
		// full-bleed flex sloupec — bez rounded karty (prototyp buildWeek, ř. 2861)
		<div className="flex min-h-0 flex-1 flex-col">
			{/* plovoucí náhled tažené celodenní karty (vizuální feedback dragu) */}
			{chipGhost && (
				<div
					className="pointer-events-none fixed flex items-center rounded-[6px] border border-brass bg-card"
					style={{
						left: chipGhost.x + 12,
						top: chipGhost.y - 10,
						gap: 6,
						padding: "4px 9px",
						maxWidth: 220,
						fontSize: 11.5,
						zIndex: 90,
						boxShadow: "var(--w-shadow)",
						opacity: 0.95,
					}}
				>
					<span
						className="shrink-0 rounded-full"
						style={{ width: 6, height: 6, background: "var(--w-brass)" }}
					/>
					<span className="min-w-0 truncate font-display font-semibold text-ink">
						{chipGhost.name}
					</span>
				</div>
			)}
			{/* triage popover přetečených celodenních úkolů — odškrtni / otevři / přeplánuj */}
			{adPopover &&
				(() => {
					// přetečené celodenní toho dne — chipy nad rozpočet i vícedenní bez linky (otevřitelné)
					const list = allDay.cols.get(adPopover.iso)?.overflow ?? [];
					return (
						<>
							<button type="button" aria-label={t("common.close")}
								className="fixed inset-0"
								style={{ zIndex: 89 }}
								onClick={() => setAdPopover(null)}
							/>
							<div
								className="fixed flex flex-col rounded-xl border border-line bg-card"
								style={{
									// clamp obou os: popover se nesmí schovat za okraj okna (maxHeight 320).
									left: Math.max(8, Math.min(adPopover.x, window.innerWidth - 280)),
									top: Math.max(8, Math.min(adPopover.y, window.innerHeight - 328)),
									width: 264,
									maxHeight: 320,
									overflowY: "auto",
									padding: 6,
									zIndex: 90,
									boxShadow: "var(--w-shadow)",
								}}
							>
								<div
									className="font-display font-bold text-ink-3 uppercase"
									style={{
										fontSize: 9.5,
										letterSpacing: ".05em",
										padding: "4px 8px 6px",
									}}
								>
									{t("calendar.allDay")} · {list.length}
								</div>
								{list.map((tk) => {
									const done = Boolean(tk.completed_at);
									return (
										<div
											key={tk.id}
											onPointerDown={(e) => {
												// Zavři popover, jakmile se rozjede skutečný drag (>4px) —
												// tap řeší allDayChipDown (!moved → onOpen), pak popover zavřeme.
												const sx = e.clientX;
												const sy = e.clientY;
												let moved = false;
												const onMv = (ev: PointerEvent) => {
													if (Math.abs(ev.clientX - sx) > 4 || Math.abs(ev.clientY - sy) > 4) {
														moved = true;
														setAdPopover(null);
														window.removeEventListener("pointermove", onMv);
													}
												};
												const onUpW = () => {
													window.removeEventListener("pointermove", onMv);
													window.removeEventListener("pointerup", onUpW);
													if (!moved) setAdPopover(null);
												};
												window.addEventListener("pointermove", onMv);
												window.addEventListener("pointerup", onUpW);
												allDayChipDown(tk)(e);
											}}
											className="flex cursor-grab items-center rounded-lg hover:bg-panel-2"
											style={{ gap: 8, padding: "6px 8px" }}
										>
											<CalCheck t={tk} size={15} />
											<span
												className="shrink-0 rounded-full"
												style={{
													width: 6,
													height: 6,
													background: projColor(tk.project_id),
												}}
											/>
											<span
												className="min-w-0 flex-1 truncate font-body"
												style={{
													fontSize: 12.5,
													color: done ? "var(--w-ink-3)" : "var(--w-ink)",
													textDecoration: done ? "line-through" : "none",
												}}
											>
												{tk.name}
											</span>
										</div>
									);
								})}
								<button
									type="button"
									onClick={() => {
										onOpenDay(adPopover.iso);
										setAdPopover(null);
									}}
									className="mt-1 rounded-lg border-line border-t pt-2 text-left font-display font-semibold text-brass-text hover:underline"
									style={{ fontSize: 12, padding: "6px 8px" }}
								>
									{t("calendar.openDayView")}
								</button>
							</div>
						</>
					);
				})()}
			{/* hlavička dnů (jen týden; den view ji nemá — ř. 2846) */}
			{isos.length > 1 && (
				<div className="flex flex-none" style={{ marginLeft: 46 }}>
					{days.map((d) => {
						const iso = isoOf(d);
						const isToday = iso === todayIso;
						return (
							<div
								key={iso}
								className="min-w-0 flex-1 text-center"
								style={{ padding: "6px 0 4px" }}
							>
								<div
									className="font-display font-bold uppercase"
									style={{
										fontSize: 10.5,
										letterSpacing: ".03em",
										color: isToday ? "var(--w-brass-text)" : "var(--w-ink-3)",
									}}
								>
									{wdShort(d)}
								</div>
								<div
									className="font-mono"
									style={{
										fontSize: 15,
										color: isToday ? "var(--w-brass-text)" : "var(--w-ink-2)",
									}}
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
				className="relative flex flex-none items-stretch border-line border-b"
				style={{ minHeight: 30, background: "var(--w-panel-2)" }}
			>
				{/* gutter popisek vertikálně i horizontálně na středu (prototyp ř. 2824) */}
				<div
					className="flex items-center justify-center text-center font-mono uppercase"
					style={{
						width: 46,
						flex: "none",
						fontSize: 8.5,
						color: "var(--w-ink-3)",
						letterSpacing: ".02em",
						lineHeight: 1.15,
						background: "var(--w-panel-2)",
					}}
				>
					{t("calendar.allDayBand")}
				</div>
				<div className="relative min-w-0 flex-1">
					{/* vícedenní celodenní = tenké překryvné linky protínající sloupce (strop MAX_LINE_ROWS).
					    V plném dni se segment linky nekreslí — událost je v „+N" toho dne (viz allDay memo). */}
					{allDay.stripRows > 0 && (
						<div className="relative" style={{ height: allDay.stripRows * LINE_ROW_H + 4 }}>
							{allDay.segs.map((sg) => {
								const done = Boolean(sg.tk.completed_at);
								const leftPct = (sg.x0 / isos.length) * 100;
								const wPct = ((sg.x1 - sg.x0 + 1) / isos.length) * 100;
								const col = done
									? "var(--w-line)"
									: (uc(sg.tk.id, sg.tk.color) as string) || borderColorOf(sg.tk);
								return (
									<div
									key={`${sg.tk.id}:${sg.x0}:${sg.x1}`}
										data-adchip
										onPointerDown={allDayChipDown(sg.tk)}
										title={`${sg.tk.name ?? ""} · ${t("today.daysCount", { count: sg.tk.days ?? 1 })}`}
										className="absolute flex cursor-grab items-center"
										style={{
											top: sg.row * LINE_ROW_H + 2,
											left: `calc(${leftPct}% + 2px)`,
											width: `calc(${wPct}% - 4px)`,
											height: LINE_ROW_H,
											opacity: done ? 0.55 : 1,
											zIndex: 3,
										}}
									>
										<span
											className="w-full"
											style={{ height: LINE_H, borderRadius: 999, background: col }}
										/>
									</div>
								);
							})}
						</div>
					)}
					{/* celodenní chipy per sloupec — jednodenní (týden) / vše přes hit (den); rozpočet + „+N" */}
					<div className="flex">
						{isos.map((iso) => {
							const colM = allDay.cols.get(iso) ?? { chips: [], overflow: [] };
							const list = colM.chips;
							const overflowN = colM.overflow.length;
							const isToday = iso === todayIso;
							return (
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
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
										// drop do pásu = celodenní, čas se maže (prototyp dropToAllDay, ř. 2706)
										if (id) void onMove(id, iso, null, true);
									}}
								>
									{list.map((tk) => {
										const done = Boolean(tk.completed_at);
										return (
											<div
												key={tk.id}
												data-adchip
												onPointerDown={allDayChipDown(tk)}
												className="flex cursor-grab items-center rounded-[6px] border border-line bg-card"
												style={{
													gap: 5,
													padding: "3px 7px 3px 8px",
													borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
													opacity: done ? 0.55 : 1,
													background:
														!done && uc(tk.id, tk.color)
															? tcTint(uc(tk.id, tk.color) as string)
															: undefined,
												}}
											>
												<CalCheck t={tk} size={13} />
												<span
													className="shrink-0 rounded-full"
													style={{
														width: 6,
														height: 6,
														background: projColor(tk.project_id),
													}}
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
														overflowWrap: "break-word",
														wordBreak: "break-word",
													}}
												>
													{tk.name}
													{tk.recurrence ? " ↻" : ""}
												</span>
											</div>
										);
									})}
									{overflowN > 0 && (
										<button
											type="button"
											data-adchip
											onClick={(e) => {
												e.stopPropagation();
												const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
												setAdPopover({ iso, x: r.left, y: r.bottom + 4 });
											}}
											className="rounded-[6px] text-left font-display font-semibold text-brass-text hover:bg-brass-soft"
											style={{ fontSize: 10.5, padding: "2px 8px" }}
										>
											+{overflowN} {t("calendar.moreCount", { count: overflowN })}
										</button>
									)}
									{isos.length === 1 && list.length === 0 && (
										<span
											className="font-body"
											style={{
												fontSize: 11,
												color: "var(--w-ink-3)",
												padding: "2px 4px",
											}}
										>
											{t("calendar.noAllDay")}
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{/* mřížka — flex:1 min-height:0, scroll uvnitř (prototyp ř. 2860, bez maxHeight) */}
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
				<div
					ref={weekGridRef}
					className="flex"
					style={{ height: H + 40, position: "relative", paddingBottom: 40 }}
				>
					{/* hodinová osa (0–24 vč.; 00:00 s výjimkou top:2 — prototyp ř. 2832) */}
					<div style={{ width: 46, flex: "none", position: "relative" }}>
					{HOURS.map((h) => (
							<span
								key={h}
								className="absolute right-1.5 font-mono text-ink-3"
								style={{ top: h === 0 ? 2 : h * 60 * PPM - 6, fontSize: 10 }}
							>
								{pad(h)}:00
							</span>
						))}
					</div>
					{days.map((d) => {
						const iso = isoOf(d);
						const isToday = iso === todayIso;
						const wknd = d.getDay() === 0 || d.getDay() === 6;
						// segment [segS, segE) úkolu v TOMTO sloupci (min od půlnoci sloupce).
						// Vícedenní časovaný úkol = spojité segmenty: start→půlnoc, plné dny, půlnoc→konec.
						// Při resize „bottom" použij živý konec z dragu (přes sloupce).
						const segOf = (tk: TaskRow) => {
							const sm = startMin(tk) ?? 0;
							const s = tIso(tk) as string;
							const k = dayOffsetISO(s, iso);
							if (drag?.id === tk.id && drag.mode === "bottom") {
								const endOff = dayOffsetISO(drag.iso0, drag.endIso);
								return {
									k,
									last: endOff,
									segS: k === 0 ? drag.s0 : 0,
									segE: k === endOff ? drag.e : 1440,
								};
							}
							const last = lastOffsetOf(tk);
							return {
								k,
								last,
								segS: k === 0 ? sm : 0,
								segE: k === last ? endAbs(tk) - last * 1440 : 1440,
							};
						};
						// úkol patří do sloupce, když je časovaný a jeho span protíná tento den
						let timed = calTasks.filter((tk) => {
							if (startMin(tk) == null) return false; // celodenní → pás
							const s = tIso(tk);
							if (!s) return false;
							const k = dayOffsetISO(s, iso);
							return k >= 0 && k <= lastOffsetOf(tk);
						});
						// Tažený blok (move) se živě kreslí v cílovém sloupci (přepisuje date).
						if (drag?.mode === "move" && drag.iso === iso && !timed.some((x) => x.id === drag.id)) {
							const dt = calTasks.find((x) => x.id === drag.id);
							if (dt) timed = [...timed, dt];
						}
						// Live ghost při resize „bottom" přes sloupce — vlož úkol do sloupců ve spanu tažení.
						if (drag?.mode === "bottom") {
							const off = dayOffsetISO(drag.iso0, iso);
							const endOff = dayOffsetISO(drag.iso0, drag.endIso);
							if (off >= 0 && off <= endOff && !timed.some((x) => x.id === drag.id)) {
								const dt = calTasks.find((x) => x.id === drag.id);
								if (dt) timed = [...timed, dt];
							}
						}
						const lanes = layoutDay(
							timed.map((tk) => {
								if (drag && drag.mode === "move" && drag.id === tk.id)
									return { id: tk.id, s: drag.s, e: drag.e };
								const seg = segOf(tk);
								return { id: tk.id, s: seg.segS, e: seg.segE };
							}),
						);
						const hiddenByLane = timed.filter((tk) => (lanes.get(tk.id)?.lane ?? 0) >= MAX_LANES);
						const availabilityToday = availability
							.map((block) => ({ block, segment: availabilitySegment(block, iso, timeZone) }))
							.filter(
								(value): value is { block: CalendarAvailabilityBlock; segment: { start: number; end: number } } =>
									Boolean(value.segment),
							);
						return (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
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
								{HOURS.map((h) => (
									<div
										key={h}
										className="absolute right-0 left-0 border-line border-t"
										style={{ top: h * 60 * PPM }}
									/>
								))}
								{/* Dostupnost je netasková vrstva: bez checkboxu, dragu a priority. */}
								{availabilityToday.map(({ block, segment }) => {
									const kind = block.kind ?? "unavailable";
									const height = Math.max(5, (segment.end - segment.start) * PPM);
									const label = t(`availability.kind.${kind}`);
									return (
										<div
											key={`availability-${block.id}`}
											role="note"
											aria-label={`${label} ${fmtMin(segment.start)}–${fmtMin(segment.end)}`}
											title={`${label} · ${fmtMin(segment.start)}–${fmtMin(segment.end)}`}
											style={{
												pointerEvents: "none",
												position: "absolute",
												left: 2,
												right: 2,
												top: segment.start * PPM,
												height,
												zIndex: 1,
												border: `1px ${kind === "focus" ? "dashed" : "solid"} var(--w-brass)`,
												borderRadius: 5,
												background:
													kind === "focus"
														? "repeating-linear-gradient(135deg, color-mix(in srgb, var(--w-brass) 13%, transparent), color-mix(in srgb, var(--w-brass) 13%, transparent) 7px, transparent 7px, transparent 14px)"
														: "color-mix(in srgb, var(--w-ink-3) 8%, transparent)",
												color: "var(--w-brass-text)",
												overflow: "hidden",
											}}
										>
											{height >= 22 && (
												<span className="font-display" style={{ display: "inline-block", padding: "2px 5px", fontSize: 9.5, fontWeight: 750 }}>
													{label} · {fmtMin(segment.start)}–{fmtMin(segment.end)}
												</span>
											)}
										</div>
									);
								})}
								{/* now line + štítek (ř. 2624) */}
								{isToday && (
									<div
										className="pointer-events-none absolute right-0 left-0"
										style={{
											top: nowMin * PPM,
											height: 2,
											background: "var(--w-overdue)",
											zIndex: 6,
										}}
									>
										<div
											className="absolute rounded-full"
											style={{
												left: -4,
												top: -3,
												width: 8,
												height: 8,
												background: "var(--w-overdue)",
											}}
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
								{/* drag-create ghost — jeden den (časový blok) nebo vícedenní (sloupcový pruh) */}
								{create &&
									(create.isoEnd && create.isoEnd !== create.iso ? (
										// vícedenní span: časově přesné segmenty (start→půlnoc, plné dny,
										// půlnoc→živý konec) s dynamickým časem — jako u jednodenního tažení
										(() => {
											const a = create.iso; // den začátku (chronologicky)
											const b = create.isoEnd; // den konce
											const k = dayOffsetISO(a, iso);
											const last = dayOffsetISO(a, b);
											if (k < 0 || k > last) return null;
											const segS = k === 0 ? create.start : 0;
											const segE = k === last ? create.end : 1440;
											return (
												<div
													className="pointer-events-none absolute right-1 left-1"
													style={{
														top: segS * PPM,
														height: Math.max(4, (segE - segS) * PPM),
														background: "var(--w-brass-soft)",
														border: "1.5px dashed var(--w-brass)",
														borderTopLeftRadius: k === 0 ? 6 : 0,
														borderTopRightRadius: k === 0 ? 6 : 0,
														borderBottomLeftRadius: k === last ? 6 : 0,
														borderBottomRightRadius: k === last ? 6 : 0,
														zIndex: 8,
													}}
												>
													{k === 0 && (
														<span
															className="font-mono font-bold"
															style={{
																fontSize: 9.5,
																color: "var(--w-brass-text)",
																padding: "2px 5px",
																display: "inline-block",
															}}
														>
															{fmtMin(create.start)}
														</span>
													)}
													{k === last && (
														<span
															className="absolute right-1 bottom-0.5 font-mono font-bold"
															style={{
																fontSize: 9.5,
																color: "var(--w-brass-text)",
															}}
														>
															→ {fmtMin(create.end)}
														</span>
													)}
												</div>
											);
										})()
									) : create.iso === iso ? (
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
												style={{
													fontSize: 9.5,
													color: "var(--w-brass-text)",
													padding: "2px 5px",
													display: "inline-block",
												}}
											>
												{fmtMin(create.start)}–{fmtMin(create.end)}
											</span>
										</div>
									) : null)}
								{/* bloky */}
								{timed.map((tk) => {
									const lay = lanes.get(tk.id) ?? { lane: 0, cols: 1 };
									if (lay.lane >= MAX_LANES) return null;
									const isDragging = drag?.id === tk.id;
									const seg = segOf(tk);
									// geometrie ze segmentu; move/top mají živý override (jednodenní)
									let s = seg.segS;
									let e2 = seg.segE;
									if (isDragging && drag && drag.mode === "move") {
										s = drag.s;
										e2 = drag.e;
									} else if (isDragging && drag && drag.mode === "top") {
										s = drag.s;
									}
									// při move se blok kreslí jen v cílovém sloupci (drag.iso)
									if (isDragging && drag?.mode === "move" && drag.iso !== iso) return null;
									// napojení segmentů: potlač zaoblení na řezaných hranách (půlnoc)
									const cutTop = seg.segS === 0 && seg.k > 0;
									const cutBottom = seg.segE === 1440 && seg.k < seg.last;
									const spanLabel = `${fmtMin(startMin(tk) ?? 0)}–${fmtMin(endAbs(tk) % 1440 || 1440)}${seg.last > 0 ? ` (+${seg.last}d)` : ""}`;
									const cols = Math.min(lay.cols, MAX_LANES);
									const wPct = lay.cols > MAX_LANES ? 100 / 3.8 : 100 / cols;
									const leftPct = lay.lane * wPct;
									const hPx = Math.max(22, (e2 - s) * PPM);
									// narrow čistě dle šířky bloku — platí i pro Den (prototyp ř. 2771)
									const narrow = wPct < 46;
									const lineH = narrow ? 12 : 13; // ř. 2772
									const done = Boolean(tk.completed_at);
									const showMeta = hPx >= 58 && !narrow;
									// ř. 2777: odečíst padding 7 + meta řádek 15
									const nameLines = Math.max(
										1,
										Math.floor((hPx - 7 - (showMeta ? 15 : 0)) / lineH),
									);
									const who = metaOf(
										isVirtual(tk) ? { ...tk, id: parseOccId(tk.id)?.taskId ?? tk.id } : tk,
									).avatars[0]?.initials;
									return (
										<div
											key={tk.id}
											data-evblock={tk.id}
											onPointerDown={blockDown(tk, "move")}
											title={`${tk.name ?? ""} · ${spanLabel} · ${projName(tk.project_id)}`}
											className="absolute overflow-hidden rounded-md border border-line bg-card"
											style={{
												left: `calc(${leftPct}% + 2px)`,
												width: `calc(${wPct}% - 6px)`,
												top: s * PPM,
												height: hPx,
												borderLeft: `3px solid ${done ? "var(--w-line)" : borderColorOf(tk)}`,
												borderTopLeftRadius: cutTop ? 0 : undefined,
												borderTopRightRadius: cutTop ? 0 : undefined,
												borderBottomLeftRadius: cutBottom ? 0 : undefined,
												borderBottomRightRadius: cutBottom ? 0 : undefined,
												padding: "3px 5px",
												zIndex: isDragging ? 9 : 5,
												opacity: done ? 0.58 : 1,
												boxShadow: "var(--w-shadow-sm)",
												cursor: isDragging ? "grabbing" : "grab",
												background:
													!done && uc(tk.id, tk.color)
														? tcTint(uc(tk.id, tk.color) as string)
														: undefined,
												touchAction: "none",
											}}
										>
											{/* resize úchyty — horní jen u jednodenního, dolní na posledním dni spanu */}
											{seg.last === 0 && (
												<div
													onPointerDown={blockDown(tk, "top")}
													style={{
														position: "absolute",
														top: 0,
														left: 0,
														right: 0,
														height: 5,
														cursor: "ns-resize",
														zIndex: 4,
													}}
												/>
											)}
											{seg.k === seg.last && (
												<div
													onPointerDown={blockDown(tk, "bottom")}
													style={{
														position: "absolute",
														bottom: 0,
														left: 0,
														right: 0,
														height: 5,
														cursor: "ns-resize",
														zIndex: 4,
													}}
												/>
											)}
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
													{drag?.mode === "bottom" ? fmtMin(e2) : fmtMin(s)}
												</span>
											)}
											<CalCheck
												t={tk}
												size={narrow ? 12 : 13}
												style={{
													position: "absolute",
													top: 3,
													right: 3,
													zIndex: 3,
												}}
											/>
											{/* tečka projektu + název NA JEDNOM řádku (flex) — u nízkých karet se
											    název neořízne pod tečku; víceřádkový název se zarovná nahoru */}
											<div
												className="flex min-w-0"
												style={{
													alignItems: nameLines > 1 ? "flex-start" : "center",
													gap: 4,
													paddingRight: 15,
												}}
											>
												<span
													className="shrink-0 rounded-full"
													style={{
														width: 6,
														height: 6,
														marginTop: nameLines > 1 ? 4 : 0,
														background: projColor(tk.project_id),
													}}
												/>
												<span
													className="min-w-0 flex-1 font-display font-semibold"
													style={{
														fontSize: narrow ? 10.5 : 11,
														lineHeight: `${lineH}px`,
														color: done ? "var(--w-ink-3)" : "var(--w-ink)",
														textDecoration: done ? "line-through" : "none",
														display: "-webkit-box",
														WebkitLineClamp: nameLines,
														WebkitBoxOrient: "vertical",
														overflow: "hidden",
														overflowWrap: "break-word",
														wordBreak: "break-word",
													}}
												>
													{tk.name}
													{tk.recurrence ? " ↻" : ""}
												</span>
											</div>
											{showMeta && (
												<div className="mt-0.5 flex items-center" style={{ gap: 5 }}>
													<span
														className="min-w-0 flex-1 truncate font-body"
														style={{ fontSize: 9.5, color: "var(--w-ink-3)" }}
													>
														{projName(tk.project_id)}
													</span>
													{/* avatar přiřazené osoby 15px (prototyp ř. 2791) */}
													{who && (
														<span
															className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
															style={{
																width: 15,
																height: 15,
																fontSize: 8.5,
																color: "#fff",
																background: "var(--w-avatar)",
															}}
														>
															{who}
														</span>
													)}
												</div>
											)}
										</div>
									);
								})}
								{/* „+N" skrytých — per-cluster pruhy dle rozsahu časů (prototyp ř. 2746–2756) */}
								{(() => {
									if (hiddenByLane.length === 0) return null;
									const hs = hiddenByLane
										.map((tk) => {
											const g = segOf(tk);
											return { s: g.segS, e: g.segE };
										})
										.sort((a, b) => a.s - b.s);
									const subs: { s: number; e: number; n: number }[] = [];
									for (const x of hs) {
										const last = subs[subs.length - 1];
										if (last && x.s < last.e) {
											last.e = Math.max(last.e, x.e);
											last.n++;
										} else subs.push({ s: x.s, e: x.e, n: 1 });
									}
									const W = 100 / 3.8;
									return subs.map((g) => (
										<button
											key={`more-${g.s}-${g.e}`}
											type="button"
											title={`${g.n} ${t("calendar.moreInTime")}`}
											onClick={(e) => {
												e.stopPropagation();
												onOpenDay(iso);
											}}
											className="absolute flex items-start justify-center font-display font-bold"
											style={{
												left: `calc(${MAX_LANES * W}% + 2px)`,
												width: `calc(${100 - MAX_LANES * W}% - 4px)`,
												top: g.s * PPM,
												height: Math.max(20, (g.e - g.s) * PPM),
												paddingTop: 3,
												border: "1px dashed var(--w-ink-3)",
												background: "var(--w-panel-2)",
												borderRadius: 6,
												fontSize: 11,
												color: "var(--w-ink-2)",
												cursor: "pointer",
												zIndex: 2,
											}}
										>
											+{g.n}
										</button>
									));
								})()}
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
	const overdue = tasks.filter((tk) => !tk.completed_at && tIso(tk) && (tIso(tk) ?? "") < todayIso);
	const noTime = tasks.filter(
		(tk) => !tk.completed_at && tIso(tk) === todayIso && startMin(tk) == null,
	);
	const reschedule = async () => {
		if (overdue.length === 0) return;
		// Snímek původních termínů → hromadné přeplánování jde vrátit přes ⌘Z (dřív bez undo).
		const snap = overdue.map((tk) => ({ id: tk.id, due: tk.due_date }));
		const apply = async (rows: { id: string; due: string | null }[]) => {
			await powerSync.writeTransaction(async (tx) => {
				for (const r of rows)
					await tx.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [r.due, r.id]);
			});
		};
		const next = snap.map((r) => ({ id: r.id, due: todayIso }));
		await apply(next);
		pushUndo({ undo: () => apply(snap), redo: () => apply(next) });
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
				<div className="flex flex-col" style={{ gap: 7 }}>
					{list.map((tk) => {
						const due = rowDue(tk, t);
						return (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								key={tk.id}
								draggable
								onDragStart={(e) => e.dataTransfer.setData("text/plain", tk.id)}
								onClick={() => onOpen(tk.id)}
								className="flex cursor-grab items-center rounded-[10px] border border-line hover:border-brass"
								style={{
									gap: 9,
									padding: "9px 11px",
									background: "var(--w-panel-2)",
								}}
							>
								<span
									className="shrink-0 rounded-full"
									style={{
										width: 7,
										height: 7,
										background: projColor(tk.project_id),
									}}
								/>
								<div className="min-w-0 flex-1">
									<div
										className="truncate font-display font-semibold text-ink"
										style={{ fontSize: 12.5 }}
									>
										{tk.name}
									</div>
									{/* due label — zpožděné červeně (prototyp data-due, ř. 548) */}
									{due && (
										<div
											className="font-mono"
											style={{
												fontSize: 10.5,
												marginTop: 1,
												color: due.overdue ? "var(--w-overdue)" : "var(--w-ink-2)",
											}}
										>
											{due.label}
										</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		);

	return (
		// panel má bg var(--panel) prototypu = bg-card (prototyp ř. 534)
		<div
			className="border-line border-l bg-card"
			style={{ width: 272, flex: "none", padding: 16, overflowY: "auto" }}
		>
			<div className="font-display font-extrabold text-ink" style={{ fontSize: 14 }}>
				{t("calendar.planning")}
			</div>
			<div
				className="font-body text-ink-3"
				style={{ fontSize: 11.5, margin: "3px 0 10px", lineHeight: 1.5 }}
			>
				{t("calendar.planningHint")}
			</div>
			{group(t("today.overdue"), overdue, true)}
			{group(t("calendar.noDate"), noTime)}
		</div>
	);
}
