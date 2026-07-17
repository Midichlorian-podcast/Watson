import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { KpiCard } from "../components/KpiCard";
import { PeekPanel, type PeekTarget } from "../components/PeekPanel";
import { RadarPanel } from "../components/RadarPanel";
import { useSession } from "../lib/auth-client";
import { initials } from "../lib/format";
import { inboxProjectIds, isInboxTask } from "../lib/inbox";
import { useAllMembers, useFlowsOverview, useGoalsOverview } from "../lib/overview";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { kpi, useAllReady } from "../lib/dataState";
import { useProjectsWithState } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { todayISO } from "../lib/tasks";
import { deviceTimeZone } from "../lib/timeZone";
import { isLeadership, useWorkspace, useWorkspaces } from "../lib/workspace";
import { useMailDigest, useOpenMailThread } from "../mail/state";

/**
 * Velín — přehled pro vedení, jen role Vlastník/Admin (prototyp ř. 946–1080 +
 * velinView ř. 3960–3988): chipy a karty firem s metrikami, KPI řádek, karty
 * Po termínu / Zátěž lidí / Cíle v riziku / Vázne v postupech / Dnes se stalo.
 * Člen vidí zamčenou obrazovku s vysvětlením. Karta Pošta se připojí s Mail modulem.
 */

const cardCls = "overflow-hidden rounded-[14px] border border-line bg-card";
const cardStyle: CSSProperties = { boxShadow: "var(--w-shadow-sm)" };

function CardHead({
	title,
	foot,
	footColor,
	onFoot,
}: {
	title: string;
	foot?: string;
	footColor?: string;
	onFoot?: () => void;
}) {
	return (
		<div className="flex items-center" style={{ gap: 8, padding: "13px 16px 9px" }}>
			<span className="flex-1 font-display font-bold text-ink" style={{ fontSize: 13.5 }}>
				{title}
			</span>
			{foot &&
				(onFoot ? (
					<button
						type="button"
						onClick={onFoot}
						className="font-display font-semibold text-brass-text hover:underline"
						style={{ fontSize: 11.5 }}
					>
						{foot}
					</button>
				) : (
					<span
						className="font-mono"
						style={{ fontSize: 11, color: footColor ?? "var(--w-ink-3)" }}
					>
						{foot}
					</span>
				))}
		</div>
	);
}

function NavyAvatar({ text }: { text: string }) {
	return (
		<span
			className="flex shrink-0 items-center justify-center rounded-full font-display font-bold"
			style={{
				width: 24,
				height: 24,
				background: "var(--w-avatar)",
				color: "#fff",
				fontSize: 9,
			}}
		>
			{text}
		</span>
	);
}

export function Velin() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { open } = useTaskDetail();
	const { data: session } = useSession();
	const { data: workspaces } = useWorkspaces();
	const { setActiveWs } = useWorkspace();
	const { projects, isLoading: projLoading } = useProjectsWithState();
	const goalsAll = useGoalsOverview(t);
	const flowsAll = useFlowsOverview();
	const members = useAllMembers();
	// Pošta z mail modulu (bez filtru firmy — seed světy se liší, viz state.tsx).
	const digest = useMailDigest();
	const openMailThread = useOpenMailThread();
	const urgMails = (digest?.items ?? []).filter((x) => x.flag === "p1" || x.flag === "p2");
	const [firm, setFirm] = useState<string | null>(null); // velFirm
	// peek — náhled položky na místě (feedback: neodvádět z Velína pryč)
	const [peek, setPeek] = useState<PeekTarget | null>(null);
	// „dnešek" z tikajícího zdroje — jinak u dlouho otevřené karty (přes půlnoc)
	// zamrzne datum i hranice „po termínu" na včerejšku, dokud nepřijde jiná změna.
	const [dayKey, setDayKey] = useState(todayISO);
	useEffect(() => {
		const check = () =>
			setDayKey((prev) => {
				const now = todayISO();
				return now !== prev ? now : prev;
			});
		const id = setInterval(check, 60_000);
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", check);
		return () => {
			clearInterval(id);
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", check);
		};
	}, []);

	// kind IS NOT 'meeting' — Velín měří práci týmu; porady nezkreslují čísla
	const { data: allTasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE kind IS NOT 'meeting'",
	);
	const { data: assignments, isLoading: asgLoading } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");
	// CC-P0-01: KPI se smí tvrdit až po doběhnutí dotazů (0 ≠ „ještě nevím").
	const ready = useAllReady(projLoading, tasksLoading, asgLoading);

	const leadership = isLeadership(workspaces);
	// memoizace — firmsWs je dependency těžkého view memo níž; nová identita
	// každý render by memo zrušila (celý výpočet by běžel při každém renderu)
	const firmsWs = useMemo(() => (workspaces ?? []).filter((w) => !w.isPersonal), [workspaces]);

	const view = useMemo(() => {
		const tdy = dayKey;
		const inboxIds = inboxProjectIds(projects);
		const projById = new Map(projects.map((p) => [p.id, p]));
		const wsOfT = (tk: TaskRow) =>
			tk.project_id ? (projById.get(tk.project_id)?.workspace_id ?? null) : null;
		const teamWsIds = new Set(firmsWs.map((w) => w.id));
		// úkoly týmových prostorů bez inboxu (prototyp allT: !inbox && ws !== personal)
		const allT = (allTasks ?? []).filter((tk) => {
			if (isInboxTask(tk, inboxIds)) return false;
			const w = wsOfT(tk);
			return !!w && teamWsIds.has(w);
		});
		const isOver = (tk: TaskRow) =>
			!tk.completed_at && !!tk.due_date && tk.due_date.slice(0, 10) < tdy;
		const inF = (tk: TaskRow) => !firm || wsOfT(tk) === firm;

		const goalRisk = (g: { status: string }) => g.status === "risk" || g.status === "over";

		const firms = firmsWs.map((w) => {
			const pts = allT.filter((tk) => wsOfT(tk) === w.id);
			const open = pts.filter((tk) => !tk.completed_at).length;
			const ov = pts.filter(isOver).length;
			const doneN = pts.filter((tk) => tk.completed_at).length;
			const risk = goalsAll.filter((g) => g.wsId === w.id && goalRisk(g)).length;
			return { id: w.id, name: w.name, color: w.color, open, ov, doneN, risk };
		});

		const asgByTask = new Map<string, string[]>();
		for (const a of assignments ?? []) {
			if (!a.task_id || !a.user_id) continue;
			asgByTask.set(a.task_id, [...(asgByTask.get(a.task_id) ?? []), a.user_id]);
		}
		// U sdílených úkolů (R2, více přiřazených) bereme dole jen prvního; bez
		// deterministického řazení by „odpovědný" skákal dle pořadí řádků SQL.
		for (const uids of asgByTask.values())
			uids.sort((a, b) => (members.get(a) ?? a).localeCompare(members.get(b) ?? b));
		// zátěž lidí — otevřené/po termínu per člověk (prototyp load, bar min(100, open*12)%)
		const perPerson = new Map<string, { open: number; ov: number }>();
		for (const tk of allT) {
			if (!inF(tk) || tk.completed_at) continue;
			for (const uid of asgByTask.get(tk.id) ?? []) {
				const s = perPerson.get(uid) ?? { open: 0, ov: 0 };
				s.open++;
				if (isOver(tk)) s.ov++;
				perPerson.set(uid, s);
			}
		}
		const load = [...perPerson.entries()]
			.map(([uid, s]) => ({
				id: uid,
				name: members.get(uid) ?? "",
				initials: initials(members.get(uid) ?? "?"),
				open: s.open,
				ov: s.ov,
			}))
			.filter((p) => p.name)
			.sort((a, b) => b.open - a.open)
			.slice(0, 8);

		const wd = (iso: string) =>
			new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(
				new Date(`${iso}T00:00:00`),
			);
		// deterministické řazení (stejný důvod jako Přehled — stabilita po UPDATE)
		const ovRowsAll = allT
			.filter((tk) => isOver(tk) && inF(tk))
			.sort(
				(a, b) =>
					(a.due_date ?? "").localeCompare(b.due_date ?? "") ||
					(a.priority ?? 4) - (b.priority ?? 4) ||
					(a.name ?? "").localeCompare(b.name ?? ""),
			);
		const ovRows = ovRowsAll.slice(0, 7).map((tk) => {
			const uid = asgByTask.get(tk.id)?.[0];
			const p = tk.project_id ? projById.get(tk.project_id) : undefined;
			return {
				id: tk.id,
				name: tk.name ?? "",
				ini: uid ? initials(members.get(uid) ?? "?") : "—",
				projColor: p?.color ?? "var(--w-ink-3)",
				projName: p?.name ?? "",
				due: `${t("today.duePastLower")} · ${wd(tk.due_date?.slice(0, 10) ?? tdy)}`,
			};
		});

		const risky = goalsAll
			.filter((g) => {
				const w = firmsWs.find((x) => x.id === g.wsId);
				if (!w) return false; // osobní/mimo tým
				if (firm && g.wsId !== firm) return false;
				return goalRisk(g);
			})
			.map((g) => ({
				...g,
				firm: firmsWs.find((x) => x.id === g.wsId)?.name ?? "",
			}));

		// vázne v postupech — bez firm filtru (prototyp stuck2 vf nefiltruje)
		const stuck = flowsAll.filter((f) => f.stuck);

		const feed: { key: string; ini: string; txt: string; t: string }[] = [];
		// completed_at je UTC ISO → formátovat lokálně (slice by ukázal čas o 2 h jinak)
		const hhmm = (iso: string | null) =>
			iso && iso.length >= 16
				? new Intl.DateTimeFormat(i18n.language, {
						hour: "2-digit",
						minute: "2-digit",
					}).format(new Date(iso))
				: "";
		allT
			.filter((tk) => inF(tk) && tk.completed_at && tk.completed_at.slice(0, 10) === tdy)
			.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
			.slice(0, 4)
			.forEach((tk) => {
				const uid = asgByTask.get(tk.id)?.[0] ?? tk.created_by;
				const who = uid ? (members.get(uid) ?? "") : "";
				const pj = tk.project_id ? projById.get(tk.project_id) : undefined;
				feed.push({
					key: tk.id,
					ini: who ? initials(who) : "✓",
					txt: t("velin.feedDone", {
						who: who.split(" ")[0] || "—",
						name: tk.name ?? "",
						project: pj?.name ?? "",
					}),
					t: hhmm(tk.completed_at),
				});
			});

		return {
			firms,
			load,
			ovRows,
			risky,
			stuck,
			feed,
			kOpen: allT.filter((tk) => !tk.completed_at && inF(tk)).length,
			kOv: ovRowsAll.length,
			kRisk: risky.length,
		};
	}, [
		allTasks,
		assignments,
		projects,
		firmsWs,
		goalsAll,
		flowsAll,
		members,
		firm,
		t,
		i18n.language,
		dayKey,
	]);

	const todayLabel = useMemo(() => {
		const d = new Date(`${dayKey}T12:00:00`);
		const wd = new Intl.DateTimeFormat(i18n.language, {
			weekday: "short",
		}).format(d);
		return `${wd} ${d.getDate()}. ${d.getMonth() + 1}.`;
	}, [i18n.language, dayKey]);
	const metricTimeZone = useMemo(deviceTimeZone, []);
	const metricDate = useMemo(
		() =>
			new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
				new Date(`${dayKey}T12:00:00`),
			),
		[i18n.language, dayKey],
	);
	const selectedFirmName = firmsWs.find((workspace) => workspace.id === firm)?.name;
	const metricScope = t("metrics.scopeCompanies", {
		scope: selectedFirmName ?? t("metrics.allCompanies"),
	});
	const metricPeriod = t("metrics.currentState", { date: metricDate });
	const mailFreshness = digest ? t("metrics.mailDemoFreshness") : t("metrics.mailUnavailable");

	// Dokud workspaces nedorazí (studený start přímo na /velin), NEjde o odepření,
	// jen o načítání — locked screen by oprávněnému vedení jinak na okamžik problikl.
	if (workspaces === undefined) {
		return <div className="mx-auto" style={{ maxWidth: 1120, padding: "18px 22px 90px" }} />;
	}

	// zamčená obrazovka pro ne-vedení (prototyp locked, ř. 949–955)
	if (!leadership) {
		return (
			<div className="mx-auto" style={{ maxWidth: 1120, padding: "18px 22px 90px" }}>
				<div className="text-center" style={{ padding: "80px 20px" }}>
					<div
						className="flex items-center justify-center rounded-xl border border-line bg-panel-2"
						style={{ width: 44, height: 44, margin: "0 auto 14px" }}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--w-ink-3)"
							strokeWidth="1.9"
							aria-hidden
						>
							<rect x="5" y="10.5" width="14" height="9.5" rx="2" />
							<path d="M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5" />
						</svg>
					</div>
					<div
						className="font-display font-bold text-ink"
						style={{ fontSize: 15, marginBottom: 5 }}
					>
						{t("velin.lockedTitle")}
					</div>
					<div className="mx-auto font-body text-ink-3" style={{ fontSize: 13, maxWidth: "44ch" }}>
						{t("velin.lockedBody", { name: session?.user?.name ?? "" })}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto" style={{ maxWidth: 1120, padding: "18px 22px 90px" }}>
			{/* chipy firem + datum */}
			<div className="flex flex-wrap items-center" style={{ gap: 8, marginBottom: 14 }}>
				<Chip label={t("velin.chipAll")} on={!firm} onClick={() => setFirm(null)} />
				{firmsWs.map((w) => (
					<Chip
						key={w.id}
						label={w.name}
						dot={w.color ?? "var(--w-ink-3)"}
						on={firm === w.id}
						onClick={() => setFirm(firm === w.id ? null : w.id)}
					/>
				))}
				<div className="flex-1" />
				<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
					{todayLabel} · {t("velin.liveData")}
				</span>
			</div>

			{/* karty firem */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
					gap: 12,
					marginBottom: 14,
				}}
			>
				{view.firms.map((f) => {
					const on = firm === f.id;
					return (
						<div
							key={f.id}
							role="button"
							tabIndex={0}
							aria-pressed={on}
							onClick={() => setFirm(on ? null : f.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setFirm(on ? null : f.id);
								}
							}}
							className="cursor-pointer rounded-[14px]"
							style={{
								padding: "13px 15px",
								background: on ? "var(--w-ink)" : "var(--w-card)",
								color: on ? "var(--w-card)" : "var(--w-ink)",
								border: `1px solid ${on ? "var(--w-ink)" : "var(--w-line)"}`,
							}}
						>
							<div className="flex items-center" style={{ gap: 8 }}>
								<span
									className="shrink-0"
									style={{
										width: 9,
										height: 9,
										borderRadius: 3,
										background: f.color ?? "var(--w-ink-3)",
									}}
								/>
								<span className="flex-1 truncate font-display font-bold" style={{ fontSize: 13.5 }}>
									{f.name}
								</span>
								{f.ov > 0 && (
									<span className="font-mono" style={{ fontSize: 10.5, color: "var(--w-overdue)" }}>
										⚠ {f.ov}
									</span>
								)}
							</div>
							<div
								className="flex font-mono"
								style={{ gap: 13, marginTop: 9, fontSize: 11, opacity: 0.85 }}
							>
								<span>{t("velin.openCount", { count: f.open })}</span>
								<span>✓ {f.doneN}</span>
								{f.risk > 0 && <span>◎ {t("velin.riskCount", { count: f.risk })}</span>}
							</div>
						</div>
					);
				})}
			</div>

			<RadarPanel
				workspaceId={firm}
				onOpenTask={open}
				onOpenDecision={(id, workspaceId) => {
					setActiveWs(workspaceId);
					void navigate({ to: "/meets", search: { decision: id, prostor: workspaceId } });
				}}
			/>

			{/* KPI mají vlastní viditelný datový kontrakt; zásadní omezení nejsou schovaná v tooltipu. */}
			<div
				className="grid gap-3.5"
				style={{
					gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
					marginBottom: 14,
				}}
			>
				<KpiCard
					compact
					value={kpi(ready, view.kOpen)}
					label={t("velin.kpiOpen")}
					definition={{
						scope: metricScope,
						period: metricPeriod,
						timeZone: metricTimeZone,
						exclusions: t("velin.excludeTasks"),
						formula: t("velin.formulaOpen"),
					}}
				/>
				<KpiCard
					compact
					value={kpi(ready, view.kOv)}
					label={t("velin.kpiOverdue")}
					color="var(--w-overdue)"
					definition={{
						scope: metricScope,
						period: metricPeriod,
						timeZone: metricTimeZone,
						exclusions: t("velin.excludeTasks"),
						formula: t("velin.formulaOverdue"),
					}}
				/>
				<KpiCard
					compact
					value={digest ? String(digest.unread) : "–"}
					label={t("velin.kpiUnread")}
					definition={{
						scope: t("velin.scopeMailDemo"),
						period: metricPeriod,
						timeZone: metricTimeZone,
						exclusions: t("velin.excludeUnread"),
						formula: t("velin.formulaUnread"),
						freshness: mailFreshness,
					}}
				/>
				<KpiCard
					compact
					value={digest ? String(digest.urgent) : "–"}
					label={t("velin.kpiUrgent")}
					color="var(--w-brass-text)"
					definition={{
						scope: t("velin.scopeMailDemo"),
						period: metricPeriod,
						timeZone: metricTimeZone,
						exclusions: t("velin.excludeUrgent"),
						formula: t("velin.formulaUrgent"),
						freshness: mailFreshness,
					}}
				/>
				<KpiCard
					compact
					value={kpi(ready, view.kRisk)}
					label={t("velin.kpiRisk")}
					definition={{
						scope: metricScope,
						period: metricPeriod,
						timeZone: metricTimeZone,
						exclusions: t("velin.excludeGoals"),
						formula: t("velin.formulaRisk"),
					}}
				/>
			</div>

			{/* grid karet */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
					gap: 14,
					alignItems: "start",
				}}
			>
				{/* Po termínu */}
				{view.ovRows.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("velin.cardOverdue")}
							foot={String(view.kOv)}
							footColor="var(--w-overdue)"
						/>
						{view.ovRows.map((r) => (
							<Row key={r.id} onClick={() => open(r.id)}>
								<NavyAvatar text={r.ini} />
								<div className="min-w-0 flex-1">
									<div className="truncate font-body text-ink" style={{ fontSize: 12.5 }}>
										{r.name}
									</div>
									<div className="flex items-center" style={{ gap: 6, marginTop: 1 }}>
										<span
											className="shrink-0 rounded-full"
											style={{ width: 6, height: 6, background: r.projColor }}
										/>
										<span className="font-body text-ink-3" style={{ fontSize: 10.5 }}>
											{r.projName}
										</span>
									</div>
								</div>
								<span
									className="shrink-0 font-mono"
									style={{ fontSize: 10.5, color: "var(--w-overdue)" }}
								>
									{r.due}
								</span>
							</Row>
						))}
					</div>
				)}

				{/* Zátěž lidí */}
				<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("velin.cardLoad")}
						foot={t("velin.openReports")}
						onFoot={() => void navigate({ to: "/reporty", search: { tab: "lide" } })}
					/>
					{view.load.length === 0 && (
						<div
							className="font-body text-ink-3"
							style={{ padding: "8px 16px 16px", fontSize: 12.5 }}
						>
							{t("velin.emptyLoad")}
						</div>
					)}
					{view.load.map((p) => (
						<Row
							key={p.id}
							onClick={() =>
								setPeek({
									kind: "member",
									id: p.id,
									name: p.name,
									openFull: () =>
										void navigate({
											to: "/reporty",
											search: { tab: "lide", clen: p.id },
										}),
								})
							}
							pad="7px 16px"
						>
							<NavyAvatar text={p.initials} />
							<span
								className="shrink-0 truncate font-display font-semibold text-ink"
								style={{ width: 110, fontSize: 12 }}
							>
								{p.name}
							</span>
							<div className="flex-1 overflow-hidden rounded-full bg-panel-2" style={{ height: 6 }}>
								<div
									style={{
										height: "100%",
										width: `${Math.min(100, p.open * 12)}%`,
										background: p.ov > 0 ? "var(--w-overdue)" : "var(--w-brass)",
										borderRadius: "inherit",
									}}
								/>
							</div>
							<span
								className="shrink-0 text-right font-mono text-ink-2"
								style={{ fontSize: 11, width: 20 }}
							>
								{p.open}
							</span>
							{p.ov > 0 && (
								<span
									className="shrink-0 font-mono"
									style={{ fontSize: 10, color: "var(--w-overdue)" }}
								>
									⚠ {p.ov}
								</span>
							)}
						</Row>
					))}
				</div>

				{/* Pošta — urgence a SLA (prototyp urg, ř. 1027–1041) */}
				{urgMails.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("velin.cardMail")}
							foot={t("velin.openMail")}
							onFoot={() => void navigate({ to: "/mail" })}
						/>
						{urgMails.map((mm) => (
							<Row
								key={mm.id}
								onClick={() =>
									setPeek({
										kind: "mail",
										id: mm.id,
										openFull: () => {
											openMailThread?.(mm.id);
											void navigate({ to: "/mail" });
										},
									})
								}
							>
								<span
									className="shrink-0 font-mono"
									style={{
										fontSize: 10,
										color: "var(--w-overdue)",
										border: "1px solid var(--w-overdue)",
										borderRadius: 5,
										padding: "0 5px",
									}}
								>
									{mm.flag.toUpperCase()}
								</span>
								<div className="min-w-0 flex-1">
									<div className="truncate font-body text-ink" style={{ fontSize: 12.5 }}>
										{mm.subj}
									</div>
									<div className="font-body text-ink-3" style={{ fontSize: 10.5, marginTop: 1 }}>
										{mm.from} · {mm.mbShort}
									</div>
								</div>
							</Row>
						))}
					</div>
				)}

				{/* Cíle v riziku */}
				{view.risky.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("velin.cardRisk")}
							foot={t("velin.openGoals")}
							onFoot={() => void navigate({ to: "/cile" })}
						/>
						{view.risky.map((g) => (
							<Row
								key={g.id}
								column
								onClick={() =>
									setPeek({
										kind: "goal",
										goal: g,
										openFull: () => {
											if (g.wsId) setActiveWs(g.wsId);
											void navigate({ to: "/cile" });
										},
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 12.5 }}
									>
										{g.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10 }}>
										{g.firm}
									</span>
									<span
										className="shrink-0 font-display font-bold text-brass-text"
										style={{ fontSize: 12 }}
									>
										{g.pct} %
									</span>
								</div>
								<div
									className="overflow-hidden rounded-full bg-panel-2"
									style={{ height: 5, marginTop: 7 }}
								>
									<div
										style={{
											height: "100%",
											width: `${Math.min(100, g.pct)}%`,
											background: "var(--w-brass)",
											borderRadius: "inherit",
										}}
									/>
								</div>
							</Row>
						))}
					</div>
				)}

				{/* Vázne v postupech */}
				{view.stuck.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("velin.cardStuck")}
							foot={t("velin.openFlows")}
							onFoot={() => void navigate({ to: "/postupy" })}
						/>
						{view.stuck.map((f) => (
							<Row
								key={f.id}
								column
								onClick={() =>
									setPeek({
										kind: "flow",
										flow: f,
										openFull: () =>
											void navigate({
												to: "/postupy",
												search: { postup: f.id },
											}),
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="shrink-0 rounded-full"
										style={{ width: 7, height: 7, background: "var(--w-overdue)" }}
									/>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 12.5 }}
									>
										{f.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{f.done}/{f.total}
									</span>
								</div>
								<div className="font-body text-ink-3" style={{ fontSize: 11, marginTop: 4 }}>
									{t("velin.stuckNow", {
										name: f.nowName,
										who: f.nowWho || t("flows.anyoneTeam"),
									})}
								</div>
							</Row>
						))}
					</div>
				)}

				{/* Dnes se stalo */}
				{view.feed.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead title={t("velin.cardFeed")} />
						{view.feed.map((f) => (
							<div
								key={f.key}
								className="flex items-start border-line border-t"
								style={{ gap: 10, padding: "8px 16px" }}
							>
								<span
									className="flex shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 font-display font-bold text-ink-2"
									style={{ width: 24, height: 24, fontSize: 9 }}
								>
									{f.ini}
								</span>
								<span
									className="min-w-0 flex-1 font-body text-ink-2"
									style={{ fontSize: 12, lineHeight: 1.45 }}
								>
									{f.txt}
								</span>
								<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10 }}>
									{f.t}
								</span>
							</div>
						))}
					</div>
				)}
			</div>

			<PeekPanel target={peek} onClose={() => setPeek(null)} />
		</div>
	);
}

function Chip({
	label,
	dot,
	on,
	onClick,
}: {
	label: string;
	dot?: string;
	on: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex items-center font-display font-semibold"
			style={{
				gap: 7,
				fontSize: 12,
				borderRadius: 999,
				padding: "5px 13px",
				background: on ? "var(--w-ink)" : "var(--w-card)",
				color: on ? "var(--w-card)" : "var(--w-ink-2)",
				border: `1px solid ${on ? "var(--w-ink)" : "var(--w-line)"}`,
			}}
		>
			{dot && (
				<span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: dot }} />
			)}
			{label}
		</button>
	);
}

function Row({
	children,
	onClick,
	column,
	pad,
}: {
	children: ReactNode;
	onClick?: () => void;
	column?: boolean;
	pad?: string;
	}) {
	return (
		// Biome neumí odvodit, že role, tabIndex i klávesová obsluha jsou přítomné
		// současně právě tehdy, když je řádek interaktivní.
		// biome-ignore lint/a11y/noStaticElementInteractions: podmíněná interaktivita má shodně podmíněnou sémantiku i klávesnici
		<div
			onClick={onClick}
			role={onClick ? "button" : undefined}
			tabIndex={onClick ? 0 : undefined}
			onKeyDown={
				onClick
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onClick();
							}
						}
					: undefined
			}
			className="cursor-pointer border-line border-t hover:bg-panel-2"
			style={
				column
					? { padding: pad ?? "9px 16px 11px" }
					: {
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: pad ?? "8px 16px",
						}
			}
		>
			{children}
		</div>
	);
}
