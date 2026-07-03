import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useMemo, useState } from "react";
import { useAddTask } from "../lib/addTask";
import { advanceChainForTask } from "../lib/chainAdvance";
import type { StatusRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useRowMeta } from "../lib/rowMeta";
import { useTaskDetail } from "../lib/taskDetail";
import { deadlineLabel, rowDue } from "../lib/tasks";

/**
 * Nástěnka — sloupce dle `statuses` (R9: drop do sloupce s is_done ⇄ completed_at).
 * Sdílená pro Úkoly i Nadcházející (prototyp: board je společný workspace pohled).
 */
/** Čárkovaný drop-indikátor pořadí (prototyp ř. 464). */
function GapLine() {
	return (
		<div
			style={{
				height: 0,
				borderTop: "2px dashed var(--w-brass)",
				borderRadius: 2,
				margin: "0 2px",
			}}
		/>
	);
}

/** Tint volitelné barvy úkolu (stejná konvence jako TaskCard/Calendar). */
const tcTint = (hex: string) => `color-mix(in srgb, ${hex} 12%, var(--w-card))`;

export function Board({ tasks }: { tasks: TaskRow[] }) {
	const { t } = useTranslation();
	const { open } = useTaskDetail();
	const { openAdd } = useAddTask();
	const { metaOf } = useRowMeta();
	const projects = useProjects();
	const projMap = useMemo(
		() => new Map(projects.map((p) => [p.id, p])),
		[projects],
	);
	const [dragId, setDragId] = useState<string | null>(null);
	const [overCol, setOverCol] = useState<string | null>(null);
	// Pozice vkládání v rámci sloupce (prototyp boardOverCard, ř. 2566): id karty + before/after.
	const [overCard, setOverCard] = useState<{
		id: string;
		pos: "b" | "a";
	} | null>(null);
	const { data: statuses } = usePsQuery<StatusRow>(
		"SELECT * FROM statuses ORDER BY position",
	);

	const columns = useMemo(() => {
		const cols = (statuses ?? []).filter((s) => s.name);
		if (cols.length === 0) return [];
		const firstCol = cols.find((c) => !c.is_done) ?? cols[0];
		const colOf = (tk: TaskRow): string => {
			if (tk.status_id && cols.some((c) => c.id === tk.status_id))
				return tk.status_id;
			if (tk.completed_at)
				return cols.find((c) => c.is_done)?.id ?? firstCol?.id ?? "";
			return firstCol?.id ?? "";
		};
		// Pořadí ve sloupci: sort_order (boardOrder prototypu), fallback vstupní pořadí.
		return cols.map((c) => ({
			st: c,
			tasks: tasks
				.filter((tk) => colOf(tk) === c.id)
				.sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)),
		}));
	}, [statuses, tasks]);

	const dropTo = async (
		statusId: string,
		isDone: boolean,
		taskId: string | null,
	) => {
		const id = taskId || dragId;
		const target = overCard;
		setDragId(null);
		setOverCol(null);
		setOverCard(null);
		if (!id) return;
		const tk = tasks.find((x) => x.id === id);
		if (!tk) return;
		const wasDone = !!tk.completed_at;
		// R9: is_done sloupec ⇄ completed_at (provázané se zaškrtnutím)
		await powerSync.execute(
			"UPDATE tasks SET status_id = ?, completed_at = ? WHERE id = ?",
			[
				statusId,
				isDone ? (tk.completed_at ?? new Date().toISOString()) : null,
				tk.id,
			],
		);
		// Reorder v rámci sloupce (prototyp boardOrder splice, ř. 2569–2573).
		const col = columns.find((c) => c.st.id === statusId);
		if (col) {
			const ids = col.tasks.map((x) => x.id).filter((x) => x !== id);
			let idx = ids.length;
			if (target && target.id !== id) {
				const ti = ids.indexOf(target.id);
				if (ti >= 0) idx = target.pos === "b" ? ti : ti + 1;
			}
			ids.splice(idx, 0, id);
			for (let i = 0; i < ids.length; i++) {
				await powerSync.execute(
					"UPDATE tasks SET sort_order = ? WHERE id = ?",
					[i * 10, ids[i]],
				);
			}
		}
		if (isDone !== wasDone) await advanceChainForTask(tk.id, isDone);
	};

	if (columns.length === 0) {
		return (
			<p className="rounded-xl border border-line border-dashed px-4 py-10 text-center text-ink-3 text-sm">
				{t("today.empty")}
			</p>
		);
	}

	return (
		<div
			className="flex items-start gap-3.5 overflow-x-auto"
			style={{ paddingBottom: 90 }}
		>
			{columns.map(({ st, tasks: colTasks }) => (
				<div
					key={st.id}
					data-col={st.id}
					onDragOver={(e) => {
						e.preventDefault();
						setOverCol(st.id);
					}}
					onDragLeave={() => setOverCol((c) => (c === st.id ? null : c))}
					onDrop={(e) => {
						e.preventDefault();
						void dropTo(
							st.id,
							!!st.is_done,
							e.dataTransfer.getData("text/plain") || null,
						);
					}}
					className="flex flex-col gap-2 rounded-[14px] border bg-panel-2"
					style={{
						width: 280,
						flex: "none",
						padding: 12,
						borderColor: overCol === st.id ? "var(--w-brass)" : "var(--w-line)",
					}}
				>
					<div
						className="flex items-center gap-2"
						style={{ padding: "2px 4px" }}
					>
						<span
							className="font-display font-bold text-ink"
							style={{ fontSize: 12.5 }}
						>
							{st.name}
						</span>
						<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
							{colTasks.length}
						</span>
					</div>
					{colTasks.map((tk) => {
						const p = tk.project_id ? projMap.get(tk.project_id) : undefined;
						const meta = metaOf(tk);
						const done = !!tk.completed_at;
						const pri = (tk.priority ?? 4) as 1 | 2 | 3 | 4;
						const due = rowDue(tk, t);
						const dl = deadlineLabel(tk.deadline);
						// Gap indikátory jen ve sloupci, nad kterým se táhne (prototyp showGap, ř. 3101).
						const gapBefore =
							dragId &&
							overCol === st.id &&
							overCard?.id === tk.id &&
							overCard.pos === "b";
						const gapAfter =
							dragId &&
							overCol === st.id &&
							overCard?.id === tk.id &&
							overCard.pos === "a";
						return (
							// biome-ignore lint/a11y/useKeyWithClickEvents: drag karta, klik = detail; klávesnice řeší list view
							<div key={tk.id} data-gap-wrap style={{ display: "contents" }}>
								{gapBefore && <GapLine />}
								<div
									draggable
									onDragStart={(e) => {
										e.dataTransfer.setData("text/plain", tk.id);
										setDragId(tk.id);
									}}
									onDragEnd={() => {
										setDragId(null);
										setOverCol(null);
										setOverCard(null);
									}}
									onDragOver={(e) => {
										e.preventDefault();
										e.stopPropagation();
										setOverCol(st.id);
										const r = e.currentTarget.getBoundingClientRect();
										const pos = e.clientY - r.top < r.height / 2 ? "b" : "a";
										setOverCard((c) =>
											c?.id === tk.id && c.pos === pos ? c : { id: tk.id, pos },
										);
									}}
									onClick={() => open(tk.id)}
									className="cursor-grab rounded-[11px] border bg-card transition-shadow hover:shadow-md"
									style={{
										padding: "11px 12px",
										boxShadow: "var(--w-shadow-sm)",
										// CSS ř. 57 + 115: okraj karty = barva priority, done → line; ř. 114 done opacity .55, data-dim .4.
										borderColor: done ? "var(--w-line)" : `var(--w-p${pri})`,
										background:
											!done && tk.color ? tcTint(tk.color) : undefined,
										opacity: dragId === tk.id ? 0.4 : done ? 0.55 : 1,
									}}
								>
									<div className="flex items-center gap-2">
										<span
											className="shrink-0 rounded-full"
											style={{
												width: 8,
												height: 8,
												background: p?.color ?? "var(--w-line)",
												// CSS ř. 118: tečka projektu na done kartě zešedne.
												...(done
													? { filter: "grayscale(1)", opacity: 0.4 }
													: undefined),
											}}
										/>
										<span
											className={`min-w-0 flex-1 truncate font-display font-semibold ${done ? "text-ink-3 line-through" : "text-ink"}`}
											style={{ fontSize: 13 }}
										>
											{tk.name}
										</span>
									</div>
									<div className="mt-2.5 flex items-center gap-2">
										{/* P pilulka neutrální (CSS ř. 52–54): border line + ink-2, P1 border ink-3 + ink, P4 ink-3. */}
										<span
											className="rounded-full bg-card font-display font-semibold"
											style={{
												fontSize: 10.5,
												padding: "2px 7px",
												border: `1px solid ${pri === 1 ? "var(--w-ink-3)" : "var(--w-line)"}`,
												color:
													pri === 1
														? "var(--w-ink)"
														: pri === 4
															? "var(--w-ink-3)"
															: "var(--w-ink-2)",
											}}
										>
											P{pri}
										</span>
										{due && (
											<span
												className="font-mono"
												style={{
													fontSize: 11,
													color: due.overdue
														? "var(--w-overdue)"
														: "var(--w-ink-2)",
												}}
											>
												{due.label}
											</span>
										)}
										{tk.recurrence && (
											<span
												title={t("detail.recurringPill")}
												className="inline-flex items-center font-mono text-brass-text"
												style={{ fontSize: 11, gap: 2 }}
											>
												↻ {tk.recurrence}
											</span>
										)}
										{dl && (
											<span
												className="inline-flex items-center font-mono"
												style={{
													fontSize: 10.5,
													gap: 2,
													color: "var(--w-overdue)",
												}}
											>
												⚑ {dl}
											</span>
										)}
										{meta.avatars.length > 0 && (
											<span className="ml-auto inline-flex items-center">
												{meta.avatars.map((a, i) => (
													<span
														key={`${a.initials}-${i}`}
														className="flex items-center justify-center rounded-full font-display font-semibold"
														style={{
															width: 20,
															height: 20,
															color: "#fff",
															fontSize: 9,
															background: a.brass
																? "var(--w-brass)"
																: "var(--w-avatar)",
															boxShadow: "0 0 0 2px var(--w-card)",
															marginLeft: i > 0 ? -6 : 0,
														}}
													>
														{a.initials}
													</span>
												))}
											</span>
										)}
									</div>
								</div>
								{gapAfter && <GapLine />}
							</div>
						);
					})}
					{/* Drop na konec sloupce — čárkovaný indikátor před patičkou (prototyp c.gapEnd, ř. 479). */}
					{dragId &&
						overCol === st.id &&
						!(overCard && colTasks.some((x) => x.id === overCard.id)) && (
							<GapLine />
						)}
					{/* „+ Přidat" patička sloupce (prototyp ř. 480–482). */}
					<button
						type="button"
						onClick={() => openAdd()}
						className="flex cursor-pointer items-center border-none bg-transparent font-display font-semibold text-ink-3 hover:bg-card hover:text-brass-text"
						style={{
							gap: 6,
							padding: "7px 8px",
							borderRadius: 9,
							fontSize: 12,
						}}
					>
						<svg width="11" height="11" viewBox="0 0 13 13" aria-hidden="true">
							<line
								x1="6.5"
								y1="2"
								x2="6.5"
								y2="11"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinecap="round"
							/>
							<line
								x1="2"
								y1="6.5"
								x2="11"
								y2="6.5"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinecap="round"
							/>
						</svg>
						{t("toolbar.addCard")}
					</button>
				</div>
			))}
		</div>
	);
}
