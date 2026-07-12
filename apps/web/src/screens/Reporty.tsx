import { useQuery as usePsQuery } from "@powersync/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { initials } from "../lib/format";
import { GSTAT, goalElapsed, goalProgress, goalStatus } from "../lib/goals";
import type { GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useWorkspace, useWorkspaces } from "../lib/workspace";

type Member = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	/** Pracovní role (users.job_title) — karta člena i detail (prototyp ř. 876/1160). */
	job: string | null;
	role: string;
	isOwner: boolean;
};

// Lokální dnešek (ne UTC) — konzistentní s lib/tasks, jinak po půlnoci posun o den.
const todayISO = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// completed_at je UTC ISO (new Date().toISOString()); pro zařazení do dne/týdne
// musíme převést na LOKÁLNÍ datum, jinak úkoly z okna půlnoc–UTC offset padnou o den vedle.
const localDay = (iso: string): string => {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Krátké názvy dní Po–Ne dle jazyka (2024-01-01 je pondělí).
const wdLabels = (lang: string): string[] =>
	Array.from({ length: 7 }, (_, i) =>
		new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date(2024, 0, 1 + i)),
	);

/** ISO data aktuálního týdne Po–Ne. */
function weekDays(): string[] {
	const now = new Date();
	const mon = new Date(now);
	mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(mon);
		d.setDate(mon.getDate() + i);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	});
}

/** Reporty — Přehled (KPI + týdenní graf + podle projektu + cíle) a Lidé (roster + member detail). */
export function Reporty() {
	const { t, i18n } = useTranslation();
	const WD_LABELS = wdLabels(i18n.language);
	const navigate = useNavigate();
	const search = useSearch({ from: "/reporty" });
	const projects = useProjects();
	const taskDetail = useTaskDetail();
	const { data: workspaces } = useWorkspaces();
	const { activeWs } = useWorkspace();
	const ws = workspaces?.find((w) => w.id === activeWs);
	const wsP = ws?.isPersonal ?? false;

	const tab = !wsP && search.tab === "lide" ? "lide" : "prehled";
	const memberId = search.clen ?? null;
	const setSearch = (next: { tab?: string; clen?: string }) =>
		void navigate({ to: "/reporty", search: next });

	const { data: tasks } = usePsQuery<TaskRow>(
		"SELECT id, name, project_id, priority, due_date, completed_at, assignment_mode FROM tasks",
	);
	// completed_at účasti — u shared_all je dokončení PER-OSOBA (task.completed_at je odvozené až po všech).
	const { data: assignments } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
		completed_at: string | null;
	}>("SELECT task_id, user_id, completed_at FROM assignments");
	const { data: goals } = usePsQuery<GoalRow>(
		"SELECT * FROM goals WHERE workspace_id = ? ORDER BY created_at",
		[activeWs ?? ""],
	);
	const { data: goalProjects } = usePsQuery<{
		goal_id: string | null;
		project_id: string | null;
	}>("SELECT goal_id, project_id FROM goal_projects");
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

	const wsProjects = useMemo(
		() => projects.filter((p) => p.workspace_id === activeWs),
		[projects, activeWs],
	);
	const wsProjectIds = useMemo(() => new Set(wsProjects.map((p) => p.id)), [wsProjects]);
	const wsTasks = useMemo(
		() => (tasks ?? []).filter((tk) => tk.project_id && wsProjectIds.has(tk.project_id)),
		[tasks, wsProjectIds],
	);
	// taskId → (userId → dokončil svou účast?). `.has(uid)` = přiřazení, `.get(uid)` = per-osobní done.
	const assigneesByTask = useMemo(() => {
		const m = new Map<string, Map<string, boolean>>();
		for (const a of assignments ?? []) {
			if (!a.task_id || !a.user_id) continue;
			const s = m.get(a.task_id) ?? new Map<string, boolean>();
			s.set(a.user_id, !!a.completed_at);
			m.set(a.task_id, s);
		}
		return m;
	}, [assignments]);

	// ── Přehled ────────────────────────────────────────────────────────────────
	// Závislost na dnešku, aby graf po přechodu týdne (kiosk/otevřený tab) nezůstal na minulém týdnu.
	const days = useMemo(weekDays, [todayISO()]);
	const overview = useMemo(() => {
		const tdy = todayISO();
		const perDay = days.map(
			(d) => wsTasks.filter((tk) => tk.completed_at && localDay(tk.completed_at) === d).length,
		);
		const weekDone = perDay.reduce((a, b) => a + b, 0);
		const overdue = wsTasks.filter(
			(tk) => !tk.completed_at && tk.due_date && tk.due_date.slice(0, 10) < tdy,
		).length;
		const maxDay = Math.max(1, ...perDay);
		const perProj = wsProjects
			.map((p) => ({
				p,
				v: wsTasks.filter((tk) => tk.project_id === p.id && tk.completed_at).length,
			}))
			.sort((a, b) => b.v - a.v);
		const maxProj = Math.max(1, ...perProj.map((x) => x.v));
		// průměr / den = 5 pracovních dnů (prototyp ř. 833). Čitatel bereme jen z Po–Pá (index 0–4),
		// aby víkendová dokončení nedělitel 5 nepřeceňovala; formát čísla dle jazyka (ne natvrdo čárka).
		const weekdayDone = perDay.slice(0, 5).reduce((a, b) => a + b, 0);
		return {
			perDay,
			weekDone,
			overdue,
			avg: new Intl.NumberFormat(i18n.language, {
				minimumFractionDigits: 1,
				maximumFractionDigits: 1,
			}).format(weekdayDone / 5),
			maxDay,
			perProj,
			maxProj,
		};
	}, [wsTasks, wsProjects, days, i18n.language]);

	// ── Cíle (kompaktní řádky) ─────────────────────────────────────────────────
	const linksByGoal = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const gp of goalProjects ?? []) {
			if (!gp.goal_id || !gp.project_id) continue;
			m.set(gp.goal_id, [...(m.get(gp.goal_id) ?? []), gp.project_id]);
		}
		return m;
	}, [goalProjects]);
	const goalRow = useMemo(() => {
		const tdy = todayISO();
		return (g: GoalRow) => {
			const links = linksByGoal.get(g.id) ?? [];
			const linkSet = new Set(links);
			const ts = wsTasks.filter((tk) => {
				if (links.length > 0 && (!tk.project_id || !linkSet.has(tk.project_id))) return false;
				if (g.scope === "person" && g.owner_id && !assigneesByTask.get(tk.id)?.has(g.owner_id))
					return false;
				return true;
			});
			let projectPct: { pct: number; count: number } | undefined;
			if (g.metric === "project") {
				let w = 0;
				let p = 0;
				for (const pid of links) {
					const pts = wsTasks.filter((tk) => tk.project_id === pid);
					const done = pts.filter((tk) => tk.completed_at).length;
					w += pts.length;
					p += (pts.length ? Math.round((done / pts.length) * 100) : 0) * pts.length;
				}
				projectPct = { pct: w ? Math.round(p / w) : 0, count: links.length };
			}
			const pr = goalProgress(g.metric ?? "completion", ts, g.target ?? 0, projectPct, t);
			const overdue = !!g.due_date && g.due_date.slice(0, 10) < tdy;
			const st = goalStatus(pr.pct, goalElapsed(g.created_at, g.due_date, tdy), overdue, false);
			return { g, pr, st };
		};
	}, [wsTasks, linksByGoal, assigneesByTask]);
	const { data: session } = useSession();
	const meId = session?.user?.id;
	const reportGoals = useMemo(() => {
		const rows = (goals ?? []).map(goalRow);
		// wsP → mé cíle; jinak týmové (dle prototypu reportGoals, ř. 3187).
		return wsP
			? rows.filter((r) => !meId || r.g.owner_id === meId)
			: rows.filter((r) => (r.g.scope ?? "team") === "team");
	}, [goals, goalRow, wsP, meId]);

	// ── Lidé ───────────────────────────────────────────────────────────────────
	const memberStats = useMemo(() => {
		const tdy = todayISO();
		// R2 — u shared_all je dokončení PER-OSOBA (assignments.completed_at); task.completed_at je
		// odvozené až po všech, takže pro daného člena by ho zkreslovalo (open/overdue místo done).
		// U single/shared_any se dokončením řídí task-level completed_at (per-osoba se neplní).
		const donePerson = (tk: TaskRow, uid: string): boolean =>
			tk.assignment_mode === "shared_all"
				? assigneesByTask.get(tk.id)?.get(uid) === true
				: !!tk.completed_at;
		return (uid: string) => {
			const mine = wsTasks.filter((tk) => assigneesByTask.get(tk.id)?.has(uid));
			const open = mine.filter((tk) => !donePerson(tk, uid));
			const done = mine.filter((tk) => donePerson(tk, uid)).length;
			const overdue = open.filter((tk) => tk.due_date && tk.due_date.slice(0, 10) < tdy).length;
			const eff = done + open.length ? Math.round((done / (done + open.length)) * 100) : 0;
			return {
				mine,
				open,
				done,
				overdue,
				eff,
				loadW: Math.min(100, open.length * 13),
			};
		};
	}, [wsTasks, assigneesByTask]);

	const selected = memberId ? (members.find((m) => m.id === memberId) ?? null) : null;

	return (
		<div className="mx-auto max-w-[920px]" style={{ padding: "20px 22px 90px" }}>
			{/* header */}
			<div className="mb-3.5 flex items-center gap-2.5">
				<h1 className="font-display font-extrabold text-ink" style={{ fontSize: 17 }}>
					{t("reports.heading")}
				</h1>
				<span
					className="ml-0.5 shrink-0"
					style={{
						width: 8,
						height: 8,
						borderRadius: 3,
						background: ws?.color ?? "var(--w-brass)",
					}}
				/>
				<span className="font-display font-semibold text-ink-3" style={{ fontSize: 13 }}>
					{ws?.name ?? ""}
				</span>
				{!wsP && (
					<div
						className="ml-auto inline-flex rounded-[9px] border border-line bg-panel-2"
						style={{ padding: 3 }}
					>
						{(
							[
								["prehled", t("reports.tabOverview")],
								["lide", t("reports.tabPeople")],
							] as const
						).map(([k, l]) => (
							<button
								key={k}
								type="button"
								onClick={() => setSearch(k === "lide" ? { tab: "lide" } : {})}
								className="rounded-[7px] font-display font-semibold"
								style={{
									fontSize: 12.5,
									padding: "5px 13px",
									background: tab === k ? "var(--w-card)" : "transparent",
									color: tab === k ? "var(--w-ink)" : "var(--w-ink-3)",
								}}
							>
								{l}
							</button>
						))}
					</div>
				)}
			</div>

			{tab === "prehled" ? (
				<>
					{/* KPI */}
					<div className="mb-4 flex gap-3.5">
						<Kpi
							value={String(overview.weekDone)}
							label={t("reports.kpiWeek")}
							color="var(--w-ink)"
						/>
						<Kpi
							value={String(overview.overdue)}
							label={t("reports.kpiOverdue")}
							color="var(--w-overdue)"
						/>
						<Kpi value={overview.avg} label={t("reports.kpiAvg")} color="var(--w-brass-text)" />
					</div>

					<div className="grid grid-cols-2 gap-4">
						{/* týdenní graf */}
						<div className="rounded-[14px] border border-line bg-card" style={{ padding: 16 }}>
							<div className="mb-4 font-display font-bold text-ink" style={{ fontSize: 13 }}>
								{t("reports.weekChart")}
							</div>
							<div className="flex items-end justify-between gap-2" style={{ height: 88 }}>
								{overview.perDay.map((v, i) => (
									<div key={WD_LABELS[i]} className="flex flex-1 flex-col items-center gap-1.5">
										<div
											className="w-full"
											style={{
												maxWidth: 26,
												borderRadius: "5px 5px 0 0",
												background: "var(--w-brass)",
												height: Math.max(2, Math.round((v / overview.maxDay) * 70)),
											}}
										/>
										<span className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
											{WD_LABELS[i]}
										</span>
									</div>
								))}
							</div>
						</div>
						{/* podle projektu */}
						<div className="rounded-[14px] border border-line bg-card" style={{ padding: 16 }}>
							<div className="mb-3.5 font-display font-bold text-ink" style={{ fontSize: 13 }}>
								{t("reports.byProject")}
							</div>
							{overview.perProj.length === 0 && (
								<div className="font-body text-ink-3" style={{ fontSize: 12.5 }}>
									{t("reports.emptyProjects")}
								</div>
							)}
							{overview.perProj.map(({ p, v }) => (
								<div key={p.id} style={{ marginBottom: 11 }}>
									<div className="mb-1 flex items-center gap-1.5">
										<span
											className="rounded-full"
											style={{
												width: 8,
												height: 8,
												background: p.color ?? "var(--w-line)",
											}}
										/>
										<span className="flex-1 font-body text-ink-2" style={{ fontSize: 12.5 }}>
											{p.name}
										</span>
										<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
											{v}
										</span>
									</div>
									<div className="overflow-hidden rounded-[3px] bg-panel-2" style={{ height: 6 }}>
										<div
											style={{
												height: "100%",
												width: `${Math.max(3, Math.round((v / overview.maxProj) * 100))}%`,
												background: p.color ?? "var(--w-brass)",
											}}
										/>
									</div>
								</div>
							))}
						</div>
					</div>

					{/* cíle */}
					<div
						className="mt-4 rounded-[14px] border border-line bg-card"
						style={{ padding: "16px 18px" }}
					>
						<div className="mb-1 flex items-center gap-2.5">
							<span className="flex-1 font-display font-bold text-ink" style={{ fontSize: 13 }}>
								{wsP ? t("reports.goalsMine") : t("reports.goalsTeam")}
							</span>
							<button
								type="button"
								onClick={() => void navigate({ to: "/cile" })}
								className="font-display font-semibold text-brass-text hover:underline"
								style={{ fontSize: 12 }}
							>
								{t("reports.allGoals")}
							</button>
						</div>
						{reportGoals.length === 0 && (
							<div className="py-2.5 font-body text-ink-3" style={{ fontSize: 12.5 }}>
								{t("reports.emptyGoals")}
							</div>
						)}
						{reportGoals.map(({ g, pr, st }) => (
							<div key={g.id} className="border-line border-b py-2.5 last:border-b-0">
								<div className="flex items-center gap-2">
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{g.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11.5 }}>
										{pr.label}
									</span>
									<span
										className="shrink-0 font-display font-bold text-ink"
										style={{ fontSize: 12.5 }}
									>
										{pr.pct} %
									</span>
								</div>
								<div className="mt-2 overflow-hidden rounded-full bg-panel-2" style={{ height: 5 }}>
									<div
										style={{
											height: "100%",
											width: `${Math.min(100, pr.pct)}%`,
											background: GSTAT[st][3],
										}}
									/>
								</div>
							</div>
						))}
					</div>
				</>
			) : (
				<>
					{/* Lidé */}
					<div className="mb-3.5 flex items-center">
						<span className="font-body text-ink-3" style={{ fontSize: 13 }}>
							{t("reports.peopleHint", { count: members.length })}
						</span>
						<button
							type="button"
							onClick={() => void navigate({ to: "/nastaveni" })}
							className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] border border-line font-display font-semibold text-ink-2 hover:border-brass"
							style={{ padding: "7px 12px", fontSize: 12.5 }}
						>
							<Icon name="pridat" size={12} />
							{t("reports.addMember")}
						</button>
					</div>
					{members.length === 0 && (
						<div
							className="rounded-[13px] border border-line bg-card font-body text-ink-3"
							style={{ padding: "20px 16px", fontSize: 12.5 }}
						>
							{t("reports.emptyPeople")}
						</div>
					)}
					{members.map((m) => {
						const st = memberStats(m.id);
						return (
							<button
								key={m.id}
								type="button"
								onClick={() => setSearch({ tab: "lide", clen: m.id })}
								className="mb-2.5 flex w-full items-center gap-3.5 rounded-[13px] border border-line bg-card text-left hover:border-brass"
								style={{
									padding: "13px 16px",
									boxShadow: "var(--w-shadow-sm)",
								}}
							>
								<span
									className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white"
									style={{
										width: 40,
										height: 40,
										background: "var(--w-avatar)",
										fontSize: 14,
									}}
								>
									{initials(m.name)}
								</span>
								<div className="min-w-0 flex-1">
									<div className="font-display font-bold text-ink" style={{ fontSize: 14.5 }}>
										{m.name}
									</div>
									{/* pracovní role místo e-mailu (prototyp ř. 876; e-mail zůstává v detailu) */}
									<div className="font-body text-ink-3" style={{ fontSize: 12.5 }}>
										{m.job || m.email}
									</div>
								</div>
								{st.overdue > 0 && (
									<span
										className="shrink-0 rounded-full font-display font-semibold"
										style={{
											fontSize: 11,
											padding: "3px 9px",
											background: "var(--w-overdue-soft)",
											color: "var(--w-overdue)",
										}}
									>
										{t("reports.overdueChip", { count: st.overdue })}
									</span>
								)}
								<div className="shrink-0" style={{ width: 150 }}>
									<div className="overflow-hidden rounded-[3px] bg-panel-2" style={{ height: 6 }}>
										<div
											style={{
												height: "100%",
												width: `${st.loadW}%`,
												background: "var(--w-brass)",
											}}
										/>
									</div>
									<div className="mt-1 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{t("reports.openTasks", { count: st.open.length })}
									</div>
								</div>
							</button>
						);
					})}
				</>
			)}

			{selected && activeWs && (
				<MemberDetail
					member={selected}
					workspaceId={activeWs}
					stats={memberStats(selected.id)}
					projects={wsProjects}
					goals={(goals ?? []).filter((g) => g.owner_id === selected.id).map(goalRow)}
					onOpenTask={(id) => taskDetail.open(id)}
					onOpenTasks={() => void navigate({ to: "/ukoly" })}
					onClose={() => setSearch(tab === "lide" ? { tab: "lide" } : {})}
				/>
			)}
		</div>
	);
}

function Kpi({ value, label, color }: { value: string; label: string; color: string }) {
	return (
		<div className="flex-1 rounded-[13px] border border-line bg-card" style={{ padding: 16 }}>
			<div className="font-mono" style={{ fontSize: 28, color }}>
				{value}
			</div>
			<div className="mt-0.5 font-body text-ink-3" style={{ fontSize: 12.5 }}>
				{label}
			</div>
		</div>
	);
}

/** Member detail — pravý panel (efektivita, staty, role segmenty, úkoly, rozpad, cíle). */
function MemberDetail({
	member,
	workspaceId,
	stats,
	projects,
	goals,
	onOpenTask,
	onOpenTasks,
	onClose,
}: {
	member: Member;
	workspaceId: string;
	stats: {
		mine: TaskRow[];
		open: TaskRow[];
		done: number;
		overdue: number;
		eff: number;
		loadW: number;
	};
	projects: { id: string; name: string | null; color: string | null }[];
	goals: {
		g: GoalRow;
		pr: ReturnType<typeof goalProgress>;
		st: keyof typeof GSTAT;
	}[];
	onOpenTask: (id: string) => void;
	onOpenTasks: () => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const qc = useQueryClient();
	const tdy = todayISO();
	const trapRef = useFocusTrap<HTMLElement>(true);
	// Esc zavře panel — konzistentně se sourozeneckými overlaye (NotifCenter/TaskDetailPanel/PeekPanel).
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [onClose]);

	// Optimistický highlight role, dokud PATCH nedoběhne — jinak není žádná okamžitá odezva.
	const [pendingRole, setPendingRole] = useState<string | null>(null);
	const roleMut = useMutation({
		mutationFn: async (role: string) => {
			const r = await fetch(`${API_URL}/api/workspaces/${workspaceId}/members/${member.id}/role`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ role }),
			});
			if (!r.ok) throw new Error("role");
		},
		onMutate: (role: string) => setPendingRole(role),
		onSettled: () => {
			setPendingRole(null);
			void qc.invalidateQueries({ queryKey: ["wsMembersFull", workspaceId] });
		},
	});

	const byProj = useMemo(() => {
		const m = new Map<string, number>();
		for (const tk of stats.mine)
			if (tk.project_id) m.set(tk.project_id, (m.get(tk.project_id) ?? 0) + 1);
		return [...m.entries()]
			.map(([pid, count]) => ({ p: projects.find((x) => x.id === pid), count }))
			.filter((x) => x.p);
	}, [stats.mine, projects]);

	const roleOf = member.role === "manager" ? "admin" : member.role;
	const activeRole = pendingRole ?? roleOf;

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.34)", zIndex: 40 }}
			/>
			<aside
				ref={trapRef}
				className="fixed top-0 right-0 bottom-0 flex flex-col border-line border-l bg-card"
				style={{
					width: 440,
					maxWidth: "94vw",
					boxShadow: "var(--w-shadow)",
					zIndex: 41,
				}}
			>
				<div
					className="flex items-center gap-2.5 border-line border-b"
					style={{ padding: "14px 18px" }}
				>
					<span className="flex-1 font-display font-bold text-ink-2" style={{ fontSize: 14 }}>
						{t("reports.memberPanel")}
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.cancel")}
						className="flex text-ink-3 hover:text-ink"
					>
						<Icon name="zavrit" size={16} />
					</button>
				</div>

				<div className="flex-1 overflow-auto" style={{ padding: 18 }}>
					<div className="flex items-center gap-3.5">
						<span
							className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white"
							style={{
								width: 56,
								height: 56,
								background: "var(--w-avatar)",
								fontSize: 19,
							}}
						>
							{initials(member.name)}
						</span>
						<div className="min-w-0">
							<div className="font-display font-extrabold text-ink" style={{ fontSize: 19 }}>
								{member.name}
							</div>
							{/* pracovní role + e-mail (prototyp ř. 1159–1161) */}
							{member.job && (
								<div className="font-body text-ink-3" style={{ fontSize: 13 }}>
									{member.job}
								</div>
							)}
							<div className="font-mono text-ink-3" style={{ fontSize: 11.5, marginTop: 2 }}>
								{member.email}
							</div>
						</div>
					</div>

					{/* efektivita */}
					<div className="mt-5 mb-1.5 flex items-center justify-between">
						<SectionLabel>{t("reports.efficiency")}</SectionLabel>
						<span className="font-mono text-ink" style={{ fontSize: 13 }}>
							{stats.eff} %
						</span>
					</div>
					<div className="overflow-hidden rounded-[4px] bg-panel-2" style={{ height: 8 }}>
						<div
							style={{
								height: "100%",
								width: `${stats.eff}%`,
								background: "var(--w-brass)",
							}}
						/>
					</div>

					{/* staty */}
					<div className="mt-4 flex gap-2.5">
						<Stat n={stats.open.length} label={t("reports.statOpen")} color="var(--w-ink)" />
						<Stat n={stats.overdue} label={t("reports.statOverdue")} color="var(--w-overdue)" />
						<Stat n={stats.done} label={t("reports.statDone")} color="var(--w-success-ink)" />
					</div>

					{/* role */}
					<SectionLabel style={{ margin: "20px 0 7px" }}>{t("reports.rolesLabel")}</SectionLabel>
					{member.isOwner ? (
						<span
							className="inline-flex rounded-full font-display font-semibold"
							style={{
								fontSize: 11.5,
								padding: "4px 11px",
								background: "var(--w-brass-soft)",
								color: "var(--w-brass-text)",
							}}
						>
							{t("reports.roleOwner")}
						</span>
					) : (
						<div
							className="inline-flex rounded-[9px] border border-line bg-panel-2"
							style={{ padding: 3 }}
						>
							{(
								[
									["admin", t("reports.roleAdmin")],
									["member", t("reports.roleMember")],
									["guest", t("reports.roleGuest")],
								] as const
							).map(([k, l]) => (
								<button
									key={k}
									type="button"
									// klik na už aktivní roli i běžící mutaci ignoruj → žádné dvojité/závodící PATCHe
									disabled={roleMut.isPending}
									onClick={() => {
										if (k === activeRole || roleMut.isPending) return;
										roleMut.mutate(k);
									}}
									className="rounded-[7px] font-display font-semibold"
									style={{
										fontSize: 12.5,
										padding: "6px 14px",
										background: activeRole === k ? "var(--w-card)" : "transparent",
										color: activeRole === k ? "var(--w-ink)" : "var(--w-ink-2)",
									}}
								>
									{l}
								</button>
							))}
						</div>
					)}

					{/* úkoly */}
					<SectionLabel style={{ margin: "22px 0 9px" }}>
						{`${t("reports.tasksLabel")} · ${stats.open.length}`}
					</SectionLabel>
					{stats.open.slice(0, 10).map((tk) => {
						const p = projects.find((x) => x.id === tk.project_id);
						const isOver = !!tk.due_date && tk.due_date.slice(0, 10) < tdy;
						return (
							<button
								key={tk.id}
								type="button"
								onClick={() => onOpenTask(tk.id)}
								className="flex w-full items-center gap-2.5 border-line border-b text-left hover:bg-panel-2"
								style={{ padding: "10px 4px" }}
							>
								<span
									className="shrink-0 rounded-full"
									style={{
										width: 7,
										height: 7,
										background: p?.color ?? "var(--w-line)",
									}}
								/>
								<div className="min-w-0 flex-1">
									<div
										className="truncate font-display font-semibold text-ink"
										style={{ fontSize: 13.5 }}
									>
										{tk.name}
									</div>
									<div className="font-body text-ink-3" style={{ fontSize: 11 }}>
										{p?.name ?? ""}
									</div>
								</div>
								{isOver && (
									<span className="shrink-0 font-mono text-overdue" style={{ fontSize: 11 }}>
										{t("today.duePastLower")}
									</span>
								)}
								<span
									className="shrink-0 rounded-full bg-panel-2 font-display font-semibold"
									style={{
										fontSize: 10.5,
										padding: "2px 7px",
										color: `var(--w-p${tk.priority ?? 4})`,
									}}
								>
									P{tk.priority ?? 4}
								</span>
							</button>
						);
					})}
					{/* seznam je oříznut na 10 — afordance na zbytek přes filtrované /úkoly */}
					{stats.open.length > 10 && (
						<button
							type="button"
							onClick={onOpenTasks}
							className="mt-2 font-display font-semibold text-brass-text hover:underline"
							style={{ fontSize: 12 }}
						>
							{t("reports.moreTasks", { count: stats.open.length - 10 })}
						</button>
					)}

					{/* podle projektu */}
					{byProj.length > 0 && (
						<>
							<SectionLabel style={{ margin: "22px 0 9px" }}>
								{t("reports.byProjectLabel")}
							</SectionLabel>
							{byProj.map(({ p, count }) => (
								<div key={p?.id} className="mb-2 flex items-center gap-2">
									<span
										className="shrink-0 rounded-full"
										style={{
											width: 8,
											height: 8,
											background: p?.color ?? "var(--w-line)",
										}}
									/>
									<span
										className="truncate font-body text-ink-2"
										style={{ fontSize: 12.5, width: 130 }}
									>
										{p?.name}
									</span>
									<div
										className="flex-1 overflow-hidden rounded-[3px] bg-panel-2"
										style={{ height: 6 }}
									>
										<div
											style={{
												height: "100%",
												width: `${Math.min(100, count * 22)}%`,
												background: "var(--w-brass)",
											}}
										/>
									</div>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{count}
									</span>
								</div>
							))}
						</>
					)}

					{/* cíle člena */}
					{goals.length > 0 && (
						<>
							<SectionLabel style={{ margin: "22px 0 9px" }}>
								{t("reports.goalsLabel")}
							</SectionLabel>
							{goals.map(({ g, pr, st }) => (
								<div key={g.id} className="border-line border-b py-2.5 last:border-b-0">
									<div className="flex items-center gap-2">
										<span
											className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
											style={{ fontSize: 13 }}
										>
											{g.name}
										</span>
										<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11.5 }}>
											{pr.label}
										</span>
										<span
											className="shrink-0 font-display font-bold text-ink"
											style={{ fontSize: 12.5 }}
										>
											{pr.pct} %
										</span>
									</div>
									<div
										className="mt-2 overflow-hidden rounded-full bg-panel-2"
										style={{ height: 5 }}
									>
										<div
											style={{
												height: "100%",
												width: `${Math.min(100, pr.pct)}%`,
												background: GSTAT[st][3],
											}}
										/>
									</div>
								</div>
							))}
						</>
					)}
				</div>

				{/* patička — primární + sekundární „Zavřít" (prototyp ř. 1213–1215) */}
				<div className="flex border-line border-t" style={{ gap: 9, padding: "13px 18px" }}>
					<button
						type="button"
						onClick={onOpenTasks}
						className="flex-1 rounded-[10px] font-display font-bold text-white hover:brightness-105"
						style={{
							background: "var(--w-brass)",
							padding: "10px 0",
							fontSize: 13,
						}}
					>
						{t("reports.showTasks")}
					</button>
					<button
						type="button"
						onClick={onClose}
						className="rounded-[10px] border border-line bg-panel-2 font-display font-semibold text-ink-2"
						style={{ padding: "10px 14px", fontSize: 13 }}
					>
						{t("common.close")}
					</button>
				</div>
			</aside>
		</>
	);
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
	return (
		<div
			className="flex-1 rounded-[11px] border border-line bg-panel-2"
			style={{ padding: "11px 12px" }}
		>
			<div className="font-mono" style={{ fontSize: 20, color }}>
				{n}
			</div>
			<div className="font-body text-ink-3" style={{ fontSize: 11, marginTop: 1 }}>
				{label}
			</div>
		</div>
	);
}

function SectionLabel({ children, style }: { children: string; style?: React.CSSProperties }) {
	return (
		<div
			className="font-display font-bold text-ink-3 uppercase"
			style={{ fontSize: 10.5, letterSpacing: ".06em", ...style }}
		>
			{children}
		</div>
	);
}
