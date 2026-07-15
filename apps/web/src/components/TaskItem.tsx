import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { TaskCard } from "@watson/ui";
import { useState } from "react";
import { logTaskActivity } from "../lib/activity";
import { useSession } from "../lib/auth-client";
import { useBulkSelect } from "../lib/bulkSelect";
import type { FlowStepInfo } from "../lib/flowSteps";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { type RescheduleKey, rescheduleDate } from "../lib/reschedule";
import { useRowMeta } from "../lib/rowMeta";
import { useTaskDetail } from "../lib/taskDetail";
import { deadlineLabel, rowDue, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { deleteTaskWithUndo, pushColumnUndo } from "../lib/undo";
import { type SwipeMag, useSwipe } from "../lib/useSwipe";
import { useWorkspaces } from "../lib/workspace";
import { type CtxItem, useContextMenu } from "./ContextMenu";

type Pri = 1 | 2 | 3 | 4;
export type TaskProject = {
	name: string | null;
	color: string | null;
	workspace_id?: string | null;
};

/**
 * Sdílená položka seznamu úkolů — plná anatomie řádku dle prototypu: meta ikony
 * (checklist/komentáře/zvonek/↻), chip postupu, deadline vlaječka, status pilulka,
 * avatary/„Každý zvlášť", barva řádku. Klik → detail panel.
 */
export function TaskItem({
	task,
	project,
	wsColor,
	flow,
}: {
	task: TaskRow;
	project?: TaskProject;
	/** Barva workspace (čtvereček před názvem projektu). */
	wsColor?: string;
	/** Krok postupu (chip, klik → postup). */
	flow?: FlowStepInfo;
}) {
	const { t } = useTranslation();
	const { open, navIds } = useTaskDetail();
	const { metaOf } = useRowMeta();
	const { data: session } = useSession();
	const { data: workspaces } = useWorkspaces();
	const navigate = useNavigate();
	const bulk = useBulkSelect();
	const meta = metaOf(task);
	const myId = session?.user?.id;
	// Virtuální výskyty (id@ISO) do hromadných akcí nepatří — mutace cílí na base řadu.
	const selectable = !task.id.includes("@");
	// wsdot — čtvereček barvy prostoru před názvem projektu (prototyp ř. 422 + CSS 105).
	const resolvedWsColor =
		wsColor ??
		(project?.workspace_id
			? ((workspaces ?? []).find((w) => w.id === project.workspace_id)?.color ?? undefined)
			: undefined);
	// „→ Přišlo na tebe" — aktivní krok štafety přiřazený mně (prototyp handedOff).
	const handedOff =
		flow?.state === "active" && !!myId && meta.assigneeIds.includes(myId) && !task.completed_at;

	// Swipe na řádku — jednotný systém s mailem (lib/useSwipe): akce se
	// provede PŘI PUŠTĚNÍ (žádná potvrzovací tlačítka — 6. kolo feedbacku).
	// Akce jsou stavové (reverzní): hotový úkol → „Vrátit".
	const doneTask = Boolean(task.completed_at);
	const [sw, setSw] = useState<{ dx: number; mag: SwipeMag }>({
		dx: 0,
		mag: "none",
	});
	// R4: přímý posun due_date u opakovaného úkolu by přepsal kotvu CELÉ řady bez dotazu
	// tento/další/celá řada. Testujeme recurrence_rule (engine), ne jen recurrence (lidský
	// label může být prázdný) — jinak by guard u některých řad neplatil.
	const isRecurring = Boolean(task.recurrence_rule || task.recurrence);
	const dayLabel = (key: RescheduleKey) =>
		key === "today"
			? t("bulk.today")
			: key === "nextMonday"
				? t("qsched.nextWeekShort")
				: t("bulk.tomorrow");
	const reschedule = (key: RescheduleKey) => {
		if (isRecurring) {
			showToast(t("qsched.recurringBlocked"));
			return;
		}
		const iso = rescheduleDate(key);
		pushColumnUndo("tasks", task.id, "due_date", task.due_date, iso);
		void powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [iso, task.id]);
		showToast(t("bulk.movedToast", { count: 1, day: dayLabel(key) }));
	};
	// změna priority (kontextové menu) — per-sloupcový zápis + undo + historie
	const setPriority = (p: 1 | 2 | 3 | 4) => {
		if ((task.priority ?? 4) === p) return;
		pushColumnUndo("tasks", task.id, "priority", task.priority, p);
		void powerSync.execute("UPDATE tasks SET priority = ? WHERE id = ?", [p, task.id]);
		void logTaskActivity(
			task.id,
			task.project_id,
			myId,
			"priority",
			String(task.priority ?? ""),
			String(p),
		);
	};
	// Kontextové menu (pravý klik / dvouprstý tap) — parita s mailem; u virtuálních
	// výskytů řady (id@ISO) jen bezpečné akce (mutace cílí na base řadu jinak).
	const cm = useContextMenu();
	const ctxItems: CtxItem[] = selectable
		? [
				{ label: t("ctx.open"), onClick: () => open(task.id) },
				{
					label: doneTask ? t("swipe.revert") : t("bulk.done"),
					onClick: () => void toggleTask(task, myId),
				},
				{ sep: true },
				{
					label: t("detail.due"),
					disabled: isRecurring,
					children: (["today", "tomorrow", "nextMonday"] as RescheduleKey[]).map((k) => ({
						label: dayLabel(k),
						onClick: () => reschedule(k),
					})),
				},
				{
					label: t("detail.priority"),
					children: ([1, 2, 3, 4] as const).map((p) => ({
						label: `P${p}`,
						on: (task.priority ?? 4) === p,
						onClick: () => setPriority(p),
					})),
				},
				{ sep: true },
				{
					label: t("bulk.delete"),
					danger: true,
					onClick: () => {
						void deleteTaskWithUndo(task.id);
						showToast(t("bulk.deletedToast", { count: 1 }));
					},
				},
			]
		: [
				{ label: t("ctx.open"), onClick: () => open(task.id) },
				{
					label: doneTask ? t("swipe.revert") : t("bulk.done"),
					onClick: () => void toggleTask(task, myId),
				},
			];
	/** Akce stran — tah je provede při puštění; reverzní stav mění popisek. */
	const rightActs = [
		{
			key: "toggle",
			label: doneTask ? t("swipe.revert") : `✓ ${t("bulk.done")}`,
			color: doneTask ? "var(--w-avatar)" : "var(--w-success)",
			run: () => void toggleTask(task, myId),
		},
	];
	const leftActs = doneTask
		? []
		: [
				{
					key: "tomorrow",
					label: t("bulk.tomorrow"),
					color: "var(--w-brass)",
					run: () => reschedule("tomorrow"),
				},
				{
					key: "nextMonday",
					label: t("qsched.nextWeekShort"),
					color: "var(--w-avatar)",
					run: () => reschedule("nextMonday"),
				},
			];
	const swipe = useSwipe({
		disabled: !selectable,
		onUpdate: (dx, mag) => setSw({ dx, mag }),
		onSwipe: (mag) => {
			if (mag === "r1" || mag === "r2") {
				rightActs[0]?.run();
				return;
			}
			// hotový úkol doleva nepřeplánováváme (akce nedávají smysl)
			if (doneTask) return;
			(mag === "l2" ? leftActs[1] : leftActs[0])?.run();
		},
	});
	const armed = sw.mag === "r1" || sw.mag === "r2" || sw.mag === "l1" || sw.mag === "l2";
	// vizuál během tahu: rostoucí barevná pilulka od kraje (jako mail)
	const dragAct = sw.dx > 0 ? rightActs[0] : sw.mag === "l2" ? leftActs[1] : leftActs[0];

	return (
		<li
			{...swipe.handlers}
			onContextMenu={(e) => cm.open(e, ctxItems)}
			style={{
				position: "relative",
				touchAction: "pan-y",
				overflow: sw.dx !== 0 ? "hidden" : undefined,
			}}
		>
			{/* podklad swipe (TaskCard má marginBottom 5): rostoucí barevná
			    pilulka od kraje (jako mail) — akce se provede puštěním.
			    Bez akce (hotový úkol tažený doleva) podklad nekreslíme — jinak by
			    naskočila prázdná šedá pilulka, která nic nedělá. */}
			{sw.dx !== 0 && dragAct && (
				<div
					aria-hidden
					className="font-display"
					style={{
						position: "absolute",
						inset: "0 0 5px 0",
						borderRadius: 10,
						overflow: "hidden",
						display: "flex",
						alignItems: "stretch",
						justifyContent: sw.dx > 0 ? "flex-start" : "flex-end",
						background: "var(--w-panel-2)",
					}}
				>
					{dragAct && (
						<span
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: sw.dx > 0 ? "flex-end" : "flex-start",
								width: Math.max(0, Math.abs(sw.dx) - 14),
								padding: "0 12px",
								boxSizing: "border-box",
								whiteSpace: "nowrap",
								overflow: "hidden",
								fontSize: 11,
								fontWeight: 600,
								color: "#fff",
								background: dragAct.color,
								filter: armed ? undefined : "saturate(.7) opacity(.85)",
								transition: "background .1s ease, filter .1s ease",
							}}
						>
							{dragAct.label}
						</span>
					)}
				</div>
			)}
			<div
				style={{
					transform: `translateX(${sw.dx}px)`,
					transition: sw.dx === 0 ? "transform .18s ease" : "none",
				}}
			>
				<TaskCard
					name={task.name ?? ""}
					priority={(task.priority ?? 4) as Pri}
					projectName={project?.name ?? undefined}
					projectColor={project?.color ?? undefined}
					wsColor={resolvedWsColor}
					parentName={meta.parentName}
					color={meta.color ?? task.color ?? undefined}
					due={rowDue(task, t)}
					deadline={deadlineLabel(task.deadline)}
					status={meta.status}
					flow={
						flow
							? {
									name: flow.name,
									pos: flow.pos,
									total: flow.total,
									state: flow.state,
									onClick: () =>
										void navigate({
											to: "/postupy",
											search: { postup: flow.chainId },
										}),
								}
							: undefined
					}
					handedOff={handedOff}
					handedOffLabel={t("today.handedOff")}
					meeting={task.kind === "meeting"}
					meetingLabel={t("today.meetingChip")}
					fromMeeting={
						task.meeting_id && task.kind !== "meeting"
							? {
									label: t("today.fromMeetingChip"),
									onClick: () => void navigate({ to: "/meets", search: { meet: task.meeting_id ?? undefined } }),
								}
							: undefined
					}
					doneLabel={t("detail.ariaMarkUndone")}
					undoneLabel={t("detail.ariaComplete")}
					checklist={meta.checklist}
					recurring={Boolean(task.recurrence)}
					reminder={meta.reminder}
					comments={meta.comments}
					assignAll={
						meta.assignAll ? { ...meta.assignAll, label: t("today.assignAllPill") } : undefined
					}
					avatars={meta.avatars}
					dormant={flow?.state === "dormant" || flow?.state === "waiting"}
					done={Boolean(task.completed_at)}
					sel={
						selectable
							? {
									on: bulk.isSelected(task.id),
									onToggle: (shiftKey) =>
										bulk.toggle(
											task.id,
											shiftKey,
											navIds.filter((id) => !id.includes("@")),
										),
									title: t("bulk.selTitle"),
								}
							: undefined
					}
					sched={
						selectable
							? {
									items: [
										{ key: "today", label: t("bulk.today") },
										{ key: "tomorrow", label: t("bulk.tomorrow") },
										{ key: "nextMonday", label: t("qsched.nextWeekShort") },
									],
									onShift: (key) => {
										// R4 — stejná pojistka jako swipe/BulkBar: neposouvat kotvu opakované řady
										if (isRecurring) {
											showToast(t("qsched.recurringBlocked"));
											return;
										}
										const iso = rescheduleDate(key as RescheduleKey);
										pushColumnUndo("tasks", task.id, "due_date", task.due_date, iso);
										void powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
											iso,
											task.id,
										]);
									},
								}
							: undefined
					}
					quickMenu={{
						label: t("ctx.quickActions"),
						onOpen: (event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							cm.open(
								{
									clientX: rect.right,
									clientY: rect.bottom,
									preventDefault: () => event.preventDefault(),
								},
								ctxItems,
							);
						},
					}}
					onToggle={() => void toggleTask(task, myId)}
					onOpen={() => {
						// klik těsně po dokončeném tahu neotvírat detail
						if (swipe.swipedRecently()) return;
						open(task.id);
					}}
				/>
			</div>
		</li>
	);
}
