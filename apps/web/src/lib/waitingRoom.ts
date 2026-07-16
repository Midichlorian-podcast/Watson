export type WaitingRoomSide = "on_me" | "for_others";
export type WaitingRoomSource = "dependency" | "flow";

export type WaitingRoomTask = {
	id: string;
	name: string | null;
	project_id: string | null;
	priority: number | null;
	due_date: string | null;
	completed_at: string | null;
};

export type WaitingRoomAssignment = {
	task_id: string | null;
	user_id: string | null;
};

export type WaitingRoomDependency = {
	id: string;
	blocking_task_id: string | null;
	blocked_task_id: string | null;
};

export type WaitingRoomChainStep = {
	id: string;
	chain_id: string | null;
	task_id: string | null;
	position: number | null;
	step_state: string | null;
};

export type WaitingRoomEntry = {
	key: string;
	side: WaitingRoomSide;
	source: WaitingRoomSource;
	taskId: string;
	taskName: string;
	projectId: string | null;
	priority: number;
	dueDate: string | null;
	ownerIds: string[];
	relatedTaskId: string;
	relatedTaskName: string;
	relatedOwnerIds: string[];
};

function compareEntries(left: WaitingRoomEntry, right: WaitingRoomEntry): number {
	return (
		(left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999") ||
		left.priority - right.priority ||
		left.taskName.localeCompare(right.taskName) ||
		left.key.localeCompare(right.key)
	);
}

/**
 * Waiting Room je čistá projekce, ne nový stav úkolu. Zdroj pravdy zůstávají
 * task_dependencies a právě aktivní krok Postupu; tím nevznikne druhá, časem
 * rozbitá kopie informace „kdo na koho čeká“.
 */
export function buildWaitingRoom(input: {
	currentUserId: string;
	tasks: WaitingRoomTask[];
	assignments: WaitingRoomAssignment[];
	dependencies: WaitingRoomDependency[];
	chainSteps: WaitingRoomChainStep[];
}): { onMe: WaitingRoomEntry[]; forOthers: WaitingRoomEntry[] } {
	const tasks = new Map(input.tasks.map((task) => [task.id, task]));
	const owners = new Map<string, Set<string>>();
	for (const assignment of input.assignments) {
		if (!assignment.task_id || !assignment.user_id) continue;
		const taskOwners = owners.get(assignment.task_id) ?? new Set<string>();
		taskOwners.add(assignment.user_id);
		owners.set(assignment.task_id, taskOwners);
	}
	const ownerIds = (taskId: string) => [...(owners.get(taskId) ?? [])].sort();
	const isOpen = (task: WaitingRoomTask | undefined): task is WaitingRoomTask =>
		Boolean(task && !task.completed_at);
	const rows = new Map<string, WaitingRoomEntry>();

	const add = (
		side: WaitingRoomSide,
		source: WaitingRoomSource,
		work: WaitingRoomTask,
		related: WaitingRoomTask,
		stableId: string,
	) => {
		const key = `${side}:${source}:${work.id}:${related.id}:${stableId}`;
		rows.set(key, {
			key,
			side,
			source,
			taskId: work.id,
			taskName: work.name?.trim() || "—",
			projectId: work.project_id,
			priority: work.priority ?? 4,
			dueDate: work.due_date,
			ownerIds: ownerIds(work.id),
			relatedTaskId: related.id,
			relatedTaskName: related.name?.trim() || "—",
			relatedOwnerIds: ownerIds(related.id),
		});
	};

	for (const dependency of input.dependencies) {
		if (!dependency.blocking_task_id || !dependency.blocked_task_id) continue;
		const blocking = tasks.get(dependency.blocking_task_id);
		const blocked = tasks.get(dependency.blocked_task_id);
		if (!isOpen(blocking) || !isOpen(blocked)) continue;
		const blockingOwners = owners.get(blocking.id) ?? new Set<string>();
		const blockedOwners = owners.get(blocked.id) ?? new Set<string>();
		if (blockingOwners.has(input.currentUserId)) {
			add("on_me", "dependency", blocking, blocked, dependency.id);
		}
		if (blockedOwners.has(input.currentUserId) && !blockingOwners.has(input.currentUserId)) {
			add("for_others", "dependency", blocking, blocked, dependency.id);
		}
	}

	const byChain = new Map<string, WaitingRoomChainStep[]>();
	for (const step of input.chainSteps) {
		if (!step.chain_id || !step.task_id) continue;
		const chain = byChain.get(step.chain_id) ?? [];
		chain.push(step);
		byChain.set(step.chain_id, chain);
	}
	for (const [chainId, unsorted] of byChain) {
		const steps = [...unsorted].sort(
			(left, right) =>
				(left.position ?? 0) - (right.position ?? 0) || left.id.localeCompare(right.id),
		);
		for (let activeIndex = 0; activeIndex < steps.length; activeIndex += 1) {
			const active = steps[activeIndex];
			if (active?.step_state !== "active" || !active.task_id) continue;
			const activeTask = tasks.get(active.task_id);
			if (!isOpen(activeTask)) continue;
			const activeOwners = owners.get(activeTask.id) ?? new Set<string>();
			for (let nextIndex = activeIndex + 1; nextIndex < steps.length; nextIndex += 1) {
				const next = steps[nextIndex];
				if (
					!next?.task_id ||
					next.step_state === "done" ||
					next.step_state === "skipped" ||
					next.step_state === "active"
				)
					continue;
				const nextTask = tasks.get(next.task_id);
				if (!isOpen(nextTask)) continue;
				const nextOwners = owners.get(nextTask.id) ?? new Set<string>();
				if (activeOwners.has(input.currentUserId)) {
					add("on_me", "flow", activeTask, nextTask, chainId);
				}
				if (nextOwners.has(input.currentUserId) && !activeOwners.has(input.currentUserId)) {
					add("for_others", "flow", activeTask, nextTask, chainId);
				}
				// Pozdější dormant kroky ještě na aktuálním kroku přímo nečekají.
				break;
			}
		}
	}

	const all = [...rows.values()];
	return {
		onMe: all.filter((entry) => entry.side === "on_me").sort(compareEntries),
		forOthers: all.filter((entry) => entry.side === "for_others").sort(compareEntries),
	};
}
