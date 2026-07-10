import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { useFlowSteps } from "../lib/flowSteps";
import { initials } from "../lib/format";
import { inboxProjectIds, isInboxTask } from "../lib/inbox";
import { useAllMembers, useFlowsOverview, useGoalsOverview } from "../lib/overview";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { todayISO, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
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
			<span
				className="flex-1 font-display font-bold text-ink"
				style={{ fontSize: 13.5 }}
			>
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
		<div
			className="overflow-hidden rounded-full bg-panel-2"
			style={{ height: 5 }}
		>
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
	const projects = useProjects();
	const flowSteps = useFlowSteps();
	const goalsAll = useGoalsOverview(t);
	const flowsAll = useFlowsOverview();
	const members = useAllMembers();
	// ovFirm — filtr firmy (prototyp: null = Vše)
	const [firm, setFirm] = useState<string | null>(null);

	const { data: allTasks } = usePsQuery<TaskRow>("SELECT * FROM tasks");

	const projById = useMemo(
		() => new Map(projects.map((p) => [p.id, p])),
		[projects],
	);
	const wsOfTask = (tk: TaskRow) =>
		tk.project_id ? (projById.get(tk.project_id)?.workspace_id ?? null) : null;
	const firms = (workspaces ?? []).filter((w) => !w.isPersonal);

	const view = useMemo(() => {
		const tdy = todayISO();
		const inboxIds = inboxProjectIds(projects);
		const fOk = (tk: TaskRow) => !firm || wsOfTask(tk) === firm;
		// otevřené úkoly bez inboxu, bez podúkolů bez termínu, bez spících kroků (Dnes pravidla)
		const openT = (allTasks ?? []).filter((tk) => {
			if (tk.completed_at || isInboxTask(tk, inboxIds)) return false;
			if (tk.parent_id && !tk.due_date) return false;
			const fs = flowSteps.get(tk.id);
			return !(fs && (fs.state === "waiting" || fs.state === "dormant"));
		});
		const ovd = openT.filter(
			(tk) => fOk(tk) && !!tk.due_date && tk.due_date.slice(0, 10) < tdy,
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
					: tk.start_date && tk.start_date.length >= 16
						? tk.start_date.slice(11, 16)
						: "";
				return {
					id: tk.id,
					name: tk.name ?? "",
					color: tk.project_id
						? (projById.get(tk.project_id)?.color ?? null)
						: null,
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
						(f.projectId
							? projById.get(f.projectId)?.workspace_id === firm
							: f.wsId === firm)),
			)
			.slice(0, 2);

		// Dění týmu: dnes dokončené (kdo = první přiřazený, fallback tvůrce) + aktivní kroky postupů
		const feed: { key: string; ini: string; txt: string; t: string }[] = [];
		const hhmm = (iso: string | null) =>
			iso && iso.length >= 16 ? iso.slice(11, 16) : "";
		(allTasks ?? [])
			.filter(
				(tk) => fOk(tk) && tk.completed_at && tk.completed_at.slice(0, 10) === tdy,
			)
			.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
			.slice(0, 3)
			.forEach((tk) => {
				const who = tk.created_by ? (members.get(tk.created_by) ?? "") : "";
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
						(f.projectId
							? projById.get(f.projectId)?.workspace_id === firm
							: f.wsId === firm)),
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
		const r0 = risk[0];
		if (r0)
			parts.push(
				t("prehled.synRisk", {
					name: r0.name,
					label: r0.label,
					elapsed: r0.elapsed,
				}),
			);

		return {
			ovd,
			dnes,
			dnesMore,
			risk,
			stuck,
			feed: feed.slice(0, 5),
			syn: parts.slice(0, 3).join(" ") || t("prehled.synCalm"),
		};
	}, [
		allTasks,
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
	const rescheduleOverdue = async () => {
		const tdy = todayISO();
		const rows = view.ovd.map((tk) => ({ id: tk.id, prev: tk.due_date }));
		if (!rows.length) return;
		const write = async (vals: { id: string; val: string | null }[]) => {
			await powerSync.writeTransaction(async (tx) => {
				for (const v of vals)
					await tx.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
						v.val,
						v.id,
					]);
			});
		};
		await write(rows.map((r) => ({ id: r.id, val: tdy })));
		pushUndo({
			undo: () => write(rows.map((r) => ({ id: r.id, val: r.prev }))),
			redo: () => write(rows.map((r) => ({ id: r.id, val: tdy }))),
		});
		showToast(t("prehled.rescheduledToast", { count: rows.length }));
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
			<div
				className="flex flex-wrap items-center"
				style={{ gap: 8, marginBottom: 14 }}
			>
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
						{t("prehled.synTitle")} · {todayLabel}
					</div>
					<div
						className="font-body text-ink"
						style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "82ch" }}
					>
						{view.syn}
					</div>
					{synActions.length > 0 && (
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

			{/* grid karet (data-ovlay Mřížka) */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
					gap: 14,
					alignItems: "start",
				}}
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
					{view.dnes.length === 0 && (
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
							<span
								className="min-w-0 flex-1 truncate font-body text-ink"
								style={{ fontSize: 13 }}
							>
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

				{/* Cíle v ohrožení */}
				{view.risk.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardRisk")}
							footLabel={t("prehled.openGoals")}
							onFoot={() => void navigate({ to: "/cile" })}
						/>
						{view.risk.map((g) => (
							<OvRow key={g.id} column onClick={() => void navigate({ to: "/cile" })}>
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
								<div
									className="font-body text-ink-3"
									style={{ fontSize: 11.5, marginTop: 5 }}
								>
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
									void navigate({ to: "/postupy", search: { postup: f.id } })
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
									<span
										className="shrink-0 font-mono text-ink-3"
										style={{ fontSize: 11 }}
									>
										{f.done}/{f.total}
									</span>
								</div>
								<div
									className="font-body text-ink-3"
									style={{ fontSize: 11.5, marginTop: 4 }}
								>
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
					{view.feed.length === 0 && (
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
							<span
								className="shrink-0 font-mono text-ink-3"
								style={{ fontSize: 10.5 }}
							>
								{f.t}
							</span>
						</div>
					))}
				</div>
			</div>
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
				<span
					className="shrink-0 rounded-full"
					style={{ width: 7, height: 7, background: dot }}
				/>
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
		<div
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
