import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useWorkspace, useWorkspaces } from "../lib/workspace";
import { chipStyle, FilterSectionLabel, pillStyle } from "./filterUi";

export type SortBy = "smart" | "due" | "priority" | "name" | "project" | "status";
/** Normalizovaný klíč stavu (prototyp filterStatus: probiha/kontrola/''/hotovo). */
export type StatusKey = "probiha" | "kontrola" | "" | "hotovo";

export interface ToolbarState {
	priorities: number[];
	statuses: StatusKey[];
	projects: string[];
	/** "me" | "__none__" | "__multi__" | userId (prototyp filterPerson, ř. 3237). */
	people: string[];
	sortBy: SortBy;
	asc: boolean;
	showDone: boolean;
}

export const DEFAULT_TOOLBAR: ToolbarState = {
	priorities: [],
	statuses: [],
	projects: [],
	people: [],
	sortBy: "smart",
	asc: true,
	showDone: false,
};

type TaskLike = {
	id: string;
	name: string | null;
	priority: number | null;
	due_date: string | null;
	completed_at: string | null;
	project_id: string | null;
	status_id: string | null;
};

/** Kontext filtrů/řazení nad reálnými daty (stavy, projekty, přiřazení) — jeden hook pro obrazovku. */
export interface ToolbarCtx {
	statusKeyOf: (t: TaskLike) => StatusKey;
	projectNameOf: (t: TaskLike) => string;
	assigneesOf: (t: TaskLike) => string[];
	myId?: string;
	projects: { id: string; name: string; color: string | null }[];
	members: { id: string; name: string }[];
	showPersonFilter: boolean;
}

export function useToolbarCtx(): ToolbarCtx {
	const { data: session } = useSession();
	const { activeWs } = useWorkspace();
	const { data: workspaces } = useWorkspaces();
	const { data: sts } = usePsQuery<{
		id: string;
		name: string | null;
		is_done: number | null;
	}>("SELECT id, name, is_done FROM statuses");
	const { data: prj } = usePsQuery<{
		id: string;
		name: string | null;
		color: string | null;
		workspace_id: string | null;
	}>("SELECT id, name, color, workspace_id FROM projects ORDER BY name");
	const { data: asg } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");
	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as { id: string; name: string }[];
		},
	});

	return useMemo(() => {
		const stMap = new Map((sts ?? []).map((s) => [s.id, s] as const));
		const pMap = new Map((prj ?? []).map((p) => [p.id, p] as const));
		const asgMap = new Map<string, string[]>();
		for (const a of asg ?? []) {
			if (!a.task_id || !a.user_id) continue;
			asgMap.set(a.task_id, [...(asgMap.get(a.task_id) ?? []), a.user_id]);
		}
		return {
			statusKeyOf: (t) => {
				const s = t.status_id ? stMap.get(t.status_id) : undefined;
				if (!s?.name) return "";
				if (s.is_done) return "hotovo";
				const n = s.name.toLowerCase();
				if (n.includes("prob")) return "probiha";
				if (n.includes("kontrol")) return "kontrola";
				if (n.includes("hotovo")) return "hotovo";
				return "";
			},
			projectNameOf: (t) => (t.project_id ? (pMap.get(t.project_id)?.name ?? "") : ""),
			assigneesOf: (t) => asgMap.get(t.id) ?? [],
			myId: session?.user?.id,
			projects: (prj ?? [])
				.filter((p) => !activeWs || p.workspace_id === activeWs)
				.map((p) => ({ id: p.id, name: p.name ?? "", color: p.color })),
			members: team ?? [],
			showPersonFilter: !(workspaces?.find((w) => w.id === activeWs)?.isPersonal ?? false),
		};
	}, [sts, prj, asg, team, session, activeWs, workspaces]);
}

const STATUS_RANK: Record<StatusKey, number> = {
	probiha: 0,
	kontrola: 1,
	"": 2,
	hotovo: 3,
};

/** Řadicí komparátor dle toolbaru (prototyp sortFns, ř. 3015). */
export function sortTasks<T extends TaskLike>(list: T[], st: ToolbarState, ctx?: ToolbarCtx): T[] {
	const dir = st.asc ? 1 : -1;
	const byDue = (a: T, b: T) => {
		if (!a.due_date && !b.due_date) return 0;
		if (!a.due_date) return 1;
		if (!b.due_date) return -1;
		return a.due_date < b.due_date ? -1 : 1;
	};
	const cmp: Record<SortBy, (a: T, b: T) => number> = {
		smart: (a, b) => (a.priority ?? 4) - (b.priority ?? 4) || byDue(a, b),
		due: byDue,
		priority: (a, b) => (a.priority ?? 4) - (b.priority ?? 4),
		name: (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "cs"),
		project: (a, b) =>
			(ctx?.projectNameOf(a) ?? "").localeCompare(ctx?.projectNameOf(b) ?? "", "cs"),
		status: (a, b) =>
			STATUS_RANK[ctx?.statusKeyOf(a) ?? ""] - STATUS_RANK[ctx?.statusKeyOf(b) ?? ""],
	};
	return [...list].sort((a, b) => dir * cmp[st.sortBy](a, b));
}

/** Filtr dle toolbaru — priorita, stav, projekt, osoba, dokončené (prototyp ř. 3234–3237). */
export function filterTasks<T extends TaskLike>(
	list: T[],
	st: ToolbarState,
	ctx?: ToolbarCtx,
): T[] {
	return list.filter((tk) => {
		if (!st.showDone && tk.completed_at) return false;
		if (st.priorities.length > 0 && !st.priorities.includes(tk.priority ?? 4)) return false;
		if (st.statuses.length > 0 && !st.statuses.includes(ctx?.statusKeyOf(tk) ?? "")) return false;
		if (st.projects.length > 0 && !st.projects.includes(tk.project_id ?? "")) return false;
		// Osobní (soukromý) workspace nemá sekci Osoba (showPersonFilter=false) — přetrvalý filtr
		// z týmového ws pak ignoruj, jinak by tiše vyprázdnil osobní úkoly bez viditelného ovládání.
		if (st.people.length > 0 && ctx?.showPersonFilter !== false) {
			const a = ctx?.assigneesOf(tk) ?? [];
			const hit = st.people.some((p) =>
				p === "me"
					? !!ctx?.myId && a.includes(ctx.myId)
					: p === "__none__"
						? a.length === 0
						: p === "__multi__"
							? a.length >= 2
							: a.includes(p),
			);
			if (!hit) return false;
		}
		return true;
	});
}

const toggleIn = <T,>(arr: T[], v: T) =>
	arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

// Chip/pilulka/nadpis filtru jsou teď sdílené primitivy (components/filterUi) —
// jeden vzhled i ovládání i v mailu (koherence 2026-07-12).
const SectionLabel = FilterSectionLabel;

const searchInputCls =
	"w-full rounded-[7px] border border-line bg-panel-2 px-[9px] py-[5px] font-body text-ink outline-none";

/**
 * Toolbar úkolů 1:1 dle prototypu (ř. 348–391): Filtr (Priorita/Stav/Projekt/Osoba + Vymazat),
 * split-button Řazení + směr, Dokončené, aktivní filter chipy. Sdílený pro seznamové obrazovky.
 */
export function TasksToolbar({
	state,
	onChange,
	ctx,
}: {
	state: ToolbarState;
	onChange: (next: ToolbarState) => void;
	ctx: ToolbarCtx;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState<"filter" | "sort" | null>(null);
	const [projQ, setProjQ] = useState("");
	const [personQ, setPersonQ] = useState("");
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const h = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, []);
	// Esc zavře otevřený popover (dřív propadl do globálních zkratek j/k/…);
	// stopPropagation zamezí, aby Esc zároveň dělal něco ve vyšší vrstvě.
	useEffect(() => {
		if (!open) return;
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(null);
			}
		};
		document.addEventListener("keydown", h, true);
		return () => document.removeEventListener("keydown", h, true);
	}, [open]);

	const SORTS: [SortBy, string][] = [
		["smart", t("toolbar.sortSmart")],
		["due", t("toolbar.sortDue")],
		["priority", t("toolbar.sortPriority")],
		["name", t("toolbar.sortName")],
		["project", t("toolbar.sortProject")],
		["status", t("toolbar.sortStatus")],
	];
	const STATUSES: [StatusKey, string][] = [
		["probiha", t("toolbar.stProbiha")],
		["kontrola", t("toolbar.stKontrola")],
		["", t("toolbar.stNezahajeno")],
		["hotovo", t("toolbar.stHotovo")],
	];
	const personOpts: { id: string; label: string }[] = [
		{ id: "me", label: t("toolbar.personMe") },
		{ id: "__none__", label: t("toolbar.personNone") },
		{ id: "__multi__", label: t("toolbar.personMulti") },
		...ctx.members.filter((m) => m.id !== ctx.myId).map((m) => ({ id: m.id, label: m.name })),
	];
	const personLabel = (id: string) => personOpts.find((o) => o.id === id)?.label ?? id;

	const hasFilters =
		state.priorities.length + state.statuses.length + state.projects.length + state.people.length >
		0;
	const clearFilters = () =>
		onChange({
			...state,
			priorities: [],
			statuses: [],
			projects: [],
			people: [],
		});

	// Aktivní filter chipy (prototyp activeFilterChips) — každý s × pro zrušení.
	const activeChips: { key: string; label: string; onClear: () => void }[] = [
		...state.priorities.map((p) => ({
			key: `p${p}`,
			label: `P${p}`,
			onClear: () => onChange({ ...state, priorities: toggleIn(state.priorities, p) }),
		})),
		...state.statuses.map((s) => ({
			key: `s${s}`,
			label: STATUSES.find(([k]) => k === s)?.[1] ?? s,
			onClear: () => onChange({ ...state, statuses: toggleIn(state.statuses, s) }),
		})),
		...state.projects.map((id) => ({
			key: `j${id}`,
			label: ctx.projects.find((p) => p.id === id)?.name ?? id,
			onClear: () => onChange({ ...state, projects: toggleIn(state.projects, id) }),
		})),
		...state.people.map((id) => ({
			key: `o${id}`,
			label: personLabel(id),
			onClear: () => onChange({ ...state, people: toggleIn(state.people, id) }),
		})),
	];

	return (
		<div
			ref={ref}
			className="relative flex flex-wrap items-center"
			style={{ gap: 8, padding: "8px 4px 2px" }}
		>
			{/* Filtr (prototyp ř. 350) */}
			<div className="relative">
				<button
					type="button"
					onClick={() => setOpen(open === "filter" ? null : "filter")}
					className="font-display font-semibold hover:border-brass"
					style={chipStyle(hasFilters)}
				>
					<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
						<path
							d="M2 3 H12 L8 8 V12 L6 11 V8 Z"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinejoin="round"
						/>
					</svg>
					{t("toolbar.filter")}
					<span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
				</button>
				{open === "filter" && (
					<div
						data-esc-layer
						className="absolute left-0 z-[31] flex flex-col rounded-xl border border-line bg-card"
						style={{
							top: 38,
							width: 230,
							padding: 12,
							gap: 11,
							boxShadow: "var(--w-shadow)",
						}}
					>
						<div>
							<SectionLabel>{t("toolbar.priority")}</SectionLabel>
							<div className="flex flex-wrap" style={{ gap: 5 }}>
								{[1, 2, 3, 4].map((p) => (
									<button
										key={p}
										type="button"
										onClick={() =>
											onChange({
												...state,
												priorities: toggleIn(state.priorities, p),
											})
										}
										className="font-display font-semibold"
										style={pillStyle(state.priorities.includes(p))}
									>
										P{p}
									</button>
								))}
							</div>
						</div>
						<div>
							<SectionLabel>{t("toolbar.status")}</SectionLabel>
							<div className="flex flex-wrap" style={{ gap: 5 }}>
								{STATUSES.map(([k, l]) => (
									<button
										key={k || "none"}
										type="button"
										onClick={() =>
											onChange({
												...state,
												statuses: toggleIn(state.statuses, k),
											})
										}
										className="font-display font-semibold"
										style={pillStyle(state.statuses.includes(k), 11.5, "4px 10px")}
									>
										{l}
									</button>
								))}
							</div>
						</div>
						<div>
							<SectionLabel>{t("toolbar.project")}</SectionLabel>
							<input
								value={projQ}
								onChange={(e) => setProjQ(e.target.value)}
								placeholder={t("toolbar.searchProject")}
								className={searchInputCls}
								style={{ fontSize: 12, marginBottom: 6 }}
							/>
							<div className="flex flex-wrap overflow-auto" style={{ gap: 5, maxHeight: 96 }}>
								{ctx.projects
									.filter((p) => !projQ || p.name.toLowerCase().includes(projQ.toLowerCase()))
									.map((p) => (
										<button
											key={p.id}
											type="button"
											onClick={() =>
												onChange({
													...state,
													projects: toggleIn(state.projects, p.id),
												})
											}
											className="inline-flex items-center font-display font-semibold"
											style={{
												...pillStyle(state.projects.includes(p.id), 11.5, "4px 10px"),
												gap: 5,
											}}
										>
											<span
												className="shrink-0 rounded-full"
												style={{
													width: 7,
													height: 7,
													background: p.color ?? "var(--w-line)",
												}}
											/>
											{p.name}
										</button>
									))}
							</div>
						</div>
						{ctx.showPersonFilter && (
							<div>
								<SectionLabel>{t("toolbar.person")}</SectionLabel>
								<input
									value={personQ}
									onChange={(e) => setPersonQ(e.target.value)}
									placeholder={t("toolbar.searchPerson")}
									className={searchInputCls}
									style={{ fontSize: 12, marginBottom: 6 }}
								/>
								<div className="flex flex-wrap overflow-auto" style={{ gap: 5, maxHeight: 96 }}>
									{personOpts
										.filter(
											(o) => !personQ || o.label.toLowerCase().includes(personQ.toLowerCase()),
										)
										.map((o) => (
											<button
												key={o.id}
												type="button"
												onClick={() =>
													onChange({
														...state,
														people: toggleIn(state.people, o.id),
													})
												}
												className="font-display font-semibold"
												style={pillStyle(state.people.includes(o.id), 11.5, "4px 10px")}
											>
												{o.label}
											</button>
										))}
								</div>
							</div>
						)}
						{hasFilters && (
							<button
								type="button"
								onClick={clearFilters}
								className="self-start font-display font-semibold text-brass-text"
								style={{ fontSize: 12, paddingTop: 2 }}
							>
								{t("toolbar.clearFilters")}
							</button>
						)}
					</div>
				)}
			</div>

			{/* Řazení — split-button (prototyp ř. 377–383) */}
			<div className="relative flex items-center">
				<button
					type="button"
					onClick={() => setOpen(open === "sort" ? null : "sort")}
					className="font-display font-semibold hover:border-brass"
					style={chipStyle(false, "8px 0 0 8px")}
				>
					<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
						<path
							d="M4 3 V11 M9 3 V11"
							stroke="currentColor"
							strokeWidth="1.2"
							strokeLinecap="round"
						/>
					</svg>
					{SORTS.find(([k]) => k === state.sortBy)?.[1]}
					<span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
				</button>
				<button
					type="button"
					onClick={() => onChange({ ...state, asc: !state.asc })}
					title={t("toolbar.dirTitle")}
					className="font-display font-semibold hover:border-brass"
					style={{
						...chipStyle(false, "0 8px 8px 0"),
						gap: 5,
						padding: "6px 10px",
						fontSize: 11.5,
						borderLeft: "none",
					}}
				>
					{state.asc ? (
						<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
							<path
								d="M7 11.5 V2.5 M7 2.5 L3.8 5.7 M7 2.5 L10.2 5.7"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					) : (
						<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
							<path
								d="M7 2.5 V11.5 M7 11.5 L3.8 8.3 M7 11.5 L10.2 8.3"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					)}
					{state.asc ? t("toolbar.dirAsc") : t("toolbar.dirDesc")}
				</button>
				{open === "sort" && (
					<div
						data-esc-layer
						className="absolute left-0 z-[31] flex flex-col rounded-xl border border-line bg-card"
						style={{
							top: 38,
							width: 160,
							padding: 5,
							boxShadow: "var(--w-shadow)",
						}}
					>
						{SORTS.map(([k, l]) => (
							<button
								key={k}
								type="button"
								onClick={() => {
									onChange({ ...state, sortBy: k });
									setOpen(null);
								}}
								className="rounded-[7px] text-left font-display font-semibold text-ink hover:bg-panel-2"
								style={{
									padding: "7px 10px",
									fontSize: 13,
									background: state.sortBy === k ? "var(--w-brass-soft)" : undefined,
								}}
							>
								{l}
							</button>
						))}
					</div>
				)}
			</div>

			{/* Dokončené (prototyp ř. 390) */}
			<button
				type="button"
				onClick={() => onChange({ ...state, showDone: !state.showDone })}
				className="font-display font-semibold hover:border-brass"
				style={chipStyle(state.showDone)}
			>
				<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
					<path
						d="M3 7.4 L6 10 L11 4"
						stroke="currentColor"
						strokeWidth="1.4"
						fill="none"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				{t("toolbar.showDone")}
			</button>

			{/* aktivní filter chipy */}
			{activeChips.map((c) => (
				<button
					key={c.key}
					type="button"
					onClick={c.onClear}
					className="inline-flex items-center rounded-full font-display font-semibold"
					style={{
						gap: 5,
						fontSize: 11.5,
						padding: "4px 6px 4px 10px",
						background: "var(--w-brass-soft)",
						color: "var(--w-brass-text)",
					}}
				>
					{c.label}
					<span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
				</button>
			))}
		</div>
	);
}
