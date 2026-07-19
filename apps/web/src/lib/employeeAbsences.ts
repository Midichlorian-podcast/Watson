import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./api";

export type EmployeeAbsenceKind =
	| "vacation"
	| "sickness"
	| "doctor"
	| "family_care"
	| "other";
export type EmployeeAbsenceStatus =
	| "submitted"
	| "in_review"
	| "needs_employee"
	| "resolved"
	| "rejected"
	| "cancelled";

export type EmployeeAbsenceCase = {
	id: string;
	kind: EmployeeAbsenceKind;
	startDate: string;
	endDate: string;
	timezone: string;
	visibility: "team" | "private";
	status: EmployeeAbsenceStatus;
	resolutionPublic: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export class EmployeeAbsenceError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
		this.name = "EmployeeAbsenceError";
	}
}

async function responseError(response: Response) {
	const body = (await response.json().catch(() => ({}))) as { error?: string };
	return new EmployeeAbsenceError(body.error ?? `HTTP ${response.status}`, response.status);
}

async function absenceJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		credentials: "include",
		cache: "no-store",
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
	if (!response.ok) throw await responseError(response);
	return (await response.json()) as T;
}

export function useEmployeeAbsences(enabled = true) {
	return useQuery({
		queryKey: ["employee", "self-service", "absences"],
		queryFn: () =>
			absenceJson<{ cases: EmployeeAbsenceCase[]; fetchedAt: string }>(
				"/api/employee/self-service/absences",
			),
		enabled,
		staleTime: 15_000,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
		networkMode: "online",
		gcTime: 5 * 60_000,
	});
}

export async function requestEmployeeAbsence(input: {
	operationId: string;
	kind: EmployeeAbsenceKind;
	startDate: string;
	endDate: string;
	timezone: string;
	visibility: "team" | "private";
	note: string | null;
}) {
	return absenceJson<{ absence: EmployeeAbsenceCase; replayed: boolean }>(
		"/api/employee/self-service/absences",
		{ method: "POST", body: JSON.stringify(input) },
	);
}
