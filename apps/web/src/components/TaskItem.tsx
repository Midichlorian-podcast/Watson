import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { TaskCard } from "@watson/ui";
import { type CSSProperties, useState } from "react";
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
import { pushColumnUndo } from "../lib/undo";
import { type SwipeMag, useSwipe } from "../lib/useSwipe";
import { useWorkspaces } from "../lib/workspace";

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

	// Swipe na řádku (vzor mail): doprava = Hotovo, doleva krátce = Zítra,
	// doleva dlouze = Př. týden. Dotyk i trackpad; virtuální výskyty vynechány.
	const [sw, setSw] = useState<{ dx: number; mag: SwipeMag }>({
		dx: 0,
		mag: "none",
	});
	const swipe = useSwipe({
		disabled: !selectable,
		onUpdate: (dx, mag) => setSw({ dx, mag }),
		onSwipe: (mag) => {
			if (mag === "r1" || mag === "r2") {
				void toggleTask(task, myId);
				return;
			}
			const iso = rescheduleDate(mag === "l2" ? "nextMonday" : "tomorrow");
			pushColumnUndo("tasks", task.id, "due_date", task.due_date, iso);
			void powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [iso, task.id]);
			showToast(
				t("bulk.movedToast", {
					count: 1,
					day: mag === "l2" ? t("qsched.nextWeekShort") : t("bulk.tomorrow"),
				}),
			);
		},
	});
	const armed = sw.mag === "r1" || sw.mag === "r2" || sw.mag === "l1" || sw.mag === "l2";
	const pillStyle: CSSProperties = {
		fontSize: 10.5,
		padding: "3px 10px",
		borderRadius: 999,
		fontWeight: 600,
		transition: "background .1s ease, color .1s ease",
		...(armed
			? sw.dx > 0
				? { background: "var(--w-success)", color: "#fff" }
				: { background: "var(--w-brass)", color: "#fff" }
			: { background: "var(--w-card)", color: "var(--w-ink-2)" }),
	};

	return (
		<li
			{...swipe.handlers}
			style={{
				position: "relative",
				touchAction: "pan-y",
				overflow: sw.dx !== 0 ? "hidden" : undefined,
			}}
		>
			{/* podklad swipe — viditelný jen během tahu (TaskCard má marginBottom 5) */}
			{sw.dx !== 0 && (
				<div
					aria-hidden
					className="font-display"
					style={{
						position: "absolute",
						inset: "0 0 5px 0",
						borderRadius: 10,
						display: "flex",
						alignItems: "center",
						padding: "0 14px",
						background: sw.dx > 0 ? "var(--w-success-soft)" : "var(--w-brass-soft)",
					}}
				>
					{sw.dx > 0 ? (
						<span style={pillStyle}>✓ {t("bulk.done")}</span>
					) : (
						<span style={{ ...pillStyle, marginLeft: "auto" }}>
							{sw.mag === "l2" ? t("qsched.nextWeekShort") : t("bulk.tomorrow")} →
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
