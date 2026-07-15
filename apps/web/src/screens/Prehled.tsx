import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from "react";
import { CalendarWidget } from "../components/CalendarWidget";
import { PeekPanel, type PeekTarget } from "../components/PeekPanel";
import { useFlowSteps } from "../lib/flowSteps";
import { initials } from "../lib/format";
import { inboxProjectIds, isInboxTask } from "../lib/inbox";
import { useAllMembers, useFlowsOverview, useGoalsOverview } from "../lib/overview";
import type { ListItemRow, ListRow, TaskRow } from "../lib/powersync/AppSchema";
import { useMailDigest, useOpenMailThread } from "../mail/state";
import { powerSync } from "../lib/powersync/db";
import { LoadingNote, SyncStamp, useAllReady } from "../lib/dataState";
import { useProjectsWithState } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { startMinOf, todayISO, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { storageGet, storageSet } from "../lib/storage";
import { pushUndo } from "../lib/undo";
import { useSession } from "../lib/auth-client";
import { useWorkspaces } from "../lib/workspace";

/**
 * Přehled — domovská syntéza celé appky (prototyp ř. 698–835 + prehledView ř. 3850–3888):
 * chipy firem (filtr), pruh „Watsonova syntéza dne" s akcemi, karty Dnes / Cíle v ohrožení /
 * Vázne v postupech / Dění týmu v gridu. Karty Pošta a Nejbližší akce se připojí
 * s Mail modulem a Seznamy (další várky handoffu).
 */

const cardCls = "overflow-hidden rounded-[14px] border border-line bg-card";
const cardStyle: CSSProperties = { boxShadow: "var(--w-shadow-sm)" };

function CardHead({
	title,
	footLabel,
	onFoot,
}: {
	title: string;
	footLabel?: string;
	onFoot?: () => void;
}) {
	return (
		<div className="flex items-center" style={{ gap: 8, padding: "13px 16px 9px" }}>
			<span className="flex-1 font-display font-bold text-ink" style={{ fontSize: 13.5 }}>
				{title}
			</span>
			{footLabel && (
				<button
					type="button"
					onClick={onFoot}
					className="font-display font-semibold text-brass-text hover:underline"
					style={{ fontSize: 11.5 }}
				>
					{footLabel}
				</button>
			)}
		</div>
	);
}

function Bar({ pct, color }: { pct: number; color?: string }) {
	return (
		<div className="overflow-hidden rounded-full bg-panel-2" style={{ height: 5 }}>
			<div
				style={{
					height: "100%",
					width: `${Math.min(100, pct)}%`,
					background: color ?? "var(--w-brass)",
					borderRadius: "inherit",
				}}
			/>
		</div>
	);
}

export function Prehled() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { open } = useTaskDetail();
	const { data: session } = useSession();
	const { data: workspaces } = useWorkspaces();
	const { projects, isLoading: projLoading } = useProjectsWithState();
	const flowSteps = useFlowSteps();
	const goalsAll = useGoalsOverview(t);
	const flowsAll = useFlowsOverview();
	const members = useAllMembers();
	// Digest pošty z mail modulu (bez filtru firmy — seed světy se liší, viz state.tsx).
	const digest = useMailDigest();
	const openMailThread = useOpenMailThread();
	// ovFirm — filtr firmy (prototyp: null = Vše)
	const [firm, setFirm] = useState<string | null>(null);
	// peek — náhled položky na místě (feedback: neodvádět z Přehledu pryč)
	const [peek, setPeek] = useState<PeekTarget | null>(null);
	// ovLayout (prototyp prop prehledLayout: Mřížka | Ranní feed) — per-user volba
	const [layout, setLayout] = useState<"grid" | "feed">(() =>
		storageGet("watson.ovLayout") === "feed" ? "feed" : "grid",
	);
	const switchLayout = (v: "grid" | "feed") => {
		setLayout(v);
		storageSet("watson.ovLayout", v);
	};

	// kind IS NOT 'meeting' — KPI/přehled počítá úkoly; porady nezkreslují čísla
	const { data: allTasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE kind IS NOT 'meeting'",
	);
	// Seznamy (checklisty) — karta „Nejbližší akce" (prototyp akce, ř. 3863).
	const { data: allLists, isLoading: listsLoading } = usePsQuery<ListRow>(
		"SELECT * FROM lists WHERE archived = 0 OR archived IS NULL ORDER BY created_at DESC",
	);
	const { data: allListItems, isLoading: itemsLoading } = usePsQuery<ListItemRow>(
		"SELECT id, list_id, done FROM list_items",
	);
	// pro feed „kdo dokončil" — první přiřazený, fallback tvůrce (jako Velín)
	const { data: assignments, isLoading: asgLoading } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");
	// CC-P0-01: 0 / „vše odbaveno" se smí tvrdit až po doběhnutí všech dotazů —
	// undefined běžícího dotazu není autoritativní prázdno.
	const ready = useAllReady(projLoading, tasksLoading, listsLoading, itemsLoading, asgLoading);

	const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
	const firms = useMemo(() => (workspaces ?? []).filter((w) => !w.isPersonal), [workspaces]);

	const view = useMemo(() => {
		const tdy = todayISO();
		const inboxIds = inboxProjectIds(projects);
		const wsOfTask = (tk: TaskRow) =>
			tk.project_id ? (projById.get(tk.project_id)?.workspace_id ?? null) : null;
		const fOk = (tk: TaskRow) => !firm || wsOfTask(tk) === firm;
		// otevřené úkoly bez inboxu, bez podúkolů bez termínu, bez spících kroků (Dnes pravidla)
		const openT = (allTasks ?? []).filter((tk) => {
			if (tk.completed_at || isInboxTask(tk, inboxIds)) return false;
			if (tk.parent_id && !tk.due_date) return false;
			const fs = flowSteps.get(tk.id);
			return !(fs && (fs.state === "waiting" || fs.state === "dormant"));
		});
		// deterministické řazení — bez něj po UPDATE řádku (např. přejmenování
		// v detailu) přeskočí pořadí SQL výsledku a úkol „zmizí" z top-6 výřezu
		const ovd = openT
			.filter((tk) => fOk(tk) && !!tk.due_date && tk.due_date.slice(0, 10) < tdy)
			.sort(
				(a, b) =>
					(a.due_date ?? "").localeCompare(b.due_date ?? "") ||
					(a.priority ?? 4) - (b.priority ?? 4) ||
					(a.name ?? "").localeCompare(b.name ?? ""),
			);
		const tdyRows = openT
			.filter((tk) => fOk(tk) && tk.due_date?.slice(0, 10) === tdy)
			.sort(
				(a, b) =>
					(a.priority ?? 4) - (b.priority ?? 4) ||
					(a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"),
			);
		const wd = (iso: string) =>
			new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(
				new Date(`${iso}T00:00:00`),
			);
		const dnes = ovd
			.concat(tdyRows)
			.slice(0, 6)
			.map((tk) => {
				const isOver = !!tk.due_date && tk.due_date.slice(0, 10) < tdy;
				const due = isOver
					? `${t("today.duePastLower")} · ${wd(tk.due_date?.slice(0, 10) ?? tdy)}`
					: startMinOf(tk) !== null
						? `${String(Math.floor((startMinOf(tk) ?? 0) / 60)).padStart(2, "0")}:${String(
								(startMinOf(tk) ?? 0) % 60,
							).padStart(2, "0")}`
						: "";
				return {
					id: tk.id,
					name: tk.name ?? "",
					color: tk.project_id ? (projById.get(tk.project_id)?.color ?? null) : null,
					p1: (tk.priority ?? 4) === 1,
					isOver,
					due,
					row: tk,
				};
			});
		const dnesMore = Math.max(0, ovd.length + tdyRows.length - 6);

		const risk = goalsAll
			.filter((g) => {
				if (g.status !== "risk" && g.status !== "over") return false;
				const gw = (workspaces ?? []).find((w) => w.id === g.wsId);
				if (firm) {
					if (gw?.isPersonal) return false;
					if (g.wsId !== firm) return false;
				}
				return true;
			})
			.slice(0, 3);

		const stuck = flowsAll
			.filter(
				(f) =>
					f.stuck &&
					(!firm ||
						(f.projectId ? projById.get(f.projectId)?.workspace_id === firm : f.wsId === firm)),
			)
			.slice(0, 2);

		// Nejbližší akce — aktivní seznamy s progresem (prototyp akce, slice 3)
		const itemsByList = new Map<string, { total: number; done: number }>();
		for (const it of allListItems ?? []) {
			if (!it.list_id) continue;
			const s = itemsByList.get(it.list_id) ?? { total: 0, done: 0 };
			s.total++;
			if (it.done) s.done++;
			itemsByList.set(it.list_id, s);
		}
		const akce = (allLists ?? [])
			.filter((l) => !firm || l.workspace_id === firm)
			.slice(0, 3)
			.map((l) => {
				const s = itemsByList.get(l.id) ?? { total: 0, done: 0 };
				return {
					id: l.id,
					name: l.name ?? "",
					event: l.event ?? "",
					pct: s.total ? Math.round((s.done / s.total) * 100) : 0,
					label: `${s.done}/${s.total}`,
				};
			});

		// Dění týmu: dnes dokončené (kdo = první přiřazený, fallback tvůrce) + aktivní kroky postupů
		const feed: { key: string; ini: string; txt: string; t: string }[] = [];
		// completed_at je UTC ISO → formátovat lokálně (slice by ukázal čas o 2 h jinak)
		const hhmm = (iso: string | null) =>
			iso && iso.length >= 16
				? new Intl.DateTimeFormat(i18n.language, {
						hour: "2-digit",
						minute: "2-digit",
					}).format(new Date(iso))
				: "";
		// completed_at je UTC ISO → převod na LOKÁLNÍ den (en-CA = YYYY-MM-DD),
		// jinak úkol dokončený těsně po půlnoci spadne do včerejška/zítřka
		const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
		(allTasks ?? [])
			.filter((tk) => fOk(tk) && tk.completed_at && localDay(tk.completed_at) === tdy)
			.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
			.slice(0, 3)
			.forEach((tk) => {
				const uid = (assignments ?? []).find((a) => a.task_id === tk.id)?.user_id ?? tk.created_by;
				const who = uid ? (members.get(uid) ?? "") : "";
				feed.push({
					key: `d${tk.id}`,
					ini: who ? initials(who) : "✓",
					txt: t("prehled.feedDone", {
						who: who.split(" ")[0] || "—",
						name: tk.name ?? "",
					}),
					t: hhmm(tk.completed_at),
				});
			});
		flowsAll
			.filter(
				(f) =>
					f.hasNow &&
					(!firm ||
						(f.projectId ? projById.get(f.projectId)?.workspace_id === firm : f.wsId === firm)),
			)
			.slice(0, 2)
			.forEach((f) => {
				feed.push({
					key: `f${f.id}`,
					ini: f.nowWho ? initials(f.nowWho.split(", ")[0] ?? "") : "→",
					txt: t("prehled.feedFlow", { flow: f.name, name: f.nowName }),
					t: "",
				});
			});

		// Watsonova syntéza — max 3 věty (prototyp parts)
		const parts: string[] = [];
		if (ovd.length) {
			const first = ovd[0]?.name ?? "";
			parts.push(
				t("prehled.synOverdue", {
					count: ovd.length,
					name: first.length > 44 ? `${first.slice(0, 42)}…` : first,
				}),
			);
		}
		// urgentní vlákna v poště (prototyp: p1/p2 max 2 jména)
		const urgM = (digest?.items ?? []).filter((x) => x.flag === "p1" || x.flag === "p2");
		if (urgM.length) {
			const names = urgM
				.slice(0, 2)
				.map((x) => `„${x.subj.length > 36 ? `${x.subj.slice(0, 34)}…` : x.subj}“`)
				.join(", ");
			parts.push(
				t(urgM.length === 1 ? "prehled.synMailOne" : "prehled.synMailMany", {
					names,
				}),
			);
		}
		const r0 = risk[0];
		if (r0)
			parts.push(
				t("prehled.synRisk", {
					name: r0.name,
					label: r0.label,
					elapsed: r0.elapsed,
				}),
			);
		const a0 = akce[0];
		if (parts.length < 3 && a0)
			parts.push(t("prehled.synChecklist", { name: a0.name, pct: a0.pct }));

		return {
			ovd,
			dnes,
			dnesMore,
			risk,
			stuck,
			akce,
			feed: feed.slice(0, 5),
			syn: parts.slice(0, 3).join(" ") || t("prehled.synCalm"),
		};
	}, [
		allTasks,
		allLists,
		allListItems,
		assignments,
		digest,
		projects,
		projById,
		flowSteps,
		goalsAll,
		flowsAll,
		members,
		firm,
		workspaces,
		t,
		i18n.language,
	]);

	// „Přeplánovat zpožděné" — všechny zpožděné na dnes, jedním undo záznamem (prototyp reschedule)
	// Pojistka proti dvojkliku: bez ní dva rychlé kliky vyrobí 2 undo záznamy a 2 toasty.
	const reschedulingRef = useRef(false);
	const rescheduleOverdue = async () => {
		if (reschedulingRef.current) return;
		reschedulingRef.current = true;
		try {
			await doReschedule();
		} finally {
			reschedulingRef.current = false;
		}
	};
	const doReschedule = async () => {
		const tdy = todayISO();
		// S4 (R4) — opakované úkoly VYNECHAT: posun due_date by přepsal kotvu celé
		// řady bez dotazu „tento / tento a další / celá řada" (uprav řadu v detailu).
		const movable = view.ovd.filter((tk) => !tk.recurrence_rule);
		const skipped = view.ovd.length - movable.length;
		const rows = movable.map((tk) => ({ id: tk.id, prev: tk.due_date }));
		if (!rows.length) {
			if (skipped) showToast(t("bulk.recurringSkipped", { count: skipped }));
			return;
		}
		const write = async (vals: { id: string; val: string | null }[]) => {
			await powerSync.writeTransaction(async (tx) => {
				for (const v of vals)
					await tx.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [v.val, v.id]);
			});
		};
		await write(rows.map((r) => ({ id: r.id, val: tdy })));
		pushUndo({
			undo: () => write(rows.map((r) => ({ id: r.id, val: r.prev }))),
			redo: () => write(rows.map((r) => ({ id: r.id, val: tdy }))),
		});
		showToast(
			[
				t("prehled.rescheduledToast", { count: rows.length }),
				...(skipped ? [t("bulk.recurringSkipped", { count: skipped })] : []),
			].join(" · "),
		);
	};

	const todayLabel = useMemo(() => {
		const d = new Date();
		const wd = new Intl.DateTimeFormat(i18n.language, {
			weekday: "short",
		}).format(d);
		return `${wd} ${d.getDate()}. ${d.getMonth() + 1}.`;
	}, [i18n.language]);

	const synActions: { key: string; label: string; onClick: () => void }[] = [
		...(view.ovd.length
			? [
					{
						key: "a1",
						label: t("prehled.actReschedule"),
						onClick: () => void rescheduleOverdue(),
					},
				]
			: []),
		{
			key: "a2",
			label: t("prehled.actMail"),
			onClick: () => void navigate({ to: "/mail" }),
		},
		...(view.risk.length
			? [
					{
						key: "a3",
						label: t("prehled.actGoals"),
						onClick: () => void navigate({ to: "/cile" }),
					},
				]
			: []),
	];

	return (
		<div className="mx-auto" style={{ maxWidth: 1120, padding: "18px 22px 90px" }}>
			{/* chipy firem (prototyp data-ovchip) */}
			<div className="flex flex-wrap items-center" style={{ gap: 8, marginBottom: 14 }}>
				<FirmChip label={t("prehled.chipAll")} on={!firm} onClick={() => setFirm(null)} />
				{firms.map((w) => (
					<FirmChip
						key={w.id}
						label={w.name}
						dot={w.color ?? "var(--w-ink-3)"}
						on={firm === w.id}
						onClick={() => setFirm(firm === w.id ? null : w.id)}
					/>
				))}
				<div className="flex-1" />
				{/* přepínač layoutu (prototyp prop prehledLayout: Mřížka | Ranní feed) */}
				<div className="flex rounded-lg border border-line bg-panel-2" style={{ padding: 2 }}>
					{(
						[
							["grid", t("prehled.layoutGrid")],
							["feed", t("prehled.layoutFeed")],
						] as const
					).map(([k, label]) => (
						<button
							key={k}
							type="button"
							onClick={() => switchLayout(k)}
							className="rounded-md font-display font-semibold"
							style={{
								fontSize: 10.5,
								padding: "3px 9px",
								background: layout === k ? "var(--w-card)" : "transparent",
								color: layout === k ? "var(--w-ink)" : "var(--w-ink-3)",
								boxShadow: layout === k ? "var(--w-shadow-sm)" : undefined,
							}}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* Watsonova syntéza dne */}
			<div
				className="flex items-start"
				style={{
					gap: 12,
					background: "var(--w-brass-soft)",
					border: "1px solid rgba(198,138,62,.32)",
					borderRadius: 14,
					padding: "15px 18px",
					marginBottom: 14,
				}}
			>
				<span
					className="shrink-0 rounded-full"
					style={{ width: 9, height: 9, background: "var(--w-brass)", marginTop: 6 }}
				/>
				<div className="min-w-0 flex-1">
					<div
						className="font-display font-bold text-brass-text uppercase"
						style={{ fontSize: 10.5, letterSpacing: ".07em", marginBottom: 4 }}
					>
						{t("prehled.synTitle")} · {todayLabel} <SyncStamp />
					</div>
					<div
						className="font-body text-ink"
						style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "82ch" }}
					>
						{ready ? view.syn : t("common.loadingData")}
					</div>
					{ready && synActions.length > 0 && (
						<div className="flex flex-wrap" style={{ gap: 8, marginTop: 11 }}>
							{synActions.map((a) => (
								<button
									key={a.key}
									type="button"
									onClick={a.onClick}
									className="rounded-lg border border-line bg-card font-display font-semibold text-ink-2 hover:border-brass hover:text-ink"
									style={{ fontSize: 12, padding: "5px 12px" }}
								>
									{a.label}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* karty — Mřížka / Ranní feed (prototyp data-ovlay, CSS ř. 118–119) */}
			<div
				style={
					layout === "feed"
						? {
								display: "flex",
								flexDirection: "column",
								gap: 14,
								maxWidth: 680,
								margin: "0 auto",
							}
						: {
								// min(100%, 330px): na úzkém telefonu (~360px) klesne track na
								// šířku kontejneru místo 330px → nevznikne horizontální scroll
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))",
								gap: 14,
								alignItems: "start",
							}
				}
			>
				{/* Dnes */}
				<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardToday")}
						footLabel={
							view.dnesMore > 0
								? t("prehled.moreInToday", { count: view.dnesMore })
								: t("prehled.openToday")
						}
						onFoot={() => void navigate({ to: "/" })}
					/>
					{!ready && <LoadingNote />}
					{ready && view.dnes.length === 0 && (
						<div
							className="font-body text-ink-3"
							style={{ padding: "8px 16px 16px", fontSize: 12.5 }}
						>
							{t("prehled.emptyToday")}
						</div>
					)}
					{view.dnes.map((r) => (
						<OvRow key={r.id} onClick={() => open(r.id)}>
							<button
								type="button"
								aria-label={t("detail.ariaComplete")}
								onClick={(e) => {
									e.stopPropagation();
									void toggleTask(r.row, session?.user?.id);
								}}
								className="grid shrink-0 place-items-center rounded-full border-[1.6px] border-line bg-card text-transparent hover:border-brass"
								style={{ width: 17, height: 17 }}
							>
								<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
									<path
										d="M1.5 5.5 L4 8 L8.5 2.5"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
							<span
								className="shrink-0 rounded-full"
								style={{
									width: 8,
									height: 8,
									background: r.color ?? "var(--w-ink-3)",
								}}
							/>
							<span className="min-w-0 flex-1 truncate font-body text-ink" style={{ fontSize: 13 }}>
								{r.name}
							</span>
							{r.p1 && (
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
									P1
								</span>
							)}
							<span
								className="shrink-0 font-mono"
								style={{
									fontSize: 11,
									color: r.isOver ? "var(--w-overdue)" : "var(--w-ink-3)",
								}}
							>
								{r.due}
							</span>
						</OvRow>
					))}
				</div>

				{/* Kalendář — měsíční widget s denní agendou (feedback 2026-07-11) */}
				<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardCalendar")}
						footLabel={t("prehled.openUpcoming")}
						onFoot={() => void navigate({ to: "/nadchazejici" })}
					/>
					<CalendarWidget
						onDay={(dateISO) =>
							setPeek({
								kind: "day",
								dateISO,
								firm,
								name: new Intl.DateTimeFormat(i18n.language, {
									weekday: "long",
									day: "numeric",
									month: "long",
								}).format(new Date(`${dateISO}T00:00:00`)),
								openFull: () => void navigate({ to: "/nadchazejici" }),
							})
						}
					/>
				</div>

				{/* Pošta — z digestu mail modulu (prototyp mails, ř. 741–765) */}
				{digest && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardMail")}
							footLabel={
								digest.unread > 0
									? t("prehled.mailUnread", { count: digest.unread })
									: t("prehled.openMail")
							}
							onFoot={() => void navigate({ to: "/mail" })}
						/>
						{digest.items.slice(0, 4).map((mm) => (
							<OvRow
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
									className="flex shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 font-display font-bold text-ink-2"
									style={{ width: 26, height: 26, fontSize: 9.5 }}
								>
									{mm.ini}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-center" style={{ gap: 7 }}>
										{mm.unread && (
											<span
												className="shrink-0 rounded-full"
												style={{ width: 7, height: 7, background: "var(--w-brass)" }}
											/>
										)}
										<span
											className="truncate font-display font-semibold text-ink"
											style={{ fontSize: 12.5 }}
										>
											{mm.from}
										</span>
										<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
											{mm.mbShort}
										</span>
									</div>
									<div
										className="truncate font-body text-ink-2"
										style={{ fontSize: 12, marginTop: 1 }}
									>
										{mm.subj}
									</div>
								</div>
								{(mm.flag === "p1" || mm.flag === "p2") && (
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
								)}
								<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
									{mm.time}
								</span>
							</OvRow>
						))}
					</div>
				)}

				{/* Nejbližší akce (Seznamy) */}
				{view.akce.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardEvents")}
							footLabel={t("prehled.allLists")}
							onFoot={() => void navigate({ to: "/seznamy", search: {} })}
						/>
						{view.akce.map((l) => (
							<OvRow
								key={l.id}
								column
								onClick={() =>
									setPeek({
										kind: "list",
										id: l.id,
										name: l.name,
										openFull: () =>
											void navigate({
												to: "/seznamy",
												search: { seznam: l.id },
											}),
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{l.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{l.event}
									</span>
								</div>
								<div className="flex items-center" style={{ gap: 9, marginTop: 7 }}>
									<div
										className="flex-1 overflow-hidden rounded-full bg-panel-2"
										style={{ height: 5 }}
									>
										<div
											style={{
												height: "100%",
												width: `${Math.min(100, l.pct)}%`,
												background: l.pct >= 100 ? "#2e9c6e" : "var(--w-brass)",
												borderRadius: "inherit",
											}}
										/>
									</div>
									<span className="shrink-0 font-mono text-ink-2" style={{ fontSize: 11 }}>
										{l.label}
									</span>
								</div>
							</OvRow>
						))}
					</div>
				)}

				{/* Cíle v ohrožení */}
				{view.risk.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardRisk")}
							footLabel={t("prehled.openGoals")}
							onFoot={() => void navigate({ to: "/cile" })}
						/>
						{view.risk.map((g) => (
							<OvRow
								key={g.id}
								column
								onClick={() =>
									setPeek({
										kind: "goal",
										goal: g,
										openFull: () => void navigate({ to: "/cile" }),
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{g.name}
									</span>
									<span
										className="shrink-0 font-display font-bold text-brass-text"
										style={{ fontSize: 12.5 }}
									>
										{g.pct} %
									</span>
								</div>
								<div style={{ marginTop: 7, width: "100%" }}>
									<Bar pct={g.pct} />
								</div>
								<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginTop: 5 }}>
									{g.label} · {t("prehled.elapsed", { elapsed: g.elapsed })}
								</div>
							</OvRow>
						))}
					</div>
				)}

				{/* Vázne v postupech */}
				{view.stuck.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardStuck")}
							footLabel={t("prehled.openFlows")}
							onFoot={() => void navigate({ to: "/postupy" })}
						/>
						{view.stuck.map((f) => (
							<OvRow
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
										style={{ fontSize: 13 }}
									>
										{f.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{f.done}/{f.total}
									</span>
								</div>
								<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginTop: 4 }}>
									{t("prehled.stuckNow", {
										name: f.nowName,
										who: f.nowWho || t("flows.anyoneTeam"),
									})}
								</div>
							</OvRow>
						))}
					</div>
				)}

				{/* Dění týmu */}
				<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardFeed")}
						footLabel={t("prehled.openReports")}
						onFoot={() => void navigate({ to: "/reporty" })}
					/>
					{!ready && <LoadingNote />}
					{ready && view.feed.length === 0 && (
						<div
							className="font-body text-ink-3"
							style={{ padding: "8px 16px 16px", fontSize: 12.5 }}
						>
							{t("prehled.emptyFeed")}
						</div>
					)}
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
								style={{ fontSize: 12.5, lineHeight: 1.45 }}
							>
								{f.txt}
							</span>
							<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
								{f.t}
							</span>
						</div>
					))}
				</div>
			</div>

			<PeekPanel target={peek} onClose={() => setPeek(null)} />
		</div>
	);
}

/** Chip firmy — aktivní = tmavý (prototyp data-ovchip[data-on]). */
function FirmChip({
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
				cursor: "pointer",
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

/** Řádek karty (prototyp data-ovrow: hover panel-2, klik). */
function OvRow({
	children,
	onClick,
	column,
}: {
	children: ReactNode;
	onClick?: () => void;
	column?: boolean;
}) {
	return (
		<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
			onClick={onClick}
			className="cursor-pointer border-line border-t hover:bg-panel-2"
			style={
				column
					? { padding: "9px 16px 11px" }
					: {
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "8px 16px",
						}
			}
		>
			{children}
		</div>
	);
}
