import { powerSync } from "./powersync/db";

export type DependencyPolicy = "warning" | "strict";

export type DependencyGateState = {
	policy: DependencyPolicy;
	blockers: { id: string; name: string }[];
};

export type CompletionDecision = "allow" | "warn" | "deny";

/** First warning requires an explicit second action within ten seconds. */
export function dependencyCompletionDecision(
	state: DependencyGateState,
	armedAt: number | undefined,
	now: number,
): CompletionDecision {
	if (state.blockers.length === 0) return "allow";
	if (state.policy === "strict") return "deny";
	return armedAt != null && now - armedAt <= 10_000 ? "allow" : "warn";
}

export async function unresolvedDependencyState(taskId: string): Promise<DependencyGateState> {
	const blockers = await powerSync.getAll<{
		id: string;
		name: string | null;
		policy: string | null;
	}>(
		`SELECT blocker.id, blocker.name, w.task_conflict_policy AS policy
		 FROM task_dependencies d
		 JOIN tasks blocker ON blocker.id = d.blocking_task_id
		 JOIN tasks blocked ON blocked.id = d.blocked_task_id
		 JOIN projects p ON p.id = blocked.project_id
		 LEFT JOIN workspaces w ON w.id = p.workspace_id
		 WHERE d.blocked_task_id = ? AND blocker.completed_at IS NULL
		 ORDER BY blocker.due_date, blocker.name`,
		[taskId],
	);
	return {
		policy: blockers[0]?.policy === "strict" ? "strict" : "warning",
		blockers: blockers.map((row) => ({ id: row.id, name: row.name ?? "—" })),
	};
}

/** Adding blocking→blocked is a cycle if blocked already reaches blocking. */
export async function wouldCreateDependencyCycle(
	blockingTaskId: string,
	blockedTaskId: string,
): Promise<boolean> {
	if (blockingTaskId === blockedTaskId) return true;
	const row = await powerSync.getOptional<{ cycle: number }>(
		`WITH RECURSIVE reachable(id) AS (
			SELECT blocked_task_id FROM task_dependencies WHERE blocking_task_id = ?
			UNION
			SELECT d.blocked_task_id
			FROM task_dependencies d JOIN reachable r ON d.blocking_task_id = r.id
		)
		SELECT 1 AS cycle FROM reachable WHERE id = ? LIMIT 1`,
		[blockedTaskId, blockingTaskId],
	);
	return Boolean(row?.cycle);
}

