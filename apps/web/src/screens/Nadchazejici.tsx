import { useQuery as usePsQuery } from "@powersync/react";
import i18n, { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import { Board } from "../components/Board";
import { Calendar } from "../components/CalendarLazy";
import { DataLoading } from "../components/Loading";
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
import { useAddTask } from "../lib/addTask";
import { useFlowSteps } from "../lib/flowSteps";
import { useKbNav } from "../lib/kbNav";
import { filterByQuery, useListSearch } from "../lib/listSearch";
import { expandOccurrences, occId, parseRecurrenceRule } from "../lib/occurrences";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjectsWithState } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { dayOf, todayISO } from "../lib/tasks";
import { nextValidZonedDateTimeToIso, wallTimeFromInstant } from "../lib/timeZone";
import { useViewMode } from "../lib/viewMode";

const HORIZON_DAYS = 16;
const DAY = 86_400_000;
// Lokální datum instantu (ne UTC) — jinak se buckety/labely „Zítra" po půlnoci posunou o den.
const iso = (ms: number) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Bucket = "dnes" | "zitra" | "vikend" | "pristi" | "pmonth" | "later";
const BUCKET_ORDER: Bucket[] = ["dnes", "zitra", "vikend", "pristi", "pmonth", "later"];

const wdLong = (d: string) =>
	new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(new Date(`${d}T00:00:00`));

/** Bucket dne (port _dayBucket, prototyp ř. 2649). */
function dayBucket(d: string, tdy: string): Bucket {
	const diff = Math.round(
		(new Date(`${d}T00:00:00`).getTime() - new Date(`${tdy}T00:00:00`).getTime()) / DAY,
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
	const { openAdd } = useAddTask();
	const { view } = useViewMode();
	const { projects, isLoading: projectsLoading } = useProjectsWithState();
	const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
	const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
	const [wsFilter, setWsFilter] = useState<string | null>(null);
	// Výkon: bez „Dokončené" filtruj hotové v SQL (opakované úkoly mají completed_at vždy NULL —
	// dokončení posouvá due_date, takže se neztratí žádná řada).
	const { data: allTasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		tb.showDone
			? "SELECT * FROM tasks WHERE due_date IS NOT NULL ORDER BY due_date"
			: "SELECT * FROM tasks WHERE due_date IS NOT NULL AND completed_at IS NULL ORDER BY due_date",
	);
	// Kalendář má vlastní zdroj: NEOŘEZANÝ do budoucna (jinak zmizí minulé/zpožděné úkoly a panel
	// „Plánování → Zpožděné" je mrtvý) a nezávislý na skrytém „Dokončené" (aby šlo hotové vidět
	// a přes CalCheck zas odškrtnout). Filtruje se jen podle workspace, ne toolbarem ani hledáním.
	const { data: calAll, isLoading: calendarLoading } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE due_date IS NOT NULL ORDER BY due_date",
	);
	const flowSteps = useFlowSteps();
	const { setNavIds } = useTaskDetail();
	const { q: searchQ } = useListSearch();
	// Per-výskyt výjimky (R4) — skip/done jednotlivých výskytů.
	const { data: ovr, isLoading: overridesLoading } = usePsQuery<{
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
				(x) => x.project_id && projMap.get(x.project_id)?.workspace_id === wsFilter,
			);
		return filterByQuery(sortTasks(filterTasks(list, tb, tbCtx), tb, tbCtx), searchQ);
	}, [allTasks, tb, tbCtx, wsFilter, projMap, searchQ]);

	// Zdroj pro kalendář — jen wsFilter, bez ořezu na budoucnost, bez toolbaru/hledání.
	const calTasks = useMemo(() => {
		const list = calAll ?? [];
		return wsFilter
			? list.filter((x) => x.project_id && projMap.get(x.project_id)?.workspace_id === wsFilter)
			: list;
	}, [calAll, wsFilter, projMap]);

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
						start_date:
							tk.start_date && tk.start_timezone
								? nextValidZonedDateTimeToIso(
										od,
										wallTimeFromInstant(tk.start_date, tk.start_timezone) ?? "00:00:00",
										tk.start_timezone,
									)
								: tk.start_date
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
	if (projectsLoading || tasksLoading || calendarLoading || overridesLoading) return <DataLoading />;

	if (view === "calendar") {
		return (
			<div className="mx-auto max-w-[1080px] px-5 py-7">
				<WorkspaceChips value={wsFilter} onChange={setWsFilter} />
				<Calendar tasks={calTasks} />
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
		<div className="mx-auto max-w-[1080px]" style={{ padding: "10px 22px 90px" }}>
			<WorkspaceChips value={wsFilter} onChange={setWsFilter} />
			<TasksToolbar state={tb} onChange={setTb} ctx={tbCtx} />
			{empty && (
				<div className="text-center" style={{ padding: "80px 20px" }}>
					<p className="font-body text-ink-3" style={{ fontSize: 13.5 }}>
						{t("today.emptyClean")}
					</p>
					<button
						type="button"
						onClick={() => openAdd({ date: todayISO() })}
						className="mt-3 rounded-[9px] font-display font-bold text-white hover:brightness-105"
						style={{
							minHeight: 44,
							background: "var(--w-brass)",
							padding: "8px 14px",
							fontSize: 12.5,
						}}
					>
						+ {t("today.addTask")}
					</button>
				</div>
			)}

			{view2.map(({ b, label, list }) => (
				<section key={b}>
					<div
						className="flex items-center"
						style={{ gap: 10, margin: "18px 0 2px", padding: "0 4px" }}
					>
						<span className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
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
									project={tk.project_id ? projMap.get(tk.project_id) : undefined}
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
