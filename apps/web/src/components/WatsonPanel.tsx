import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useEffect, useMemo } from "react";
import { useSession } from "../lib/auth-client";
import type { GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";

const todayISO = () => new Date().toISOString().slice(0, 10);

interface Insight {
	id: string;
	text: string;
	action?: string;
	onAction?: () => void;
}

/**
 * Watson drawer (assistant) — 1:1 dle Cloud Design: greet + „Co dnes řešit" (insights
 * z reálných dat) + stat strip (hotovo/po termínu/dnes) + „Tvé cíle tento týden".
 */
export function WatsonPanel({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const navigate = useNavigate();

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const { data: tasks } = usePsQuery<TaskRow>(
		"SELECT id, due_date, completed_at FROM tasks",
	);
	const userId = session?.user?.id;
	const { data: myGoals } = usePsQuery<GoalRow>(
		"SELECT id, name, target, metric FROM goals WHERE owner_id = ? ORDER BY created_at",
		[userId ?? ""],
	);

	const counts = useMemo(() => {
		const tdy = todayISO();
		const all = tasks ?? [];
		const open = all.filter((x) => !x.completed_at);
		const overdue = open.filter((x) => {
			const d = x.due_date?.slice(0, 10);
			return d != null && d < tdy;
		}).length;
		const today = open.filter((x) => {
			const d = x.due_date?.slice(0, 10);
			return d == null || d === tdy;
		}).length;
		const done = all.filter((x) => x.completed_at?.slice(0, 10) === tdy).length;
		return { overdue, today, done };
	}, [tasks]);

	async function rescheduleOverdue() {
		const tdy = todayISO();
		const now = new Date().toISOString();
		const overdue = (tasks ?? []).filter(
			(x) =>
				!x.completed_at && x.due_date != null && x.due_date.slice(0, 10) < tdy,
		);
		for (const tk of overdue) {
			await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
				now,
				tk.id,
			]);
		}
	}

	const hour = new Date().getHours();
	const greeting =
		hour < 11
			? t("today.morning")
			: hour < 18
				? t("today.afternoon")
				: t("today.evening");
	const firstName = session?.user?.name?.split(" ")[0] ?? "";
	const greet = `${greeting}${firstName ? `, ${firstName}` : ""}. ${t(
		"today.summaryToday",
		{
			count: counts.today,
		},
	)}${counts.overdue > 0 ? ` · ${t("today.summaryOverdue", { count: counts.overdue })}` : ""}`;

	const insights: Insight[] = [];
	if (counts.overdue > 0) {
		insights.push({
			id: "overdue",
			text: t("watson.insightOverdue", { count: counts.overdue }),
			action: t("watson.insightOverdueAction"),
			onAction: () => void rescheduleOverdue(),
		});
	} else {
		insights.push({ id: "ok", text: t("watson.insightAllClear") });
	}
	insights.push({
		id: "plan",
		text: t("watson.insightPlan"),
		action: t("watson.insightPlanAction"),
		onAction: () => {
			onClose();
			void navigate({ to: "/nadchazejici" });
		},
	});

	const goals = myGoals ?? [];

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.3)", zIndex: 42 }}
			/>
			<div
				className="fixed top-0 right-0 bottom-0 flex flex-col border-line border-l bg-card"
				style={{
					width: 384,
					maxWidth: "92vw",
					boxShadow: "var(--w-shadow)",
					zIndex: 43,
				}}
			>
				{/* header */}
				<div
					className="flex items-center gap-2.5 border-line border-b"
					style={{ padding: "16px 18px" }}
				>
					<span
						className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-brass-text"
						style={{
							width: 30,
							height: 30,
							border: "2px solid var(--w-brass)",
							fontSize: 13,
						}}
					>
						W
					</span>
					<span
						className="flex-1 font-display font-bold text-ink"
						style={{ fontSize: 16 }}
					>
						{t("watson.title")}
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

				{/* body */}
				<div className="flex-1 overflow-auto" style={{ padding: 18 }}>
					<div
						className="font-display font-bold text-ink"
						style={{ fontSize: 18, lineHeight: 1.3 }}
					>
						{greet}
					</div>

					<div
						className="font-display font-bold text-ink-3 uppercase"
						style={{
							fontSize: 11,
							letterSpacing: ".06em",
							margin: "22px 0 10px",
						}}
					>
						{t("watson.todayHeading")}
					</div>
					{insights.map((i) => (
						<div
							key={i.id}
							className="border-line border bg-panel-2"
							style={{
								borderRadius: 12,
								padding: "13px 14px",
								marginBottom: 10,
							}}
						>
							<div className="flex gap-2.5">
								<span
									className="shrink-0 rounded-full"
									style={{
										width: 6,
										height: 6,
										background: "var(--w-brass)",
										marginTop: 6,
									}}
								/>
								<div
									className="font-body text-ink-2"
									style={{ fontSize: 13.5, lineHeight: 1.5 }}
								>
									{i.text}
								</div>
							</div>
							{i.action && (
								<button
									type="button"
									onClick={i.onAction}
									className="font-display font-semibold text-brass-text hover:underline"
									style={{ margin: "9px 0 0 15px", fontSize: 12.5 }}
								>
									{i.action} →
								</button>
							)}
						</div>
					))}

					{/* stats strip */}
					<div
						className="flex gap-3.5"
						style={{
							marginTop: 18,
							padding: "14px 16px",
							background: "var(--w-sidebar)",
							borderRadius: 12,
						}}
					>
						<Stat
							n={counts.done}
							label={t("watson.statDone")}
							color="var(--w-brass)"
						/>
						<Stat
							n={counts.overdue}
							label={t("watson.statOverdue")}
							color="#e8857c"
						/>
						<Stat n={counts.today} label={t("watson.statToday")} color="#fff" />
					</div>

					{goals.length > 0 && (
						<>
							<div
								className="font-display font-bold text-ink-3 uppercase"
								style={{
									fontSize: 11,
									letterSpacing: ".06em",
									margin: "24px 0 8px",
								}}
							>
								{t("watson.goalsHeading")}
							</div>
							{goals.map((g) => (
								<div
									key={g.id}
									className="flex items-center gap-2 border-line border bg-panel-2"
									style={{
										borderRadius: 10,
										padding: "10px 12px",
										marginBottom: 8,
									}}
								>
									<span
										className="flex-1 font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{g.name}
									</span>
									<span
										className="font-mono text-ink-3"
										style={{ fontSize: 11.5 }}
									>
										{t("watson.goalTarget", { target: g.target ?? 0 })}
									</span>
								</div>
							))}
						</>
					)}
				</div>
			</div>
		</>
	);
}

function Stat({
	n,
	label,
	color,
}: {
	n: number;
	label: string;
	color: string;
}) {
	return (
		<div>
			<div className="font-mono" style={{ fontSize: 22, color }}>
				{n}
			</div>
			<div
				className="font-body"
				style={{ fontSize: 11, color: "rgba(255,255,255,.6)" }}
			>
				{label}
			</div>
		</div>
	);
}
