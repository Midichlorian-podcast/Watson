import { useQuery as usePsQuery } from "@powersync/react";
import i18n, { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import { Board } from "../components/Board";
import { Calendar } from "../components/Calendar";
import { TaskItem } from "../components/TaskItem";
import {
	DEFAULT_TOOLBAR,
	filterTasks,
	sortTasks,
	TasksToolbar,
	type ToolbarState,
	useToolbarCtx,
} from "../components/TasksToolbar";
import { WorkspaceChips } from "../components/WorkspaceChips";
import { useFlowSteps } from "../lib/flowSteps";
import { useKbNav } from "../lib/kbNav";
import { filterByQuery, useListSearch } from "../lib/listSearch";
import {
	expandOccurrences,
	occId,
	parseRecurrenceRule,
} from "../lib/occurrences";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { dayOf, todayISO } from "../lib/tasks";
import { useViewMode } from "../lib/viewMode";

const HORIZON_DAYS = 16;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Bucket = "dnes" | "zitra" | "vikend" | "pristi" | "pmonth" | "later";
const BUCKET_ORDER: Bucket[] = [
	"dnes",
	"zitra",
	"vikend",
	"pristi",
	"pmonth",
	"later",
];

const wdLong = (d: string) =>
	new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(
		new Date(`${d}T00:00:00`),
	);

/** Bucket dne (port _dayBucket, prototyp ř. 2649). */
function dayBucket(d: string, tdy: string): Bucket {
	const diff = Math.round(
		(new Date(`${d}T00:00:00`).getTime() -
			new Date(`${tdy}T00:00:00`).getTime()) /
			DAY,
	);
	if (diff <= 0) return "dnes";
	if (diff === 1) return "zitra";
	const dow = new Date(`${d}T00:00:00`).getDay();
	if (diff <= 6 && (dow === 6 || dow === 0)) return "vikend";
	if (diff <= 7) return "pristi";
	const [ty, tm] = tdy.split("-").map(Number);
	const nextY = tm === 12 ? (ty ?? 0) + 1 : ty;
	const nextM = tm === 12 ? 1 : (tm ?? 1) + 1;
	const [dy, dm, dd] = d.split("-").map(Number);
	if (dy === nextY && dm === nextM && (dd ?? 0) <= 6) return "pmonth";
	return "later";
}

/**
 * Nadcházející — buckety Dnes/Zítra/Víkend/Příští týden/Začátkem příštího měsíce/Později
 * (prototyp ř. 3048) + workspace chipy + pohledy Seznam/Nástěnka/Kalendář + projekce výskytů (R4).
 */
export function Nadchazejici() {
	const { t } = useTranslation();
	const { view } = useViewMode();
	const projects = useProjects();
	const projMap = useMemo(
		() => new Map(projects.map((p) => [p.id, p] as const)),
		[projects],
	);
	const { data: allTasks } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE due_date IS NOT NULL ORDER BY due_date",
	);
	const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
	const [wsFilter, setWsFilter] = useState<string | null>(null);
	const flowSteps = useFlowSteps();
	const { setNavIds } = useTaskDetail();
	const { q: searchQ } = useListSearch();
	// Per-výskyt výjimky (R4) — skip/done jednotlivých výskytů.
	const { data: ovr } = usePsQuery<{
		task_id: string | null;
		occ_date: string | null;
		done: number | null;
		skipped: number | null;
	}>("SELECT task_id, occ_date, done, skipped FROM task_occurrence_overrides");
	const ovrMap = useMemo(() => {
		const m = new Map<string, { done: boolean; skipped: boolean }>();
		for (const o of ovr ?? []) {
			if (o.task_id && o.occ_date)
				m.set(`${o.task_id}@${o.occ_date}`, {
					done: !!o.done,
					skipped: !!o.skipped,
				});
		}
		return m;
	}, [ovr]);

	const tbCtx = useToolbarCtx();
	const tasks = useMemo(() => {
		const tdy = todayISO();
		let list = (allTasks ?? []).filter((x) => (dayOf(x) ?? "") >= tdy);
		if (wsFilter)
			list = list.filter(
				(x) =>
					x.project_id && projMap.get(x.project_id)?.workspace_id === wsFilter,
			);
		return filterByQuery(
			sortTasks(filterTasks(list, tb, tbCtx), tb, tbCtx),
			searchQ,
		);
	}, [allTasks, tb, tbCtx, wsFilter, projMap, searchQ]);

	const view2 = useMemo(() => {
		const tdy = todayISO();
		const horizon = iso(Date.now() + HORIZON_DAYS * DAY);
		const byBucket = new Map<Bucket, TaskRow[]>();

		for (const tk of tasks) {
			const d = dayOf(tk);
			if (!d) continue;
			const b = dayBucket(d, tdy);
			const arr = byBucket.get(b);
			if (arr) arr.push(tk);
			else byBucket.set(b, [tk]);
			// Projekce výskytů opakování jako plnohodnotné klikací řádky (kromě base dne);
			// per-výskyt výjimky: skipped se nezobrazí, done se propíše (README ř. 64);
			// konec řady until/count a repeatShowAll se respektují (prototyp _recOccur).
			const rule = parseRecurrenceRule(tk.recurrence_rule);
			if (rule) {
				for (const od of expandOccurrences({
					baseISO: d,
					kind: rule.kind,
					weekday: rule.weekday,
					nth: rule.nth,
					day: rule.day,
					parity: rule.parity,
					fromISO: tdy,
					toISO: horizon,
					cap: 40,
					until: rule.until,
					count: rule.count,
					doneCount: rule.doneCount,
					showAll: rule.showAll,
				})) {
					if (od === d) continue;
					const vid = occId(tk.id, od);
					const ex = ovrMap.get(vid);
					if (ex?.skipped) continue;
					const virt: TaskRow = {
						...tk,
						id: vid,
						due_date: od,
						start_date: tk.start_date
							? `${od}T${tk.start_date.slice(11)}`
							: null,
						completed_at: ex?.done ? new Date().toISOString() : null,
					};
					const ob = dayBucket(od, tdy);
					const oArr = byBucket.get(ob) ?? [];
					oArr.push(virt);
					byBucket.set(ob, oArr);
				}
			}
		}

		const tdyLabel = `${t("nav.today")} · ${wdLong(tdy)}`;
		const tmrwLabel = `${t("today.tomorrow")} · ${wdLong(iso(Date.now() + DAY))}`;
		const labels: Record<Bucket, string> = {
			dnes: tdyLabel,
			zitra: tmrwLabel,
			vikend: t("today.weekend"),
			pristi: t("today.nextWeekBucket"),
			pmonth: t("today.pmonthBucket"),
			later: t("today.laterBucket"),
		};
		return BUCKET_ORDER.map((b) => ({
			b,
			label: labels[b],
			list: byBucket.get(b) ?? [],
		})).filter((g) => g.list.length > 0);
	}, [tasks, ovrMap, t]);

	// Pořadí pro ↑/↓ v detailu (prototyp _navIds) + kbsel navigace.
	const flatList = useMemo(() => view2.flatMap((g) => g.list), [view2]);
	useEffect(() => {
		setNavIds(flatList.map((tk) => tk.id));
	}, [flatList, setNavIds]);
	const kbSel = useKbNav(flatList, view === "list");

	const empty = view2.length === 0;

	if (view === "calendar") {
		return (
			<div className="mx-auto max-w-[1080px] px-5 py-7">
				<WorkspaceChips value={wsFilter} onChange={setWsFilter} />
				<Calendar tasks={tasks} />
			</div>
		);
	}
	if (view === "board") {
		return (
			<div className="mx-auto max-w-[1080px] px-5 py-7">
				<WorkspaceChips value={wsFilter} onChange={setWsFilter} />
				<TasksToolbar state={tb} onChange={setTb} ctx={tbCtx} />
				<Board tasks={tasks} />
			</div>
		);
	}

	return (
		<div
			className="mx-auto max-w-[1080px]"
			style={{ padding: "10px 22px 90px" }}
		>
			<WorkspaceChips value={wsFilter} onChange={setWsFilter} />
			<TasksToolbar state={tb} onChange={setTb} ctx={tbCtx} />
			{empty && (
				<p
					className="text-center font-body text-ink-3"
					style={{ padding: "80px 20px", fontSize: 13.5 }}
				>
					{t("today.emptyClean")}
				</p>
			)}

			{view2.map(({ b, label, list }) => (
				<section key={b}>
					<div
						className="flex items-center"
						style={{ gap: 10, margin: "18px 0 2px", padding: "0 4px" }}
					>
						<span
							className="font-display font-bold text-ink"
							style={{ fontSize: 13 }}
						>
							{label}
						</span>
						<span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
							{list.length}
						</span>
					</div>
					<ul>
						{list.map((tk) => (
							<div
								key={tk.id}
								data-kbsel={kbSel === tk.id || undefined}
								className="rounded-xl"
								style={
									kbSel === tk.id
										? { outline: "2px solid var(--w-brass)", outlineOffset: -1 }
										: undefined
								}
							>
								<TaskItem
									task={tk}
									project={
										tk.project_id ? projMap.get(tk.project_id) : undefined
									}
									flow={flowSteps.get(tk.id)}
								/>
							</div>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
