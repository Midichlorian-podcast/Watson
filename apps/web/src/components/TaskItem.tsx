import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { TaskCard } from "@watson/ui";
import type { FlowStepInfo } from "../lib/flowSteps";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useTaskDetail } from "../lib/taskDetail";
import { dueLabel, toggleTask } from "../lib/tasks";

type Pri = 1 | 2 | 3 | 4;
export type TaskProject = { name: string | null; color: string | null };

/** Sdílená položka seznamu úkolů (TaskCard z řádku PowerSync). Klik → detail panel. */
export function TaskItem({
  task,
  project,
  flow,
}: {
  task: TaskRow;
  project?: TaskProject;
  /** Krok postupu (⛓ chip, klik → postup). */
  flow?: FlowStepInfo;
}) {
  const { t } = useTranslation();
  const { open } = useTaskDetail();
  const navigate = useNavigate();
  return (
    <li>
      <TaskCard
        name={task.name ?? ""}
        priority={(task.priority ?? 4) as Pri}
        projectName={project?.name ?? undefined}
        projectColor={project?.color ?? undefined}
        due={task.due_date ? dueLabel(task.due_date, t) : undefined}
        flow={
          flow
            ? {
                label: `${flow.pos}/${flow.total}`,
                onClick: () => void navigate({ to: "/postupy", search: { postup: flow.chainId } }),
              }
            : undefined
        }
        done={Boolean(task.completed_at)}
        onToggle={() => void toggleTask(task)}
        onOpen={() => open(task.id)}
      />
    </li>
  );
}
