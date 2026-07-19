import { API_URL } from "./api";

export type BulkAction =
	| { kind: "priority"; priority: number }
	| { kind: "reschedule"; dueDate: string }
	| { kind: "complete" }
	| { kind: "assign"; userId: string }
	| { kind: "move"; projectId: string }
	| { kind: "delete" };

export type BulkSkipReason =
	| "already_applied"
	| "already_complete"
	| "recurring_requires_scope"
	| "shared_all_requires_individual"
	| "workflow_step_requires_individual"
	| "blocked_by_dependency";

export type BulkPreview = {
	previewHash: string;
	selectedCount: number;
	treeCount: number;
	applyCount: number;
	skippedCount: number;
	canExecute: boolean;
	items: { id: string; name: string }[];
	skipped: { id: string; name: string; reason: BulkSkipReason }[];
	conflicts: { code: string; taskIds: string[] }[];
	warnings: string[];
};

async function post<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
	return data;
}

export const previewBulkCommand = (taskIds: string[], action: BulkAction) =>
	post<BulkPreview>("/api/tasks/bulk/preview", { taskIds, action });

export const executeBulkCommand = (
	taskIds: string[],
	action: Exclude<BulkAction, { kind: "delete" }>,
	previewHash: string,
) =>
	post<{ batchId: string; replay: boolean }>("/api/tasks/bulk/execute", {
		taskIds,
		action,
		previewHash,
		operationId: crypto.randomUUID(),
	});

export const undoBulkCommand = (batchId: string) =>
	post<{ replay: boolean }>("/api/tasks/bulk/undo", { batchId });
