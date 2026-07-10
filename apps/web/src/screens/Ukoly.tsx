import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "../components/Board";
import { Calendar } from "../components/CalendarLazy";
import { TaskItem } from "../components/TaskItem";
import {
	DEFAULT_TOOLBAR,
	filterTasks,
	sortTasks,
	TasksToolbar,
	type ToolbarState,
	useToolbarCtx,
} from "../components/TasksToolbar";
import { useAddTask } from "../lib/addTask";
import { useFlowSteps } from "../lib/flowSteps";
import { inboxProjectIds, isInboxTask } from "../lib/inbox";
import { useKbNav } from "../lib/kbNav";
import { filterByQuery, useListSearch } from "../lib/listSearch";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";
import { deleteTaskWithUndo, pushColumnUndo } from "../lib/undo";
import { useViewMode } from "../lib/viewMode";

/**
 * Úkoly — view modes Seznam | Nástěnka | Kalendář (per-user výchozí v localStorage) +
 * toolbar (Filtr/Řazení/směr/Dokončené) + seznamová klávesová navigace (j/k/Enter/Space/1–4).
 * Nástěnka = sloupce dle `statuses` (R9: drop do sloupce s is_done ⇄ completed_at).
 */
export function Ukoly() {
	const { t } = useTranslation();
	const search = useSearch({ strict: false }) as {
		projekt?: string;
		ukol?: string;
	};
	const projektId = search.projekt;
	const projects = useProjects();
	const { open } = useTaskDetail();
	const projDetail = useProjectDetail();
	const { openAdd } = useAddTask();
	const { view } = useViewMode();
	const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
	const flowSteps = useFlowSteps();

	// Výkon: bez „Dokončené" filtruj hotové rovnou v SQL (méně řádků přes WASM bridge na každou změnu).
	const { data: allTasks } = usePsQuery<TaskRow>(
		tb.showDone
			? "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date"
			: "SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY priority, due_date IS NULL, due_date",
	);

	const scoped = useMemo(() => {
		const inboxIds = inboxProjectIds(projects);
		const noInbox = (allTasks ?? []).filter((x) => !isInboxTask(x, inboxIds));
		return projektId
			? noInbox.filter((x) => x.project_id === projektId)
			: noInbox;
	}, [allTasks, projektId, projects]);
	const { q: searchQ } = useListSearch();
	// Seznam/Nástěnka: podúkoly skrýt — reprezentuje je ⚏ rodiče + vrstvený detail
	// (pravidlo viditelnosti podúkolů; kalendář dole dostává scoped vč. podúkolů s termínem).
	const tbCtx = useToolbarCtx();
	const shown = useMemo(
		() =>
			filterByQuery(
				sortTasks(
					filterTasks(
						scoped.filter((x) => !x.parent_id),
						tb,
						tbCtx,
					),
					tb,
					tbCtx,
				),
				searchQ,
			),
		[scoped, tb, tbCtx, searchQ],
	);

	const groups = useMemo(() => {
		const m = new Map<string, TaskRow[]>();
		for (const tk of shown) {
			const k = tk.project_id ?? "—";
			const arr = m.get(k);
			if (arr) arr.push(tk);
			else m.set(k, [tk]);
		}
		// Stabilní pořadí sekcí = pořadí projektů, ne pořadí seřazených úkolů (prototyp ř. 3040).
		const order = new Map(projects.map((p, i) => [p.id, i] as const));
		const totals = new Map<string, number>();
		for (const tk of scoped) {
			if (tk.parent_id || tk.completed_at) continue;
			const k = tk.project_id ?? "—";
			totals.set(k, (totals.get(k) ?? 0) + 1);
		}
		return [...m.entries()]
			.sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
			.map(([pid, list]) => ({
				pid,
				list,
				total: totals.get(pid) ?? list.length,
			}));
	}, [shown, scoped, projects]);

	const projMap = useMemo(
		() => new Map(projects.map((p) => [p.id, p])),
		[projects],
	);
	const projName = (id: string) => projMap.get(id)?.name ?? "—";
	const activeProject = projektId ? projMap.get(projektId) : undefined;

	// Deep-link ?ukol= (z „Kopírovat odkaz") → otevřít detail (funguje i pro výskyty id@ISO).
	useEffect(() => {
		if (search.ukol) open(search.ukol);
	}, [search.ukol, open]);

	// Pořadí pro ↑/↓ v detailu (prototyp _navIds) + kbsel navigace (sdílený hook).
	// VIZUÁLNÍ pořadí = po skupinách projektů (ne flat sort) — jinak shift-rozsah
	// hromadného výběru a j/k skáčou mimo viditelné pořadí řádků.
	const visualList = useMemo(
		() => (projektId ? shown : groups.flatMap((g) => g.list)),
		[projektId, shown, groups],
	);
	const { setNavIds } = useTaskDetail();
	useEffect(() => {
		setNavIds(visualList.map((tk) => tk.id));
	}, [visualList, setNavIds]);
	const kbSel = useKbNav(visualList, view === "list");

	// Výkon: „Úkoly" je jediná obrazovka renderující VŠECHNY otevřené úkoly najednou. Nad prahem
	// vykreslíme jen prvních CAP řádků (napříč skupinami) + patičku „zobrazit vše" — brání desítkám
	// tisíc DOM uzlů. (Plná virtualizace je follow-up; seskupení + kbNav zůstávají zachované.)
	const CAP = 400;
	const [showAllRows, setShowAllRows] = useState(false);
	const capped = !showAllRows && shown.length > CAP;
	const shownCapped = capped ? shown.slice(0, CAP) : shown;
	const groupsCapped = useMemo(() => {
		if (!capped) return groups;
		let budget = CAP;
		const out: typeof groups = [];
		for (const g of groups) {
			if (budget <= 0) break;
			const list = g.list.slice(0, budget);
			budget -= list.length;
			out.push({ ...g, list });
		}
		return out;
	}, [groups, capped]);

	return (
		<div
			className="mx-auto max-w-[1080px]"
			style={{ padding: "10px 22px 90px" }}
		>
			{/* banner filtrovaného projektu */}
			{activeProject && (
				<div
					className="flex items-center"
					style={{ gap: 10, padding: "6px 4px 10px" }}
				>
					<span
						className="shrink-0 rounded-full"
						style={{
							width: 11,
							height: 11,
							background: activeProject.color ?? "var(--w-ink-3)",
						}}
					/>
					<span
						className="font-display font-extrabold text-ink"
						style={{ fontSize: 18 }}
					>
						{activeProject.name}
					</span>
					<button
						type="button"
						onClick={() => projDetail.open(activeProject.id)}
						className="font-display font-semibold text-ink-3 hover:text-brass-text"
						style={{ fontSize: 12 }}
					>
						{t("projects.editProject")}
					</button>
					<Link
						to="/ukoly"
						search={{}}
						className="ml-auto font-display font-semibold text-brass-text hover:underline"
						style={{ fontSize: 12.5 }}
					>
						{t("projects.allTasks")}
					</Link>
				</div>
			)}

			{view !== "calendar" && (
				<TasksToolbar state={tb} onChange={setTb} ctx={tbCtx} />
			)}

			{view === "calendar" ? (
				<Calendar tasks={scoped} />
			) : view === "board" ? (
				<Board tasks={shown} />
			) : (
				<>
					{shown.length === 0 &&
						(projektId ? (
							<div className="text-center" style={{ padding: "80px 20px" }}>
								<p className="font-body text-ink-3" style={{ fontSize: 13.5 }}>
									{t("projects.emptyProject")}
								</p>
								<button
									type="button"
									onClick={() => openAdd({ projectId: projektId })}
									className="mt-3 rounded-[9px] font-display font-bold text-white hover:brightness-105"
									style={{
										background: "var(--w-brass)",
										padding: "8px 14px",
										fontSize: 12.5,
									}}
								>
									+ {t("today.addTask")}
								</button>
							</div>
						) : (
							<p
								className="text-center font-body text-ink-3"
								style={{ padding: "80px 20px", fontSize: 13.5 }}
							>
								{t("today.emptyClean")}
							</p>
						))}
					{projektId ? (
						<ul>
							{shownCapped.map((tk) => (
								<KbRow key={tk.id} selected={kbSel === tk.id}>
									<TaskItem
										task={tk}
										project={projMap.get(tk.project_id ?? "")}
										flow={flowSteps.get(tk.id)}
									/>
								</KbRow>
							))}
						</ul>
					) : (
						groupsCapped.map(({ pid, list, total }) => (
							<section key={pid}>
								<div
									className="flex items-center gap-2.5"
									style={{ margin: "18px 0 2px", padding: "0 4px" }}
								>
									<span
										className="font-display font-bold text-ink"
										style={{ fontSize: 13 }}
									>
										{projName(pid)}
									</span>
									<span
										className="font-mono text-ink-3"
										style={{ fontSize: 11.5 }}
									>
										{total}
									</span>
								</div>
								<ul>
									{list.map((tk) => (
										<KbRow key={tk.id} selected={kbSel === tk.id}>
											<TaskItem
												task={tk}
												project={projMap.get(tk.project_id ?? "")}
												flow={flowSteps.get(tk.id)}
											/>
										</KbRow>
									))}
								</ul>
							</section>
						))
					)}
					{capped && (
						<button
							type="button"
							onClick={() => setShowAllRows(true)}
							className="mt-4 w-full rounded-[9px] border border-line border-dashed py-3 text-center font-display font-semibold text-ink-3 hover:text-brass-text"
							style={{ fontSize: 12.5 }}
						>
							{t("toolbar.showAllCapped", { shown: CAP, total: shown.length })}
						</button>
					)}
				</>
			)}
		</div>
	);
}

/** Obal řádku se zvýrazněním klávesového výběru (kbSel ring). */
function KbRow({
	selected,
	children,
}: {
	selected: boolean;
	children: ReactNode;
}) {
	return (
		<div
			data-kbsel={selected || undefined}
			className="rounded-xl"
			style={
				selected
					? { outline: "2px solid var(--w-brass)", outlineOffset: -1 }
					: undefined
			}
		>
			{children}
		</div>
	);
}
