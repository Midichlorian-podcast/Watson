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
import { pushUndo } from "../lib/undo";

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

	// Statusy jsou seedované PER PROJEKT (stejné názvy „K udělání/Probíhá/Hotovo"). Board ale může
	// agregovat úkoly z více projektů → sloupce SLUČÍME podle názvu a drop namapujeme na status
	// VLASTNÍHO projektu úkolu. Bez toho by Board ukázal N×3 sloupců a drop zapsal cizí status_id (S2).
	const key = (name: string | null) => (name ?? "").trim().toLowerCase();
	const { columns, resolveStatus } = useMemo(() => {
		const projIds = new Set(
			tasks.map((t) => t.project_id).filter(Boolean) as string[],
		);
		const scoped = (statuses ?? []).filter(
			(s) => s.name && s.project_id && projIds.has(s.project_id),
		);
		const byId = new Map(scoped.map((s) => [s.id, s] as const));
		// Sloučené sloupce podle názvu (klíč), pozice = nejmenší, is_done = OR.
		const colMap = new Map<
			string,
			{ key: string; name: string; is_done: boolean; position: number }
		>();
		for (const s of scoped) {
			const k = key(s.name);
			const ex = colMap.get(k);
			if (!ex)
				colMap.set(k, {
					key: k,
					name: s.name ?? "",
					is_done: !!s.is_done,
					position: s.position ?? 0,
				});
			else {
				ex.position = Math.min(ex.position, s.position ?? 0);
				ex.is_done = ex.is_done || !!s.is_done;
			}
		}
		const ordered = [...colMap.values()].sort((a, b) => a.position - b.position);
		// (project_id, klíč sloupce) → konkrétní status_id daného projektu.
		const resolve = new Map<string, string>();
		for (const s of scoped) resolve.set(`${s.project_id}::${key(s.name)}`, s.id);
		const firstCol = ordered.find((c) => !c.is_done) ?? ordered[0];
		const colKeyOf = (tk: TaskRow): string => {
			const own = tk.status_id ? byId.get(tk.status_id) : undefined;
			if (own) return key(own.name);
			if (tk.completed_at)
				return ordered.find((c) => c.is_done)?.key ?? firstCol?.key ?? "";
			return firstCol?.key ?? "";
		};
		return {
			resolveStatus: (projectId: string | null, colKey: string) =>
				projectId ? (resolve.get(`${projectId}::${colKey}`) ?? null) : null,
			columns: ordered.map((c) => ({
				col: c,
				tasks: tasks
					.filter((tk) => colKeyOf(tk) === c.key)
					.sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)),
			})),
		};
	}, [statuses, tasks]);

	const dropTo = async (
		colKey: string,
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
		// Status VLASTNÍHO projektu úkolu (ne cizí) — anti-korupce cross-project.
		const statusId = resolveStatus(tk.project_id, colKey);
		// R9: is_done sloupec ⇄ completed_at (provázané se zaškrtnutím)
		const prevStatus = tk.status_id;
		const prevDone = tk.completed_at;
		const newDone = isDone
			? (tk.completed_at ?? new Date().toISOString())
			: null;
		const writeStatus = async (st: string | null, done: string | null) => {
			await powerSync.execute(
				"UPDATE tasks SET status_id = ?, completed_at = ? WHERE id = ?",
				[st, done, tk.id],
			);
		};
		await writeStatus(statusId, newDone);
		// ⌘Z vrátí přesun sloupce/stavu na nástěnce (prototyp verzuje každou změnu tasks).
		pushUndo({
			undo: () => writeStatus(prevStatus, prevDone),
			redo: () => writeStatus(statusId, newDone),
		});
		// Reorder v rámci sloupce (prototyp boardOrder splice, ř. 2569–2573).
		const col = columns.find((c) => c.col.key === colKey);
		if (col) {
			const ids = col.tasks.map((x) => x.id).filter((x) => x !== id);
			let idx = ids.length;
			if (target && target.id !== id) {
				const ti = ids.indexOf(target.id);
				if (ti >= 0) idx = target.pos === "b" ? ti : ti + 1;
			}
			ids.splice(idx, 0, id);
			// Lokální atomicita: přepis sort_order všech karet ve sloupci v jedné transakci.
			await powerSync.writeTransaction(async (tx) => {
				for (let i = 0; i < ids.length; i++) {
					await tx.execute("UPDATE tasks SET sort_order = ? WHERE id = ?", [
						i * 10,
						ids[i],
					]);
				}
			});
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
			{columns.map(({ col, tasks: colTasks }) => (
				<div
					key={col.key}
					data-col={col.key}
					onDragOver={(e) => {
						e.preventDefault();
						setOverCol(col.key);
					}}
					onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
					onDrop={(e) => {
						e.preventDefault();
						void dropTo(
							col.key,
							col.is_done,
							e.dataTransfer.getData("text/plain") || null,
						);
					}}
					className="flex flex-col gap-2 rounded-[14px] border bg-panel-2"
					style={{
						width: 280,
						flex: "none",
						padding: 12,
						borderColor: overCol === col.key ? "var(--w-brass)" : "var(--w-line)",
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
							{col.name}
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
							overCol === col.key &&
							overCard?.id === tk.id &&
							overCard.pos === "b";
						const gapAfter =
							dragId &&
							overCol === col.key &&
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
										setOverCol(col.key);
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
											!done && (meta.color ?? tk.color)
												? tcTint((meta.color ?? tk.color) as string)
												: undefined,
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
						overCol === col.key &&
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
