import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./api";

export type EmployeeProfile = {
  name: string | null;
  personType: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  bankAccountMasked: string | null;
  active: boolean;
  version: number;
};

export type EmployeeProfileResponse = {
  profile: EmployeeProfile;
  requests: Array<{
    id: string;
    version: number;
    status: string;
    fields: string[];
    reviewerNote: string | null;
    updatedAt: string | null;
  }>;
  fetchedAt: string;
};

export type EmployeeAttendance = {
  period: string;
  expectedVersion: number;
  status: string;
  reviewerNote: string | null;
  updatedAt: string | null;
  records: Array<{
    id: string;
    date: string | null;
    activityType: "training" | "small_numbers" | "other" | null;
    hours: number | null;
    note: string | null;
  }>;
};

export type EmployeeSmallNumbers = {
  period: string;
  choreographies: Array<{ id: string; name: string; status: string }>;
  entries: Array<{
    id: string;
    version: number;
    choreographyId: string | null;
    choreographyName: string | null;
    hoursMinutes: number | null;
    note: string | null;
    status: string;
    reviewerNote: string | null;
    updatedAt: string | null;
  }>;
};

export class EmployeeSelfServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function employeeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new EmployeeSelfServiceError(
      body.error ?? "employee_self_service_unavailable",
      response.status,
    );
  }
  return body;
}

export function useEmployeeProfile(enabled: boolean) {
  return useQuery({
    queryKey: ["employee-self-service", "profile"],
    queryFn: () => employeeRequest<EmployeeProfileResponse>("/api/employee/self-service/profile"),
    enabled,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useEmployeeAttendance(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ["employee-self-service", "attendance", period],
    queryFn: () =>
      employeeRequest<{ attendance: EmployeeAttendance; fetchedAt: string }>(
        `/api/employee/self-service/attendance?period=${encodeURIComponent(period)}`,
      ),
    enabled,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useEmployeeSmallNumbers(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ["employee-self-service", "small-numbers", period],
    queryFn: () =>
      employeeRequest<{ smallNumbers: EmployeeSmallNumbers; fetchedAt: string }>(
        `/api/employee/self-service/small-numbers?period=${encodeURIComponent(period)}`,
      ),
    enabled,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function requestEmployeeProfileChange(input: {
  operationId: string;
  patch: { email?: string; phone?: string; bankAccount?: string; address?: string };
}) {
  return employeeRequest<{ replayed: boolean }>("/api/employee/self-service/profile-change", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveEmployeeAttendance(input: {
  operationId: string;
  period: string;
  expectedVersion: number;
  action: "save_draft" | "submit";
  records: Array<{
    id: string;
    date: string;
    activityType: "training" | "small_numbers" | "other";
    hours: number;
    note: string;
  }>;
}) {
  return employeeRequest<{ replayed: boolean }>("/api/employee/self-service/attendance", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveEmployeeSmallNumber(input: {
  operationId: string;
  period: string;
  expectedVersion: number;
  choreographyId: string;
  hoursMinutes: number;
  note: string | null;
  status: "draft" | "submitted";
}) {
  return employeeRequest<{ replayed: boolean }>("/api/employee/self-service/small-numbers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
