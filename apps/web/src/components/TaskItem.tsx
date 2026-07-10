import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { TaskCard } from "@watson/ui";
import { useSession } from "../lib/auth-client";
import { useBulkSelect } from "../lib/bulkSelect";
import type { FlowStepInfo } from "../lib/flowSteps";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useRowMeta } from "../lib/rowMeta";
import { useTaskDetail } from "../lib/taskDetail";
import { deadlineLabel, rowDue, toggleTask } from "../lib/tasks";
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
			? ((workspaces ?? []).find((w) => w.id === project.workspace_id)?.color ??
				undefined)
			: undefined);
	// „→ Přišlo na tebe" — aktivní krok štafety přiřazený mně (prototyp handedOff).
	const handedOff =
		flow?.state === "active" &&
		!!myId &&
		meta.assigneeIds.includes(myId) &&
		!task.completed_at;
	return (
		<li>
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
					meta.assignAll
						? { ...meta.assignAll, label: t("today.assignAllPill") }
						: undefined
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
				onToggle={() => void toggleTask(task, myId)}
				onOpen={() => open(task.id)}
			/>
		</li>
	);
}
