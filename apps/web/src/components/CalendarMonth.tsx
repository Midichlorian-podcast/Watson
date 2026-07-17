import { useTranslation } from "@watson/i18n";
import { useMemo, useState } from "react";
import { useAddTask } from "../lib/addTask";
import { useSession } from "../lib/auth-client";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { useRowMeta } from "../lib/rowMeta";
import { useTaskDetail } from "../lib/taskDetail";
import { startMinOf, toggleTask } from "../lib/tasks";
// sdílené helpery rozsahu úkolu (tIso/tIsoEnd/addDaysISO) — kruhový import je bezpečný,
// používají se až za renderu
import {
	addDaysISO,
	availabilitySegment,
	type CalendarAvailabilityBlock,
	tIso,
	tIsoEnd,
} from "./Calendar";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// sdílený parser času (lib/tasks.startMinOf) — dřív lokální kopie, P1-06 jeden zdroj pravdy
const startMin = (t: TaskRow): number | null => startMinOf(t);

/**
 * Měsíční kalendář (port buildMonth, ř. 2863–2891): pondělí-first, prázdné pozice před 1. dnem
 * (dny cizích měsíců se NEzobrazují), fixní výška řádků, chip s checkboxem + časem + avatarem,
 * „+N další" klikací → den, drag mezi buňkami, klik do prázdné buňky = nový úkol.
 */
export function CalendarMonth({
	tasks,
	availability = [],
	timeZone = "Europe/Prague",
	controlledBase,
	borderColorOf,
	onOpenDay,
	onDropDay,
}: {
	tasks: TaskRow[];
	availability?: CalendarAvailabilityBlock[];
	timeZone?: string;
	/** Řízený měsíc (z Calendar toolbaru) — skryje vlastní hlavičku. */
	controlledBase?: Date;
	/** Barva levého okraje chipu (priorita/projekt dle gear menu). */
	borderColorOf?: (t: TaskRow) => string;
	/** Klik na „+N další" → přepnout na den. */
	onOpenDay?: (d: Date) => void;
	/** Drop chipu na jiný den. */
	onDropDay?: (id: string, iso: string, min: number | null) => void;
}) {
	const { t, i18n } = useTranslation();
	const { open } = useTaskDetail();
	const { openAdd } = useAddTask();
	const { metaOf } = useRowMeta();
	const { data: session } = useSession();
	const uid = session?.user?.id;
	const projects = useProjects();
	const projColor = (id: string | null) =>
		(id ? projects.find((p) => p.id === id)?.color : null) ?? "var(--w-ink-3)";
	const [offset, setOffset] = useState(0);

	const today = new Date();
	const todayIso = isoOf(today);
	const base = controlledBase ?? new Date(today.getFullYear(), today.getMonth() + offset, 1);
	const year = base.getFullYear();
	const month = base.getMonth();

	/**
	 * Plná mřížka: pondělí-first, doplněná o přesahové dny z předchozího/dalšího měsíce
	 * (ztlumené), aby týdny na okrajích byly kompletní. Počet řádků = kolik týdnů měsíc zabírá.
	 */
	const cells = useMemo(() => {
		const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Po=0
		const dim = new Date(year, month + 1, 0).getDate();
		const weeks = Math.ceil((firstDow + dim) / 7);
		const start = new Date(year, month, 1 - firstDow); // pondělí prvního týdne
		return Array.from({ length: weeks * 7 }, (_, i) => {
			const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
			return { date: dt, iso: isoOf(dt), inMonth: dt.getMonth() === month };
		});
	}, [year, month]);

	const byDay = useMemo(() => {
		const m = new Map<string, TaskRow[]>();
		for (const tk of tasks) {
			const s = tIso(tk);
			if (!s) continue;
			// Vícedenní úkol (days > 1) zasahuje každou buňku rozsahu (prototyp _hit ř. 2632 + ř. 2874).
			const e = tIsoEnd(tk) ?? s;
			for (let d = s, i = 0; d <= e && i < 62; d = addDaysISO(d, 1), i++) {
				const arr = m.get(d);
				if (arr) arr.push(tk);
				else m.set(d, [tk]);
			}
		}
		return m;
	}, [tasks]);

	const weekdayLabels = useMemo(() => {
		const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
		return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
	}, [i18n.language]);

	const title = new Intl.DateTimeFormat(i18n.language, {
		month: "long",
		year: "numeric",
	}).format(base);
	const border = borderColorOf ?? ((tk: TaskRow) => `var(--w-p${tk.priority ?? 4})`);

	return (
		// v řízeném režimu z Calendar scrolluje měsíc uvnitř full-bleed sloupce (prototyp ř. 2891)
		<div className={controlledBase ? "min-h-0 flex-1 overflow-y-auto" : undefined}>
			{/* hlavička (skrytá při řízeném režimu z Calendar) */}
			{!controlledBase && (
				<div className="mb-3 flex items-center gap-2">
					<h2 className="font-display font-extrabold text-lg text-navy capitalize">{title}</h2>
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
			)}

			{/* dny v týdnu */}
			<div className="grid grid-cols-7 gap-1.5" style={{ marginTop: 10 }}>
				{weekdayLabels.map((w) => (
					<div
						key={w}
						className="pb-1 text-center font-display font-bold text-[11px] text-ink-3 uppercase tracking-wider"
					>
						{w}
					</div>
				))}
			</div>

			{/* mřížka — fixní výška řádků 126px, overflow hidden (ř. 2871) */}
			<div className="grid grid-cols-7 gap-1.5" style={{ gridAutoRows: 126 }}>
				{cells.map((cell) => {
					const { date: d, iso, inMonth } = cell;
					const isToday = iso === todayIso;
					const list = byDay.get(iso) ?? [];
					const shown = list.slice(0, 3);
					const more = list.length - shown.length;
					const availabilityToday = availability
						.map((block) => ({ block, segment: availabilitySegment(block, iso, timeZone) }))
						.filter(
							(value): value is { block: CalendarAvailabilityBlock; segment: { start: number; end: number } } =>
								Boolean(value.segment),
						);
					return (
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							key={iso}
							data-calendar-date={iso}
							onClick={(e) => {
								if ((e.target as HTMLElement).closest("[data-mchip]")) return;
								openAdd({ date: iso });
							}}
							onDragOver={(e) => e.preventDefault()}
							onDrop={(e) => {
								e.preventDefault();
								const id = e.dataTransfer.getData("text/plain");
								if (id) onDropDay?.(id, iso, null);
							}}
							className="flex cursor-pointer flex-col gap-[3px] overflow-hidden rounded-[10px] border p-1.5"
							style={{
								borderColor: isToday ? "var(--w-brass)" : inMonth ? "var(--w-line)" : "transparent",
								// přesahové dny (jiný měsíc) ztlumené — patrné, ale nesplývají s aktuálním
								background: isToday
									? "var(--w-brass-soft)"
									: inMonth
										? "var(--w-card)"
										: "var(--w-panel-2)",
								opacity: inMonth ? 1 : 0.62,
							}}
						>
							<span
								className="font-mono"
								style={{
									fontSize: 12,
									fontWeight: isToday ? 700 : 400,
									color: isToday
										? "var(--w-brass-text)"
										: inMonth
											? "var(--w-ink-2)"
											: "var(--w-ink-3)",
								}}
							>
								{d.getDate()}
							</span>
							{availabilityToday.length > 0 && (
								<div
									data-mchip
									role="note"
									aria-label={availabilityToday
										.map(({ block }) => t(`availability.kind.${block.kind ?? "unavailable"}`))
										.join(", ")}
									style={{
										minHeight: 16,
										border: "1px dashed var(--w-brass)",
										borderRadius: 4,
										padding: "1px 4px",
										background: availabilityToday.some(({ block }) => block.kind === "focus")
											? "repeating-linear-gradient(135deg, var(--w-brass-soft), var(--w-brass-soft) 5px, var(--w-card) 5px, var(--w-card) 10px)"
											: "var(--w-panel-2)",
										color: "var(--w-brass-text)",
										fontSize: 9.5,
										fontWeight: 700,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{t(`availability.kind.${availabilityToday[0]?.block.kind ?? "unavailable"}`)}
									{availabilityToday.length > 1 ? ` +${availabilityToday.length - 1}` : ""}
								</div>
							)}
							{shown.map((tk) => {
								const done = Boolean(tk.completed_at);
								const sm = startMin(tk);
								const ava = metaOf(tk).avatars[0];
								return (
									<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										key={tk.id}
										data-mchip
										data-calendar-task-id={tk.id}
										draggable
										onDragStart={(e) => e.dataTransfer.setData("text/plain", tk.id)}
										onClick={(e) => {
											e.stopPropagation();
											open(tk.id);
										}}
										title={`${tk.name ?? ""}${sm != null ? ` · ${pad(Math.floor(sm / 60))}:${pad(sm % 60)}` : ""}`}
										className="flex cursor-pointer items-center gap-1 rounded-[4px]"
										style={{
											background: "var(--w-panel-2)",
											borderLeft: `2px solid ${done ? "var(--w-line)" : border(tk)}`,
											padding: "2px 4px",
											opacity: done ? 0.55 : 1,
										}}
									>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												// actorId (R2): u shared_all přepni jen účast aktéra, ne dokončení všem.
												if (!tk.id.includes("@")) void toggleTask(tk, uid);
											}}
											aria-label={t(done ? "detail.ariaMarkUndone" : "detail.ariaComplete")}
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
											style={{
												width: 5,
												height: 5,
												background: projColor(tk.project_id),
											}}
										/>
										<span
											className="min-w-0 flex-1 truncate"
											style={{
												fontSize: 10.5,
												color: done ? "var(--w-ink-3)" : "var(--w-ink)",
												textDecoration: done ? "line-through" : "none",
											}}
										>
											{tk.name}
										</span>
										<span
											className="shrink-0 font-mono"
											style={{
												fontSize: 8,
												color: sm != null ? "var(--w-ink-3)" : "var(--w-brass-text)",
											}}
										>
											{sm != null
												? `${pad(Math.floor(sm / 60))}:${pad(sm % 60)}`
												: t("calendar.allDay")}
										</span>
										{ava && (
											<span
												className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
												style={{
													width: 13,
													height: 13,
													fontSize: 6.5,
													color: "#fff",
													background: "var(--w-avatar)",
												}}
											>
												{ava.initials}
											</span>
										)}
									</div>
								);
							})}
							{more > 0 && (
								<button
									type="button"
									data-mchip
									title={t("calendar.openDayN", { n: list.length })}
									onClick={(e) => {
										e.stopPropagation();
										onOpenDay?.(d);
									}}
									className="rounded-[5px] text-left font-display font-bold hover:bg-brass-soft"
									style={{
										fontSize: 10,
										color: "var(--w-brass-text)",
										padding: "2px 5px",
									}}
								>
									{t("calendar.more", { more })}
								</button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
