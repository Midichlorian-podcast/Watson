import { API_URL } from "./api";

export const POLL_RESPONSE_TYPES = [
	"single_choice",
	"multiple_choice",
	"text",
	"number",
	"date",
] as const;
export type PollResponseType = (typeof POLL_RESPONSE_TYPES)[number];
export type PollOption = { id: string; label: string };

export class PollApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

async function request(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...init.headers },
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
		throw new PollApiError(
			typeof body?.error === "string" ? body.error : "poll_request_failed",
			response.status,
		);
	}
	return response.json();
}

export async function createPoll(input: {
	id: string;
	taskId: string;
	question: string;
	responseType: PollResponseType;
	options?: string[];
}): Promise<void> {
	await request(`/api/tasks/${input.taskId}/polls`, {
		method: "POST",
		body: JSON.stringify({
			id: input.id,
			question: input.question,
			responseType: input.responseType,
			...(input.options ? { options: input.options } : {}),
		}),
	});
}

export async function updatePoll(
	pollId: string,
	patch: { question?: string; responseType?: PollResponseType; options?: string[] },
): Promise<void> {
	await request(`/api/polls/${pollId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function setPollClosed(pollId: string, closed: boolean): Promise<void> {
	await request(`/api/polls/${pollId}/${closed ? "close" : "reopen"}`, { method: "POST" });
}

export async function savePollResponse(pollId: string, value: unknown): Promise<void> {
	await request(`/api/polls/${pollId}/response`, {
		method: "PUT",
		body: JSON.stringify({ value }),
	});
}

export async function clearPollResponse(pollId: string): Promise<void> {
	await request(`/api/polls/${pollId}/response`, { method: "DELETE" });
}

export async function deletePoll(pollId: string, question: string): Promise<void> {
	await request(`/api/polls/${pollId}?confirm=${encodeURIComponent(question)}`, {
		method: "DELETE",
	});
}

export function parsePollOptions(value: unknown): PollOption[] {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(option): option is PollOption =>
			typeof option === "object" &&
			option !== null &&
			typeof (option as PollOption).id === "string" &&
			typeof (option as PollOption).label === "string",
	);
}

export function parsePollValue(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
