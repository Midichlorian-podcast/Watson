import { API_URL } from "./api";

export type TaskAvailabilityConflict = {
	blockId: string;
	assigneeId: string;
	assigneeName: string;
	kind: "focus" | "unavailable" | "absence" | "holiday";
	startsAt: string;
	endsAt: string;
	label: string | null;
	blocking: boolean;
	overridden: boolean;
};

export type TaskAvailabilityResult = {
	policy: "warning" | "strict";
	startsAt: string | null;
	endsAt: string | null;
	conflicts: TaskAvailabilityConflict[];
	canSchedule: boolean;
};

async function responseError(response: Response) {
	const body = (await response.json().catch(() => ({}))) as { error?: string };
	return new Error(body.error ?? `HTTP ${response.status}`);
}

export async function preflightTaskAvailability(
	taskId: string,
	input: { startsAt: string | null; durationMin: number | null },
): Promise<TaskAvailabilityResult> {
	const response = await fetch(`${API_URL}/api/tasks/${taskId}/availability/preflight`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await responseError(response);
	return (await response.json()) as TaskAvailabilityResult;
}

export async function createTaskAvailabilityOverride(
	taskId: string,
	input: {
		id: string;
		blockId: string;
		assigneeId: string;
		reason: string;
		startsAt: string;
		durationMin: number | null;
	},
) {
	const response = await fetch(`${API_URL}/api/tasks/${taskId}/availability-overrides`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await responseError(response);
	return response.json();
}

export async function createTaskAvailabilityOverrides(
	taskId: string,
	input: {
		overrides: Array<{ id: string; blockId: string; assigneeId: string }>;
		reason: string;
		startsAt: string;
		durationMin: number | null;
	},
) {
	const response = await fetch(`${API_URL}/api/tasks/${taskId}/availability-overrides/batch`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await responseError(response);
	return response.json();
}
