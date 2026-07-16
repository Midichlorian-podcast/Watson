import { DEFAULT_TIMEZONE, type ProjectMilestoneCondition } from "@watson/shared";

export type ProjectMilestoneSnapshot = {
	id: string;
	title: string;
	condition_type: ProjectMilestoneCondition;
	task_id: string | null;
	target_count: number | null;
	due_date: string | null;
};

export type MilestoneTaskSnapshot = {
	id: string;
	name: string;
	kind: string | null;
	completed_at: string | null;
};

export type ProjectMilestoneProgress = {
	state: "met" | "pending" | "missed";
	current: number;
	target: number;
};

const projectDayFormatter = new Intl.DateTimeFormat("en-US", {
	timeZone: DEFAULT_TIMEZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

/** Kalendářní den ve stejné IANA zóně, kterou používá DB guard. */
export function projectCalendarDay(value: string | Date): string {
	const parts = projectDayFormatter.formatToParts(value instanceof Date ? value : new Date(value));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((candidate) => candidate.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

const completionDay = (value: string | null) => (value ? projectCalendarDay(value) : null);

/** Čistý read model shodný s DB guardem; `today` se předává kvůli deterministickým testům. */
export function evaluateProjectMilestone(
	milestone: ProjectMilestoneSnapshot,
	tasks: MilestoneTaskSnapshot[],
	today: string,
): ProjectMilestoneProgress {
	const beforeDeadline = (task: MilestoneTaskSnapshot) => {
		const day = completionDay(task.completed_at);
		return day !== null && (milestone.due_date === null || day <= milestone.due_date);
	};
	let current = 0;
	let target = 1;
	if (milestone.condition_type === "task_completed") {
		const task = tasks.find((candidate) => candidate.id === milestone.task_id);
		current = task && beforeDeadline(task) ? 1 : 0;
	} else {
		const projectTasks = tasks.filter((task) => task.kind !== "meeting");
		current = projectTasks.filter(beforeDeadline).length;
		target =
			milestone.condition_type === "completed_count"
				? (milestone.target_count ?? 1)
				: Math.max(1, projectTasks.length);
		if (milestone.condition_type === "all_tasks_completed" && projectTasks.length === 0)
			current = 0;
	}
	if (current >= target) return { state: "met", current, target };
	return {
		state: milestone.due_date !== null && today > milestone.due_date ? "missed" : "pending",
		current,
		target,
	};
}
