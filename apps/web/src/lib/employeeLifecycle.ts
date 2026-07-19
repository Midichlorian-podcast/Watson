import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./api";

export type EmployeeLifecycleType = "onboarding" | "offboarding";
export type EmployeeLifecycleStatus =
	| "invited"
	| "in_progress"
	| "submitted"
	| "needs_changes"
	| "completed"
	| "cancelled";
export type EmployeeLifecycleResponseType =
	| "confirmation"
	| "text"
	| "form"
	| "file"
	| "consent"
	| "decline"
	| "question";

export type EmployeeLifecycleItem = {
	key: string;
	label: string;
	description: string | null;
	suggestedResponseType: EmployeeLifecycleResponseType;
	completed: boolean;
};

export type EmployeeLifecycleInstance = {
	id: string;
	type: EmployeeLifecycleType;
	status: EmployeeLifecycleStatus;
	title: string;
	items: EmployeeLifecycleItem[];
	completedCount: number;
	totalCount: number;
	dueAt: string | null;
	submittedAt: string | null;
	completedAt: string | null;
	cancelledAt: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

type LifecycleResponse = { instances: EmployeeLifecycleInstance[]; fetchedAt: string };

export class EmployeeLifecycleError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

async function errorFrom(response: Response) {
	const body = (await response.json().catch(() => ({}))) as { error?: unknown };
	return new EmployeeLifecycleError(
		typeof body.error === "string" ? body.error : "employee_lifecycle_request_failed",
		response.status,
	);
}

async function readLifecycle(): Promise<LifecycleResponse> {
	const response = await fetch(`${API_URL}/api/employee/self-service/lifecycle`, {
		credentials: "include",
		cache: "no-store",
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json() as Promise<LifecycleResponse>;
}

export function useEmployeeLifecycle(enabled: boolean) {
	return useQuery({
		queryKey: ["employee", "self-service", "lifecycle"],
		queryFn: readLifecycle,
		enabled,
		staleTime: 30_000,
		gcTime: 60_000,
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
	});
}

export async function respondToEmployeeLifecycle(input: {
	operationId: string;
	lifecycleType: EmployeeLifecycleType;
	lifecycleId: string;
	expectedVersion: number;
	itemKey: string;
	responseType: Exclude<EmployeeLifecycleResponseType, "file">;
	value: string | null;
	confirmed: boolean;
}) {
	const response = await fetch(`${API_URL}/api/employee/self-service/lifecycle/respond`, {
		method: "POST",
		credentials: "include",
		cache: "no-store",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json() as Promise<{ instance: EmployeeLifecycleInstance; replayed: boolean }>;
}

export async function respondToEmployeeLifecycleWithFile(input: {
	operationId: string;
	lifecycleType: EmployeeLifecycleType;
	lifecycleId: string;
	expectedVersion: number;
	itemKey: string;
	file: File;
}) {
	const form = new FormData();
	form.set("operationId", input.operationId);
	form.set("lifecycleType", input.lifecycleType);
	form.set("lifecycleId", input.lifecycleId);
	form.set("expectedVersion", String(input.expectedVersion));
	form.set("itemKey", input.itemKey);
	form.set("file", input.file, input.file.name);
	const response = await fetch(`${API_URL}/api/employee/self-service/lifecycle/respond-file`, {
		method: "POST",
		credentials: "include",
		cache: "no-store",
		body: form,
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json() as Promise<{ instance: EmployeeLifecycleInstance; replayed: boolean }>;
}
