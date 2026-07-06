import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { initials } from "../lib/format";
import {
	type GoalStatusKind,
	GSTAT,
	goalElapsed,
	goalProgress,
	goalStatus,
	taskOnTime,
} from "../lib/goals";
import type { GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { showToast } from "../lib/toast";
import { useWorkspace, useWorkspaces } from "../lib/workspace";

type Member = { id: string; name: string; email: string; image: string | null };
type MilestoneRow = {
	id: string;
	goal_id: string | null;
	label: string | null;
	done: number | null;
	position: number | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const PERIODIC_KEY: Record<string, string> = {
	week: "goals.perWeek",
	month: "goals.perMonth",
	quarter: "goals.perQuarter",
	year: "goals.perYear",
};

/** Krátký termín „31. 8." pro grid detailu (prototyp dueLabel, ř. 1358). */
function fmtDueShort(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
	return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

/** Šablony cílů (VERBATIM z prototypu GOAL_TEMPLATES, ř. 2324–2330) — texty přes i18n. */
const GOAL_TEMPLATES = [
	{
		id: "gtpl1",
		nameKey: "goals.tpl1Name",
		subKey: "goals.tpl1Sub",
		metric: "count",
		target: 200,
		periodic: "quarter",
		scope: "team",
		keyword: "",
	},
	{
		id: "gtpl2",
		nameKey: "goals.tpl2Name",
		subKey: "goals.tpl2Sub",
		metric: "ontime",
		target: 90,
		periodic: "none",
		scope: "team",
		keyword: "",
	},
	{
		id: "gtpl3",
		nameKey: "goals.tpl3Name",
		subKey: "goals.tpl3Sub",
		metric: "ontime",
		target: 95,
		periodic: "none",
		scope: "person",
		keyword: "faktur",
	},
	{
		id: "gtpl4",
		nameKey: "goals.tpl4Name",
		subKey: "goals.tpl4Sub",
		metric: "ontime",
		target: 90,
		periodic: "none",
		scope: "person",
		keyword: "docház",
	},
	{
		id: "gtpl5",
		nameKey: "goals.tpl5Name",
		subKey: "goals.tpl5Sub",
		metric: "count",
		target: 20,
		periodic: "week",
		scope: "personal",
		keyword: "",
	},
	{
		id: "gtpl6",
		nameKey: "goals.tpl6Name",
		subKey: "goals.tpl6Sub",
		metric: "project",
		target: 100,
		periodic: "none",
		scope: "project",
		keyword: "",
	},
] as const;

/** Scope label hlavičky detailu (prototyp ř. 3204). */
const SCOPE_LABEL_KEY: Record<string, string> = {
	team: "goals.scopeLabelTeam",
	project: "goals.scopeLabelProject",
	person: "goals.scopeLabelPerson",
	personal: "goals.scopeLabelPersonal",
};

/** Cíle — taby dle scope, karty s progresem z reálných úkolů, builder + detail (1:1 dle Cloud Design). */
export function Cile() {
	const { t } = useTranslation();
	const projects = useProjects();
	const { data: workspaces } = useWorkspaces();
	const { activeWs } = useWorkspace();
	const wsP = workspaces?.find((w) => w.id === activeWs)?.isPersonal ?? false;

	const [tab, setTab] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const { data: goals } = usePsQuery<GoalRow>(
		"SELECT * FROM goals WHERE workspace_id = ? ORDER BY created_at",
		[activeWs ?? ""],
	);
	const { data: goalProjects } = usePsQuery<{
		goal_id: string | null;
		project_id: string | null;
	}>("SELECT goal_id, project_id FROM goal_projects");
	const { data: milestones } = usePsQuery<MilestoneRow>(
		"SELECT id, goal_id, label, done, position FROM goal_milestones ORDER BY position, created_at",
	);
	const { data: tasks } = usePsQuery<TaskRow>(
		"SELECT id, name, project_id, completed_at, due_date FROM tasks",
	);
	const { data: assignments } = usePsQuery<{
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
			return (await r.json()).members as Member[];
		},
	});
	const members = team ?? [];
	const memberName = (id: string | null) =>
		members.find((m) => m.id === id)?.name ?? "";

	const wsProjectIds = useMemo(
		() =>
			new Set(
				projects.filter((p) => p.workspace_id === activeWs).map((p) => p.id),
			),
		[projects, activeWs],
	);
	const linksByGoal = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const gp of goalProjects ?? []) {
			if (!gp.goal_id || !gp.project_id) continue;
			const arr = m.get(gp.goal_id) ?? [];
			arr.push(gp.project_id);
			m.set(gp.goal_id, arr);
		}
		return m;
	}, [goalProjects]);
	const assigneesByTask = useMemo(() => {
		const m = new Map<string, Set<string>>();
		for (const a of assignments ?? []) {
			if (!a.task_id || !a.user_id) continue;
			const s = m.get(a.task_id) ?? new Set();
			s.add(a.user_id);
			m.set(a.task_id, s);
		}
		return m;
	}, [assignments]);

	/** Úkoly odpovídající cíli: prostor ∩ projekty ∩ člověk ∩ klíčové slovo (prototyp goalTasks, ř. 2360). */
	const goalTasks = useMemo(() => {
		return (g: GoalRow): TaskRow[] => {
			const links = linksByGoal.get(g.id) ?? [];
			const linkSet = new Set(links);
			// fPerson — explicitní filtr; u scope=person fallback na vlastníka (prototyp createGoal ř. 2345 dosazuje fPerson=owner).
			const person =
				g.filter_person_id || (g.scope === "person" ? g.owner_id : null);
			const kw = (g.filter_keyword ?? "").trim().toLowerCase();
			// Periodická obnova: úkoly dokončené před začátkem běžícího období se nepočítají (resetGoalPeriod, ř. 2346).
			const ps = g.period_start ? g.period_start.slice(0, 10) : null;
			return (tasks ?? []).filter((tk) => {
				if (!tk.project_id || !wsProjectIds.has(tk.project_id)) return false;
				if (links.length > 0 && !linkSet.has(tk.project_id)) return false;
				if (person && !assigneesByTask.get(tk.id)?.has(person)) return false;
				if (kw && !(tk.name ?? "").toLowerCase().includes(kw)) return false;
				if (ps && tk.completed_at && tk.completed_at.slice(0, 10) < ps)
					return false;
				return true;
			});
		};
	}, [tasks, wsProjectIds, linksByGoal, assigneesByTask]);

	/** Karta cíle — progres + stav. */
	const view = useMemo(() => {
		const tdy = todayISO();
		return (goals ?? []).map((g) => {
			const ts = goalTasks(g);
			let projectPct: { pct: number; count: number } | undefined;
			if (g.metric === "project") {
				const ids = linksByGoal.get(g.id) ?? [];
				let w = 0;
				let p = 0;
				for (const pid of ids) {
					const pts = (tasks ?? []).filter((tk) => tk.project_id === pid);
					const done = pts.filter((tk) => tk.completed_at).length;
					const pct = pts.length ? Math.round((done / pts.length) * 100) : 0;
					w += pts.length;
					p += pct * pts.length;
				}
				projectPct = { pct: w ? Math.round(p / w) : 0, count: ids.length };
			}
			const pr = goalProgress(
				g.metric ?? "completion",
				ts,
				g.target ?? 0,
				projectPct,
			);
			const overdue = !!g.due_date && g.due_date.slice(0, 10) < tdy;
			const elapsed = goalElapsed(g.created_at, g.due_date, tdy);
			const st = goalStatus(pr.pct, elapsed, overdue, false);
			// Napojené projekty s vlastním % dokončení — pro pill na kartě i progress bary v detailu (prototyp ř. 3203).
			const links = (linksByGoal.get(g.id) ?? [])
				.map((pid) => {
					const p = projects.find((pp) => pp.id === pid);
					if (!p) return undefined;
					const pts = (tasks ?? []).filter((tk) => tk.project_id === pid);
					const done = pts.filter((tk) => tk.completed_at).length;
					return {
						id: p.id,
						name: p.name,
						color: p.color,
						pct: pts.length ? Math.round((done / pts.length) * 100) : 0,
					};
				})
				.filter(Boolean);
			return { g, pr, st, elapsed, overdue, links };
		});
	}, [goals, goalTasks, linksByGoal, tasks, projects]);

	const tabs: [string, string][] = wsP
		? [["personal", t("goals.tabPersonal")]]
		: [
				["team", t("goals.tabTeam")],
				["project", t("goals.tabProject")],
				["person", t("goals.tabPerson")],
			];
	const activeTab =
		tab && tabs.some(([k]) => k === tab) ? tab : (tabs[0]?.[0] ?? "team");
	const shown = wsP
		? view
		: view.filter((v) => (v.g.scope ?? "team") === activeTab);
	const tabCount = (k: string) =>
		wsP ? view.length : view.filter((v) => (v.g.scope ?? "team") === k).length;

	const selected = view.find((v) => v.g.id === selectedId) ?? null;

	return (
		<div
			className="mx-auto max-w-[1080px]"
			style={{ padding: "20px 22px 90px" }}
		>
			{/* taby + Nový cíl */}
			<div className="mb-4 flex flex-wrap items-center" style={{ gap: 14 }}>
				<div
					className="inline-flex rounded-[10px] border border-line bg-panel-2"
					style={{ padding: 3 }}
				>
					{tabs.map(([k, l]) => (
						<button
							key={k}
							type="button"
							onClick={() => {
								setTab(k);
								setSelectedId(null);
							}}
							className="inline-flex items-center gap-1.5 rounded-[7px] font-display font-semibold"
							style={{
								fontSize: 13,
								padding: "6px 14px",
								background: k === activeTab ? "var(--w-card)" : "transparent",
								color: k === activeTab ? "var(--w-ink)" : "var(--w-ink-3)",
							}}
						>
							{l}
							<span
								className="font-mono"
								style={{ fontSize: 11, opacity: 0.7 }}
							>
								{tabCount(k)}
							</span>
						</button>
					))}
				</div>
				<button
					type="button"
					onClick={() => setModalOpen(true)}
					className="ml-auto inline-flex items-center gap-1.5 rounded-[10px] font-display font-semibold text-white hover:brightness-105"
					style={{
						background: "var(--w-brass)",
						padding: "9px 15px",
						fontSize: 13,
					}}
				>
					<span style={{ fontSize: 16, lineHeight: 1 }}>+</span>{" "}
					{t("goals.newGoal")}
				</button>
			</div>

			{shown.length === 0 ? (
				<div className="text-center" style={{ padding: "60px 20px" }}>
					<div className="font-body text-ink-3" style={{ fontSize: 14 }}>
						{t("goals.empty")}
					</div>
					<button
						type="button"
						onClick={() => setModalOpen(true)}
						className="mt-3.5 rounded-[10px] font-display font-bold text-white hover:brightness-105"
						style={{
							background: "var(--w-brass)",
							padding: "9px 16px",
							fontSize: 13,
						}}
					>
						+ {t("goals.newGoal")}
					</button>
				</div>
			) : (
				<div
					className="grid gap-3.5"
					style={{
						gridTemplateColumns:
							"repeat(auto-fill, minmax(min(330px,100%), 1fr))",
					}}
				>
					{shown.map(({ g, pr, st, links }) => (
						<button
							key={g.id}
							type="button"
							onClick={() => setSelectedId(g.id)}
							className="flex flex-col rounded-2xl border border-line bg-card text-left transition-shadow hover:shadow-md"
							style={{ padding: 18, boxShadow: "var(--w-shadow-sm)" }}
						>
							<div className="flex items-start gap-2.5">
								<span
									className="flex-1 font-display font-bold text-ink"
									style={{ fontSize: 15.5, lineHeight: 1.25 }}
								>
									{g.name}
								</span>
								<StatusBadge st={st} />
							</div>
							<div className="mt-4 flex items-baseline justify-between gap-2.5">
								<span className="font-mono text-ink-2" style={{ fontSize: 13 }}>
									{pr.label}
								</span>
								<span
									className="whitespace-nowrap font-display font-bold text-ink"
									style={{ fontSize: 18 }}
								>
									{pr.pct}&nbsp;%
								</span>
							</div>
							<div
								className="mt-2 overflow-hidden rounded-full bg-panel-2"
								style={{ height: 8 }}
							>
								<div
									style={{
										height: "100%",
										width: `${Math.min(100, pr.pct)}%`,
										background: GSTAT[st][3],
									}}
								/>
							</div>
							<div className="mt-3.5 flex items-center gap-2">
								<span
									title={memberName(g.owner_id)}
									className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white"
									style={{
										width: 24,
										height: 24,
										background: "var(--w-avatar)",
										fontSize: 10,
									}}
								>
									{initials(memberName(g.owner_id) || "?")}
								</span>
								{links.map(
									(p) =>
										p && (
											<span
												key={p.id}
												className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 font-body text-ink-3"
												style={{ fontSize: 11.5, padding: "3px 9px" }}
											>
												<span
													className="rounded-full"
													style={{
														width: 7,
														height: 7,
														background: p.color ?? "var(--w-line)",
													}}
												/>
												{p.name}
											</span>
										),
								)}
								<span className="ml-auto inline-flex items-center gap-2">
									{g.periodic && g.periodic !== "none" && (
										<span
											className="inline-flex items-center gap-0.5 font-display font-semibold text-brass-text"
											style={{ fontSize: 10 }}
										>
											↻ {t(PERIODIC_KEY[g.periodic] ?? "goals.perNone")}
										</span>
									)}
									{/* Období vpravo dole — mono 11px (prototyp ř. 763) */}
									<span
										className="font-mono text-ink-3"
										style={{ fontSize: 11 }}
									>
										{g.period ?? ""}
									</span>
								</span>
							</div>
						</button>
					))}
				</div>
			)}

			{modalOpen && activeWs && (
				<GoalModal
					workspaceId={activeWs}
					personal={wsP}
					defaultScope={wsP ? "personal" : activeTab}
					members={members}
					projects={projects.filter((p) => p.workspace_id === activeWs)}
					onClose={() => setModalOpen(false)}
				/>
			)}

			{selected && (
				<GoalDetail
					key={selected.g.id}
					data={selected}
					milestones={(milestones ?? []).filter(
						(m) => m.goal_id === selected.g.id,
					)}
					ownerName={memberName(selected.g.owner_id)}
					filterPersonName={memberName(selected.g.filter_person_id)}
					sampleTasks={goalTasks(selected.g)}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</div>
	);
}

function StatusBadge({ st }: { st: GoalStatusKind }) {
	const { t } = useTranslation();
	const [, bg, color, dot] = GSTAT[st];
	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-full font-display font-semibold"
			style={{ fontSize: 11, padding: "3px 10px", background: bg, color }}
		>
			<span
				className="rounded-full"
				style={{ width: 6, height: 6, background: dot }}
			/>
			{t(`goals.gstat${st[0]?.toUpperCase()}${st.slice(1)}`)}
		</span>
	);
}

/** Builder „Nový cíl" — scope/metrika/projekt/target/vlastník/termín/opakování → INSERT přes PowerSync. */
function GoalModal({
	workspaceId,
	personal,
	defaultScope,
	members,
	projects,
	onClose,
}: {
	workspaceId: string;
	personal: boolean;
	defaultScope: string;
	members: Member[];
	projects: { id: string; name: string | null }[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [scope, setScope] = useState(defaultScope);
	const [metric, setMetric] = useState("count");
	const [projectId, setProjectId] = useState("");
	const [personId, setPersonId] = useState("");
	const [keyword, setKeyword] = useState("");
	const [target, setTarget] = useState("");
	const [ownerId, setOwnerId] = useState(members[0]?.id ?? "");
	const [period, setPeriod] = useState("");
	const [due, setDue] = useState("");
	const [periodic, setPeriodic] = useState("none");
	const [tpl, setTpl] = useState<string | null>(null);

	/** Předvyplnění ze šablony (prototyp pickGoalTemplate, ř. 2344). */
	const pickTemplate = (tp: (typeof GOAL_TEMPLATES)[number]) => {
		setTpl(tp.id);
		setName(t(tp.nameKey));
		setMetric(tp.metric);
		setPeriodic(tp.periodic);
		setKeyword(tp.keyword);
		setProjectId("");
		setPersonId("");
		setTarget(String(tp.target));
		// Vědomý odklon od prototypu: scope "personal" v týmovém prostoru nemá tab (cíl by zmizel) → mapujeme na "person".
		if (!personal) setScope(tp.scope === "personal" ? "person" : tp.scope);
	};

	// Esc zavře builder; vlastník se dosadí, jakmile dorazí členové prostoru.
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);
	useEffect(() => {
		if (!ownerId && members[0]) setOwnerId(members[0].id);
	}, [members, ownerId]);

	const HELP: Record<string, string> = {
		completion: t("goals.helpCompletion"),
		ontime: t("goals.helpOntime"),
		count: t("goals.helpCount"),
		project: t("goals.helpProject"),
	};

	const create = async () => {
		const nm = name.trim();
		if (!nm) return onClose();
		const gid = crypto.randomUUID();
		const tgt =
			Number.parseInt(target, 10) ||
			(metric === "count" ? 10 : metric === "project" ? 100 : 90);
		// scope=person bez vybraného člověka → měří se vlastník (prototyp createGoal, ř. 2345)
		const fPerson = personId || (scope === "person" ? ownerId : "");
		await powerSync.execute(
			"INSERT INTO goals (id, workspace_id, name, scope, metric, target, due_date, period, periodic, filter_person_id, filter_keyword, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				gid,
				workspaceId,
				nm,
				scope,
				metric,
				tgt,
				due || null,
				period.trim() || null,
				periodic,
				fPerson || null,
				keyword.trim() || null,
				ownerId || null,
				new Date().toISOString(),
			],
		);
		if (projectId) {
			await powerSync.execute(
				"INSERT INTO goal_projects (id, goal_id, project_id, workspace_id) VALUES (uuid(), ?, ?, ?)",
				[gid, projectId, workspaceId],
			);
		}
		onClose();
	};

	const seg = (on: boolean) => ({
		fontSize: 12.5,
		padding: "7px 13px",
		borderRadius: 9,
		background: on ? "var(--w-card)" : "transparent",
		color: on ? "var(--w-ink)" : "var(--w-ink-3)",
	});

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.42)", zIndex: 50 }}
			/>
			<div
				className="pointer-events-none fixed inset-0 flex items-start justify-center"
				style={{ zIndex: 51, paddingTop: "9vh" }}
			>
				<div
					className="pointer-events-auto max-h-[84vh] overflow-auto rounded-2xl border border-line bg-card"
					style={{
						width: 560,
						maxWidth: "94vw",
						boxShadow: "var(--w-shadow)",
						padding: "18px 20px",
					}}
				>
					<div className="mb-3 flex items-center gap-2.5">
						<span
							className="flex-1 font-display font-bold text-ink"
							style={{ fontSize: 16 }}
						>
							{t("goals.newGoal")}
						</span>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("common.cancel")}
							className="grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
						>
							<Icon name="zavrit" size={15} />
						</button>
					</div>

					<input
						// biome-ignore lint/a11y/noAutofocus: builder modal
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("goals.namePlaceholder")}
						className="w-full rounded-[10px] border border-line bg-panel-2 font-display font-semibold text-ink outline-none focus:border-brass"
						style={{ padding: "12px 13px", fontSize: 15 }}
					/>

					{/* Začít ze šablony — 6 karet 2×3 (prototyp ř. 1423–1432 + GOAL_TEMPLATES ř. 2324–2330) */}
					<FieldLabel>{t("goals.startFromTemplate")}</FieldLabel>
					<div
						className="grid"
						style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}
					>
						{GOAL_TEMPLATES.map((tp) => {
							const on = tpl === tp.id;
							return (
								<button
									key={tp.id}
									type="button"
									onClick={() => pickTemplate(tp)}
									className={`rounded-[11px] border text-left ${
										on
											? "border-brass bg-brass-soft"
											: "border-line bg-panel-2 hover:border-brass"
									}`}
									style={{ padding: "10px 12px" }}
								>
									<div
										className="font-display font-bold text-ink"
										style={{ fontSize: 12.5 }}
									>
										{t(tp.nameKey)}
									</div>
									<div
										className="font-body text-ink-3"
										style={{ fontSize: 11, marginTop: 2 }}
									>
										{t(tp.subKey)}
									</div>
								</button>
							);
						})}
					</div>

					{!personal && (
						<>
							<FieldLabel>{t("goals.goalType")}</FieldLabel>
							<div
								className="inline-flex rounded-[10px] border border-line bg-panel-2"
								style={{ padding: 3 }}
							>
								{(
									[
										["team", t("goals.scopeTeam")],
										["project", t("goals.scopeProject")],
										["person", t("goals.scopePerson")],
									] as const
								).map(([k, l]) => (
									<button
										key={k}
										type="button"
										onClick={() => setScope(k)}
										className="font-display font-semibold"
										style={seg(scope === k)}
									>
										{l}
									</button>
								))}
							</div>
						</>
					)}

					<FieldLabel>{t("goals.metricHow")}</FieldLabel>
					<div
						className="inline-flex flex-wrap rounded-[10px] border border-line bg-panel-2"
						style={{ padding: 3 }}
					>
						{(
							[
								["completion", t("goals.metricCompletion")],
								["ontime", t("goals.metricOntime")],
								["count", t("goals.metricCount")],
								["project", t("goals.metricProject")],
							] as const
						).map(([k, l]) => (
							<button
								key={k}
								type="button"
								onClick={() => setMetric(k)}
								className="font-display font-semibold"
								style={seg(metric === k)}
							>
								{l}
							</button>
						))}
					</div>
					<p
						className="mt-2 font-body text-ink-3"
						style={{ fontSize: 12, lineHeight: 1.45 }}
					>
						{HELP[metric]}
					</p>

					{/* Co se počítá — které úkoly cíl měří (prototyp ř. 1441–1453) */}
					<FieldLabel>
						{t("goals.whatCounts")}{" "}
						<span
							className="font-semibold normal-case"
							style={{ letterSpacing: 0 }}
						>
							{t("goals.whatCountsHint")}
						</span>
					</FieldLabel>
					<div className="flex flex-wrap" style={{ gap: 10 }}>
						<div style={{ flex: 1, minWidth: 150 }}>
							<SubLabel>{t("goals.project")}</SubLabel>
							<select
								value={projectId}
								onChange={(e) => setProjectId(e.target.value)}
								className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none"
								style={{ padding: "9px 11px", fontSize: 13 }}
							>
								<option value="">{t("goals.wholeWorkspace")}</option>
								{projects.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
						{metric !== "project" && (
							<div style={{ flex: 1, minWidth: 150 }}>
								{/* Měřený člen (scope=person) / Člověk volitelně (prototyp ř. 1446) */}
								<SubLabel>
									{scope === "person"
										? t("goals.personMeasured")
										: t("goals.personOptional")}
								</SubLabel>
								<select
									value={personId}
									onChange={(e) => setPersonId(e.target.value)}
									className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none"
									style={{ padding: "9px 11px", fontSize: 13 }}
								>
									<option value="">{t("goals.anyone")}</option>
									{members.map((m) => (
										<option key={m.id} value={m.id}>
											{m.name}
										</option>
									))}
								</select>
							</div>
						)}
					</div>
					{metric !== "project" && (
						<div
							className="flex flex-wrap items-end"
							style={{ gap: 10, marginTop: 10 }}
						>
							<div style={{ flex: 1, minWidth: 150 }}>
								{/* Klíčové slovo v názvu (prototyp ř. 1450) */}
								<SubLabel>{t("goals.keyword")}</SubLabel>
								<input
									value={keyword}
									onChange={(e) => setKeyword(e.target.value)}
									placeholder={t("goals.keywordPlaceholder")}
									className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none focus:border-brass"
									style={{ padding: "9px 11px", fontSize: 13 }}
								/>
							</div>
							<div style={{ width: 150 }}>
								<SubLabel>{t("goals.target")}</SubLabel>
								<div
									className="flex items-center gap-1.5 rounded-[9px] border border-line bg-panel-2"
									style={{ padding: "8px 11px" }}
								>
									<input
										type="number"
										value={target}
										onChange={(e) => setTarget(e.target.value)}
										className="w-full border-none bg-transparent font-mono text-ink outline-none"
										style={{ fontSize: 14 }}
									/>
									<span
										className="shrink-0 font-mono text-ink-3"
										style={{ fontSize: 12 }}
									>
										{metric === "count" ? t("goals.targetUnitTasks") : "%"}
									</span>
								</div>
							</div>
						</div>
					)}

					{/* Vlastník / Období / Termín (prototyp ř. 1455–1459) */}
					<div className="mt-4 flex flex-wrap" style={{ gap: 10 }}>
						<div style={{ flex: 1, minWidth: 150 }}>
							<FieldLabel>{t("goals.owner")}</FieldLabel>
							<select
								value={ownerId}
								onChange={(e) => setOwnerId(e.target.value)}
								className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none"
								style={{ padding: "9px 11px", fontSize: 13 }}
							>
								{members.map((m) => (
									<option key={m.id} value={m.id}>
										{m.name}
									</option>
								))}
							</select>
						</div>
						<div style={{ width: 120 }}>
							<FieldLabel>{t("goals.period")}</FieldLabel>
							<input
								value={period}
								onChange={(e) => setPeriod(e.target.value)}
								placeholder={t("goals.periodPlaceholder")}
								className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none focus:border-brass"
								style={{ padding: "9px 11px", fontSize: 13 }}
							/>
						</div>
						<div style={{ width: 140 }}>
							<FieldLabel>{t("goals.due")}</FieldLabel>
							<input
								type="date"
								value={due}
								onChange={(e) => setDue(e.target.value)}
								className="w-full rounded-[9px] border border-line bg-panel-2 font-mono text-ink outline-none"
								style={{ padding: "9px 11px", fontSize: 13 }}
							/>
						</div>
					</div>

					<FieldLabel>
						{t("goals.periodic")}{" "}
						<span
							className="font-semibold normal-case"
							style={{ letterSpacing: 0 }}
						>
							{t("goals.periodicHint")}
						</span>
					</FieldLabel>
					<div
						className="inline-flex flex-wrap rounded-[10px] border border-line bg-panel-2"
						style={{ padding: 3 }}
					>
						{(
							[
								["none", t("goals.perNone")],
								["week", t("goals.perWeek")],
								["month", t("goals.perMonth")],
								["quarter", t("goals.perQuarter")],
								["year", t("goals.perYear")],
							] as const
						).map(([k, l]) => (
							<button
								key={k}
								type="button"
								onClick={() => setPeriodic(k)}
								className="font-display font-semibold"
								style={seg(periodic === k)}
							>
								{l}
							</button>
						))}
					</div>

					<div className="mt-4 flex items-center gap-2.5 border-line border-t pt-3.5">
						{/* „Cíl se založí v aktivním prostoru" (prototyp ř. 1477) */}
						<span className="font-body text-ink-3" style={{ fontSize: 12 }}>
							{t("goals.createdInWs")}
						</span>
						<button
							type="button"
							onClick={onClose}
							className="ml-auto rounded-[9px] border border-line font-display font-semibold text-ink-2 hover:border-ink-3"
							style={{ padding: "9px 15px", fontSize: 13 }}
						>
							{t("goals.cancel")}
						</button>
						<button
							type="button"
							onClick={() => void create()}
							disabled={!name.trim()}
							className="rounded-[9px] font-display font-bold text-white hover:brightness-105 disabled:opacity-50"
							style={{
								background: "var(--w-brass)",
								padding: "9px 17px",
								fontSize: 13,
							}}
						>
							{t("goals.create")}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

function FieldLabel({ children }: { children: ReactNode }) {
	return (
		<div
			className="mt-3.5 mb-1.5 font-display font-bold text-ink-3 uppercase"
			style={{ fontSize: 10.5, letterSpacing: ".05em" }}
		>
			{children}
		</div>
	);
}

/** Malý popisek polí sekce „Co se počítá" (prototyp ř. 1445: font 10, weight 600, bez verzálek). */
function SubLabel({ children }: { children: ReactNode }) {
	return (
		<div
			className="font-display font-semibold text-ink-3"
			style={{ fontSize: 10, marginBottom: 4 }}
		>
			{children}
		</div>
	);
}

/** Detail cíle — pravý panel: scope hlavička, editovatelný název, progress ring, tempo, měření, období, obnova, milníky. */
function GoalDetail({
	data,
	milestones,
	ownerName,
	filterPersonName,
	sampleTasks,
	onClose,
}: {
	data: {
		g: GoalRow;
		pr: ReturnType<typeof goalProgress>;
		st: GoalStatusKind;
		elapsed: number;
		links: (
			| { id: string; name: string | null; color: string | null; pct: number }
			| undefined
		)[];
	};
	milestones: MilestoneRow[];
	ownerName: string;
	/** Jméno měřeného člověka (filter_person_id) pro popisek hledáčku. */
	filterPersonName: string;
	/** Úkoly v hledáčku cíle (prototyp sampleTasks, ř. 3204). */
	sampleTasks: TaskRow[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const taskDetail = useTaskDetail();
	const { g, pr, st, elapsed, links } = data;
	const [msText, setMsText] = useState("");
	// Editovatelný název (prototyp onGoalName, ř. 2354) — remount přes key={g.id} v rodiči.
	const [nameDraft, setNameDraft] = useState(g.name ?? "");
	const metric = (g.metric ?? "completion") as
		| "completion"
		| "ontime"
		| "count"
		| "project";
	const metricLabel = t(
		`goals.metric${metric[0]?.toUpperCase()}${metric.slice(1)}`,
	);
	const metricHelp = t(
		`goals.help${metric[0]?.toUpperCase()}${metric.slice(1)}`,
	);
	// Popisek hledáčku: projekty · člověk · „klíčové slovo" (prototyp goalFilterLabel, ř. 2361)
	const filterParts: string[] = [];
	if (links.length > 0)
		filterParts.push(links.map((p) => p?.name ?? "").join(" · "));
	if (filterPersonName) filterParts.push(filterPersonName);
	if (g.filter_keyword) filterParts.push(`„${g.filter_keyword}“`);
	const filterLabel =
		filterParts.length > 0 ? filterParts.join(" · ") : t("goals.filterWhole");
	const canTarget = metric !== "project";

	const onName = (v: string) => {
		setNameDraft(v);
		if (v.trim())
			void powerSync.execute("UPDATE goals SET name = ? WHERE id = ?", [
				v.trim(),
				g.id,
			]);
	};
	/** Obnova období: posun period_start na dnešek → hotové úkoly před ním se přestanou počítat (prototyp resetGoalPeriod, ř. 2346). */
	const resetPeriod = () => {
		void powerSync.execute("UPDATE goals SET period_start = ? WHERE id = ?", [
			new Date().toISOString(),
			g.id,
		]);
		showToast(t("goals.periodResetDone"));
	};
	// Krok a strop dle metriky (prototyp adjGoalTarget, ř. 2352: count ±5 / % ±1; max 100000 / 100).
	const adjTarget = (dir: number) => {
		const step = metric === "count" ? 5 : 1;
		const max = metric === "count" ? 100000 : 100;
		void powerSync.execute("UPDATE goals SET target = ? WHERE id = ?", [
			Math.max(1, Math.min(max, (g.target ?? 0) + dir * step)),
			g.id,
		]);
	};

	const pace =
		pr.pct >= 100
			? t("goals.paceDone")
			: st === "risk"
				? t("goals.paceRisk", { pct: pr.pct, elapsed })
				: st === "over"
					? t("goals.paceOver")
					: t("goals.paceTrack");

	const addMilestone = async () => {
		if (!msText.trim() || !g.workspace_id) return;
		await powerSync.execute(
			"INSERT INTO goal_milestones (id, goal_id, workspace_id, label, done, position, created_at) VALUES (uuid(), ?, ?, ?, 0, ?, ?)",
			[
				g.id,
				g.workspace_id,
				msText.trim(),
				milestones.length,
				new Date().toISOString(),
			],
		);
		setMsText("");
	};
	const toggleMs = (m: MilestoneRow) =>
		void powerSync.execute("UPDATE goal_milestones SET done = ? WHERE id = ?", [
			m.done ? 0 : 1,
			m.id,
		]);
	const remove = async () => {
		await powerSync.execute("DELETE FROM goal_milestones WHERE goal_id = ?", [
			g.id,
		]);
		await powerSync.execute("DELETE FROM goal_projects WHERE goal_id = ?", [
			g.id,
		]);
		await powerSync.execute("DELETE FROM goals WHERE id = ?", [g.id]);
		onClose();
	};

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0 z-30 bg-navy/20"
			/>
			<aside
				className="fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col overflow-y-auto bg-card"
				style={{ boxShadow: "var(--w-shadow)" }}
			>
				{/* Hlavička se scope labelem (prototyp ř. 1294–1297) */}
				<div
					className="flex items-center gap-2.5 border-line border-b"
					style={{ padding: "15px 18px" }}
				>
					<span
						className="flex-1 font-display font-bold text-ink-3 uppercase"
						style={{ fontSize: 11, letterSpacing: ".06em" }}
					>
						{t(SCOPE_LABEL_KEY[g.scope ?? "team"] ?? "goals.scopeLabelTeam")}
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.cancel")}
						className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
					>
						<Icon name="zavrit" size={16} />
					</button>
				</div>

				<div className="flex-1" style={{ padding: 20 }}>
					{/* Editovatelný název bez rámečku (prototyp ř. 1299 + onGoalName ř. 2354) */}
					<input
						value={nameDraft}
						onChange={(e) => onName(e.target.value)}
						aria-label={t("goals.namePlaceholder")}
						className="w-full border-none bg-transparent font-display text-ink outline-none"
						style={{
							fontWeight: 800,
							fontSize: 21,
							lineHeight: 1.2,
							padding: 0,
						}}
					/>

					{/* Progress ring 76px + badge + hodnota (prototyp ř. 1301–1310) */}
					<div className="flex items-center" style={{ gap: 18, marginTop: 18 }}>
						<span className="relative inline-flex flex-none items-center justify-center">
							<ProgressRing pct={pr.pct} color={GSTAT[st][3]} />
							<span
								className="absolute font-display text-ink"
								style={{ fontWeight: 800, fontSize: 17 }}
							>
								{pr.pct}%
							</span>
						</span>
						<div className="min-w-0 flex-1">
							<StatusBadge st={st} />
							<div
								className="font-mono text-ink-2"
								style={{ fontSize: 14, marginTop: 9 }}
							>
								{pr.label}
							</div>
						</div>
					</div>

					{/* Tempo — panel-2 box s brass kosočtvercem (prototyp ř. 1313–1316) */}
					<div
						className="flex rounded-[12px] bg-panel-2"
						style={{ gap: 9, marginTop: 16, padding: "12px 14px" }}
					>
						<span
							className="flex-none"
							style={{
								width: 6,
								height: 6,
								transform: "rotate(45deg)",
								background: "var(--w-brass)",
								marginTop: 6,
							}}
						/>
						<div
							className="font-body text-ink-2"
							style={{ fontSize: 13, lineHeight: 1.45 }}
						>
							{pace}
						</div>
					</div>

					{/* Jak se měří (prototyp ř. 1317–1328) */}
					<div className="mt-4 border-line border-t pt-3">
						<div
							className="font-display font-bold text-ink-3 uppercase"
							style={{ fontSize: 11, letterSpacing: ".06em", marginBottom: 7 }}
						>
							{t("goals.howMeasured")}
						</div>
						<div className="flex flex-wrap items-center" style={{ gap: 8 }}>
							<span
								className="border border-line bg-panel-2 font-display font-semibold"
								style={{
									fontSize: 11,
									color: "var(--w-ink-2)",
									borderRadius: 999,
									padding: "2px 10px",
								}}
							>
								{metricLabel}
							</span>
							{canTarget && (
								<span className="inline-flex items-center" style={{ gap: 4 }}>
									<button
										type="button"
										onClick={() => adjTarget(-1)}
										className="grid cursor-pointer place-items-center rounded-[7px] border border-line font-display font-bold text-ink-2 hover:border-brass"
										style={{ width: 22, height: 22, fontSize: 13 }}
									>
										−
									</button>
									<span
										className="font-mono text-ink"
										style={{ fontSize: 12.5 }}
									>
										{g.target ?? 0}
										{metric === "count" ? "" : " %"}
									</span>
									<button
										type="button"
										onClick={() => adjTarget(1)}
										className="grid cursor-pointer place-items-center rounded-[7px] border border-line font-display font-bold text-ink-2 hover:border-brass"
										style={{ width: 22, height: 22, fontSize: 13 }}
									>
										+
									</button>
								</span>
							)}
						</div>
						<p
							className="mt-1.5 font-body text-ink-3"
							style={{ fontSize: 12.5, lineHeight: 1.5 }}
						>
							{metricHelp}
						</p>
						<div
							className="mt-2 flex items-baseline rounded-[12px] bg-panel-2"
							style={{ gap: 8, padding: "9px 12px" }}
						>
							<span className="font-mono text-ink" style={{ fontSize: 13 }}>
								{pr.label}
							</span>
							<span className="font-body text-ink-3" style={{ fontSize: 12 }}>
								{pr.sub}
							</span>
						</div>
						<p
							className="mt-1.5 font-body text-ink-3"
							style={{ fontSize: 11.5 }}
						>
							{t("goals.countedFrom", { n: pr.matchCount })} · {filterLabel}
						</p>
					</div>

					{/* Úkoly v hledáčku (prototyp ř. 1340–1350) */}
					{sampleTasks.length > 0 && (
						<div className="mt-4 border-line border-t pt-3">
							<div
								className="font-display font-bold text-ink-3 uppercase"
								style={{
									fontSize: 11,
									letterSpacing: ".06em",
									marginBottom: 4,
								}}
							>
								{t("goals.tasksInScope")}
							</div>
							{sampleTasks.slice(0, 6).map((tk) => {
								const isDone = !!tk.completed_at;
								const state = isDone
									? taskOnTime(tk)
										? "ontime"
										: "late"
									: "open";
								return (
									<button
										key={tk.id}
										type="button"
										onClick={() => taskDetail.open(tk.id)}
										className="flex w-full items-center border-line border-b text-left"
										style={{ gap: 8, padding: "8px 2px" }}
									>
										<span
											className="shrink-0 rounded-full"
											style={{
												width: 7,
												height: 7,
												background:
													state === "ontime"
														? "var(--w-success)"
														: state === "late"
															? "var(--w-overdue)"
															: "var(--w-ink-3)",
											}}
										/>
										<span
											className="min-w-0 flex-1 truncate font-body"
											style={{
												fontSize: 13,
												color: isDone ? "var(--w-ink-3)" : "var(--w-ink)",
												textDecoration: isDone ? "line-through" : "none",
											}}
										>
											{tk.name}
										</span>
										<span
											className="shrink-0 font-body text-ink-3"
											style={{ fontSize: 10.5 }}
										>
											{t(
												`goals.state${state[0]?.toUpperCase()}${state.slice(1)}`,
											)}
										</span>
									</button>
								);
							})}
							{sampleTasks.length > 6 && (
								<p
									className="mt-1.5 font-body text-ink-3"
									style={{ fontSize: 11.5 }}
								>
									{t("goals.andMore", { n: sampleTasks.length - 6 })}
								</p>
							)}
						</div>
					)}

					{/* Grid Období / Termín / Uplynulo (prototyp ř. 1352–1365) */}
					<div
						className="grid text-center"
						style={{
							gridTemplateColumns: "1fr 1fr 1fr",
							gap: 8,
							marginTop: 14,
						}}
					>
						{(
							[
								[g.period || "—", t("goals.period")],
								[fmtDueShort(g.due_date), t("goals.due")],
								[`${elapsed} %`, t("goals.elapsedShort")],
							] as const
						).map(([v, l]) => (
							<div
								key={l}
								className="rounded-[10px] bg-panel-2"
								style={{ padding: "11px 4px" }}
							>
								<div className="font-mono text-ink" style={{ fontSize: 14 }}>
									{v}
								</div>
								<div
									className="font-display font-semibold text-ink-3"
									style={{ fontSize: 10, marginTop: 3 }}
								>
									{l}
								</div>
							</div>
						))}
					</div>

					{/* Periodická obnova — box „Obnovuje se…" + akce „Obnovit období" (prototyp ř. 1367–1376) */}
					{g.periodic && g.periodic !== "none" && (
						<div
							className="flex items-center rounded-[12px] bg-panel-2"
							style={{ gap: 11, marginTop: 16, padding: "12px 14px" }}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								className="flex-none text-brass-text"
								aria-hidden
							>
								<path
									d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
								/>
								<path
									d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
								/>
								<path
									d="M12.4 1.6V4.4H9.6M3.6 14.4V11.6H6.4"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<div className="min-w-0 flex-1">
								<div
									className="font-display font-bold text-ink"
									style={{ fontSize: 12.5 }}
								>
									{t("goals.renews", {
										label: t(
											PERIODIC_KEY[g.periodic] ?? "goals.perNone",
										).toLowerCase(),
									})}
								</div>
								<div
									className="font-body text-ink-3"
									style={{ fontSize: 11.5 }}
								>
									{t("goals.renewsSub")}
								</div>
							</div>
							<button
								type="button"
								onClick={resetPeriod}
								className="flex-none whitespace-nowrap rounded-[8px] border border-line font-display font-semibold text-brass-text hover:bg-card"
								style={{ fontSize: 12, padding: "6px 11px" }}
							>
								{t("goals.resetPeriod")}
							</button>
						</div>
					)}

					{/* Vlastník (prototyp ř. 1378–1382) */}
					<div
						className="font-display font-bold text-ink-3 uppercase"
						style={{
							fontSize: 10.5,
							letterSpacing: ".06em",
							margin: "20px 0 8px",
						}}
					>
						{t("goals.owner")}
					</div>
					<div className="flex items-center" style={{ gap: 10 }}>
						<span
							className="flex items-center justify-center rounded-full font-display font-semibold text-white"
							style={{
								width: 30,
								height: 30,
								background: "var(--w-avatar)",
								fontSize: 11,
							}}
						>
							{initials(ownerName || "?")}
						</span>
						<span className="font-body text-ink" style={{ fontSize: 14 }}>
							{ownerName || "—"}
						</span>
					</div>

					{/* Napojené projekty s progress bary (prototyp ř. 1384–1396) */}
					{links.length > 0 && (
						<>
							<div
								className="font-display font-bold text-ink-3 uppercase"
								style={{
									fontSize: 10.5,
									letterSpacing: ".06em",
									margin: "20px 0 8px",
								}}
							>
								{t("goals.linkedProjects")}
							</div>
							{links.map(
								(lk) =>
									lk && (
										<div key={lk.id} style={{ marginBottom: 11 }}>
											<div className="flex items-center" style={{ gap: 8 }}>
												<span
													className="flex-none rounded-full"
													style={{
														width: 9,
														height: 9,
														background: lk.color ?? "var(--w-line)",
													}}
												/>
												<span
													className="flex-1 font-body text-ink"
													style={{ fontSize: 13 }}
												>
													{lk.name}
												</span>
												<span
													className="font-mono text-ink-3"
													style={{ fontSize: 12 }}
												>
													{lk.pct}%
												</span>
											</div>
											<div
												className="overflow-hidden rounded-full bg-panel-2"
												style={{ height: 6, marginTop: 6 }}
											>
												<div
													style={{
														height: "100%",
														width: `${lk.pct}%`,
														background: lk.color ?? "var(--w-brass)",
														borderRadius: "inherit",
													}}
												/>
											</div>
										</div>
									),
							)}
						</>
					)}

					{/* milníky */}
					<div className="mt-4 border-line border-t pt-3">
						<span className="font-display font-semibold text-ink-3 text-xs">
							{t("goals.milestones")}
							{milestones.length > 0 &&
								` · ${milestones.filter((m) => m.done).length}/${milestones.length}`}
						</span>
						<ul className="mt-2 flex flex-col gap-1">
							{milestones.map((m) => (
								<li key={m.id} className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => toggleMs(m)}
										className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[9px] text-white"
										style={{
											borderColor: m.done
												? "var(--w-success)"
												: "var(--w-line)",
											background: m.done ? "var(--w-success)" : "transparent",
										}}
									>
										{m.done ? "✓" : ""}
									</button>
									<span
										className={`text-sm ${m.done ? "text-ink-3 line-through" : "text-ink"}`}
									>
										{m.label}
									</span>
								</li>
							))}
						</ul>
						<input
							value={msText}
							onChange={(e) => setMsText(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && void addMilestone()}
							placeholder={t("goals.addMilestone")}
							className="mt-2 w-full rounded-lg border border-line border-dashed bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brass"
						/>
					</div>
				</div>

				<div className="border-line border-t px-4 py-3">
					<button
						type="button"
						onClick={() => void remove()}
						className="w-full rounded-[10px] border border-line font-display font-semibold text-overdue hover:bg-overdue-soft"
						style={{ padding: "9px 0", fontSize: 13 }}
					>
						{t("goals.delete")}
					</button>
				</div>
			</aside>
		</>
	);
}

/** SVG kruh 76×76 (VERBATIM prototyp ringNode, ř. 2371): r=30, stroke 7, dashoffset dle pct, rotate −90°. */
function ProgressRing({ pct, color }: { pct: number; color: string }) {
	const R = 30;
	const C = 2 * Math.PI * R;
	return (
		<svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
			<circle
				cx="38"
				cy="38"
				r={R}
				fill="none"
				stroke="var(--w-panel-2)"
				strokeWidth="7"
			/>
			<circle
				cx="38"
				cy="38"
				r={R}
				fill="none"
				stroke={color}
				strokeWidth="7"
				strokeLinecap="round"
				strokeDasharray={C}
				strokeDashoffset={C * (1 - Math.min(100, pct) / 100)}
				transform="rotate(-90 38 38)"
			/>
		</svg>
	);
}
