import { API_URL } from "./api";

export type RecurrenceSchedule = {
	date: string;
	time: string | null;
	timeZone: string | null;
	durationMin: number | null;
};

export type RecurrencePreviewInput = {
	occurrenceDate: string;
	scope: "this_occurrence" | "this_and_future" | "all";
	schedule: RecurrenceSchedule;
	dstPolicy: "reject" | "next_valid";
};

export type RecurrencePreview = {
	previewHash: string;
	canExecute: boolean;
	task: { id: string; name: string };
	current: RecurrenceSchedule & { startsAt: string | null };
	proposed: RecurrenceSchedule & { startsAt: string | null; dstAdjusted: boolean };
	seriesImpact: {
		affectedFrom: string;
		preservedPrefixOccurrences: number;
		nextSeriesAnchor: string | null;
	} | null;
	conflicts: Array<{ code: string; detail?: unknown }>;
	warnings: string[];
	availability: {
		conflicts: Array<{
			blockId: string;
			assigneeId: string;
			assigneeName: string;
			kind: "focus" | "unavailable" | "absence" | "holiday";
			label: string | null;
			blocking: boolean;
		}>;
	};
};

export class RecurrenceApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

async function command<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok) {
		throw new RecurrenceApiError(String(payload.error ?? "recurrence_command_failed"), response.status);
	}
	return payload as T;
}

export const previewRecurrenceMove = (taskId: string, input: RecurrencePreviewInput) =>
	command<RecurrencePreview>(`/api/tasks/${taskId}/recurrence/preview`, input);

export const executeRecurrenceMove = (
	taskId: string,
	input: RecurrencePreviewInput,
	previewHash: string,
	operationId = crypto.randomUUID(),
) =>
	command<{ batchId: string; undoExpiresAt: string; replayed: boolean }>(
		`/api/tasks/${taskId}/recurrence/execute`,
		{ ...input, previewHash, operationId },
	);

export const undoRecurrenceMove = (taskId: string, batchId: string) =>
	command<{ ok: true; replayed: boolean }>(`/api/tasks/${taskId}/recurrence/undo`, { batchId });
