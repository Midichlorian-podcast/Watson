import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./api";

export type EmployeeBlocker = {
  type: string;
  explanation: string;
  href: string | null;
};

export type EmployeeNotification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  href: string | null;
  due: string | null;
  isRead: boolean;
};

export type EmployeeHubStatus = {
  person: { id: string | null; fullName: string | null; personType: string | null };
  readiness: {
    status: "ready" | "pending" | "blocked";
    blockers: EmployeeBlocker[];
    missingDocuments: string[];
    hasSubmittedAttendance: boolean;
    parentContributionCompleted: boolean;
  };
  deadlines: {
    attendanceDueDay: number | null;
    payrollDay: number | null;
    withholdingTaxDay: number | null;
    countdowns: Array<{
      key: string;
      label: string;
      due: string | null;
      daysRemaining: number | null;
      severity: "info" | "warning" | "urgent" | "overdue";
    }>;
  };
  dppProgress: {
    hoursUsed: number | null;
    hoursLimit: number | null;
    monthlyHours: number | null;
    monthlyLimit: number | null;
  };
  submissions: Record<
    string,
    Array<{
      id: string | null;
      status: string;
      reviewerNote: string | null;
      periodMonth: number | null;
      periodYear: number | null;
      updatedAt: string | null;
    }>
  >;
  notifications: EmployeeNotification[];
};

export type EmployeeHubResponse =
  | { linked: true; status: EmployeeHubStatus; fetchedAt: string }
  | {
      linked: false;
      reason?:
        | "luckyos_not_configured"
        | "luckyos_revoked"
        | "luckyos_identity_not_linked"
        | "luckyos_contract_rejected"
        | "luckyos_unavailable"
        | "no_email";
    };

async function readEmployeeHub(): Promise<EmployeeHubResponse> {
  const response = await fetch(`${API_URL}/api/employee/status`, {
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as EmployeeHubResponse & {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "employee_hub_unavailable");
  return body;
}

export function useEmployeeHub() {
  return useQuery({
    queryKey: ["employee-hub"],
    queryFn: readEmployeeHub,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export async function syncEmployeeTasks() {
  const response = await fetch(`${API_URL}/api/employee/sync`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await response.json().catch(() => ({}))) as {
    linked?: boolean;
    created?: number;
    skipped?: number;
    projectId?: string | null;
    error?: string;
    reason?: string;
  };
  if (!response.ok || body.linked !== true) {
    throw new Error(body.error ?? body.reason ?? "employee_sync_unavailable");
  }
  return {
    created: body.created ?? 0,
    skipped: body.skipped ?? 0,
    projectId: body.projectId ?? null,
  };
}
