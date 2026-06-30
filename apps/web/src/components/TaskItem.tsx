import { useTranslation } from "@watson/i18n";
import { TaskCard } from "@watson/ui";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useTaskDetail } from "../lib/taskDetail";
import { dueLabel, toggleTask } from "../lib/tasks";

type Pri = 1 | 2 | 3 | 4;

/** Sdílená položka seznamu úkolů (TaskCard z řádku PowerSync). Klik → detail panel. */
export function TaskItem({ task }: { task: TaskRow }) {
  const { t } = useTranslation();
  const { open } = useTaskDetail();
  return (
    <li>
      <TaskCard
        name={task.name ?? ""}
        priority={(task.priority ?? 4) as Pri}
        color={task.color ?? undefined}
        due={task.due_date ? dueLabel(task.due_date, t) : undefined}
        done={Boolean(task.completed_at)}
        onToggle={() => void toggleTask(task)}
        onOpen={() => open(task.id)}
      />
    </li>
  );
}
