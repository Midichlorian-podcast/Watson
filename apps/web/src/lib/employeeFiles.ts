import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./api";

export const EMPLOYEE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export class EmployeeFileError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

export type EmployeeDocument = {
	id: string;
	type: string;
	fileName: string;
	fileType: string | null;
	fileSizeBytes: number | null;
	note: string | null;
	reviewStatus: string;
	reviewNote: string | null;
	validFrom: string | null;
	validUntil: string | null;
	createdAt: string | null;
	updatedAt: string | null;
};

export type PublishedEmployeeDocument = {
	id: string;
	documentType: string;
	periodYear: number | null;
	periodMonth: number | null;
	title: string;
	version: number;
	fileName: string;
	mimeType: "application/pdf" | "application/octet-stream";
	sizeBytes: number;
	publishedAt: string;
	updatedAt: string;
};

export type EmployeeExpenseClaim = {
	id: string;
	title: string;
	amount: number | null;
	currency: string | null;
	amountCzk: number | null;
	exchangeRate: number | null;
	date: string | null;
	paymentSource: string | null;
	category: string | null;
	note: string | null;
	reimbursementSource: string | null;
	status: string;
	reviewerNote: string | null;
	reimbursedAt: string | null;
	receipt: {
		fileName: string | null;
		mimeType: string | null;
	};
	createdAt: string | null;
	updatedAt: string | null;
};

export type EmployeeContract = {
	id: string;
	version: number;
	type: string;
	title: string;
	validFrom: string | null;
	validUntil: string | null;
	status: string;
	workflowStatus: string;
	signedDate: string | null;
	fileName: string | null;
	lockedAt: string | null;
	canSign: boolean;
	updatedAt: string | null;
};

type DocumentsResponse = {
	documents: EmployeeDocument[];
	publishedDocuments: PublishedEmployeeDocument[];
	fetchedAt: string;
};

export type EmployeeTrainerProject = {
	id: string;
	name: string;
	status: string;
	reviewStatus: string;
};

type ExpensesResponse = {
	claims: EmployeeExpenseClaim[];
	trainerProjects: EmployeeTrainerProject[];
	fetchedAt: string;
};
type ContractsResponse = { contracts: EmployeeContract[]; fetchedAt: string };

async function errorFrom(response: Response) {
	const body = (await response.json().catch(() => ({}))) as { error?: unknown };
	return new EmployeeFileError(
		typeof body.error === "string" ? body.error : "employee_file_request_failed",
		response.status,
	);
}

async function read<T>(path: string): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		credentials: "include",
		cache: "no-store",
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json() as Promise<T>;
}

async function upload<T>(path: string, form: FormData): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		method: "POST",
		credentials: "include",
		body: form,
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json() as Promise<T>;
}

export function useEmployeeDocuments(enabled: boolean) {
	return useQuery({
		queryKey: ["employee-self-service", "documents"],
		queryFn: () => read<DocumentsResponse>("/api/employee/self-service/documents"),
		enabled,
		staleTime: 30_000,
		gcTime: 60_000,
		refetchOnWindowFocus: true,
	});
}

export function useEmployeeExpenses(enabled: boolean) {
	return useQuery({
		queryKey: ["employee-self-service", "expenses"],
		queryFn: () => read<ExpensesResponse>("/api/employee/self-service/expenses"),
		enabled,
		staleTime: 30_000,
		gcTime: 60_000,
		refetchOnWindowFocus: true,
	});
}

export function useEmployeeContracts(enabled: boolean) {
	return useQuery({
		queryKey: ["employee-self-service", "contracts"],
		queryFn: () => read<ContractsResponse>("/api/employee/self-service/contracts"),
		enabled,
		staleTime: 30_000,
		gcTime: 60_000,
		refetchOnWindowFocus: true,
	});
}

export async function uploadEmployeeDocument(input: {
	operationId: string;
	file: File;
	type: string;
	note: string | null;
	validFrom: string | null;
	validUntil: string | null;
}) {
	const form = new FormData();
	form.set("operationId", input.operationId);
	form.set("file", input.file, input.file.name);
	form.set("type", input.type);
	if (input.note) form.set("note", input.note);
	if (input.validFrom) form.set("validFrom", input.validFrom);
	if (input.validUntil) form.set("validUntil", input.validUntil);
	return upload<{ document: EmployeeDocument; replayed: boolean }>(
		"/api/employee/self-service/documents",
		form,
	);
}

export async function uploadEmployeeExpense(input: {
	operationId: string;
	file: File;
	title: string;
	amount: string;
	currency: string;
	exchangeRate: string | null;
	date: string;
	paymentSource: string;
	category: string;
	note: string | null;
	reimbursementSource: string;
	trainerProjectId: string | null;
}) {
	const form = new FormData();
	form.set("operationId", input.operationId);
	form.set("file", input.file, input.file.name);
	form.set("title", input.title);
	form.set("amount", input.amount);
	form.set("currency", input.currency);
	if (input.exchangeRate) form.set("exchangeRate", input.exchangeRate);
	form.set("date", input.date);
	form.set("paymentSource", input.paymentSource);
	form.set("category", input.category);
	if (input.note) form.set("note", input.note);
	form.set("reimbursementSource", input.reimbursementSource);
	if (input.trainerProjectId) form.set("trainerProjectId", input.trainerProjectId);
	return upload<{ claim: EmployeeExpenseClaim; replayed: boolean }>(
		"/api/employee/self-service/expenses",
		form,
	);
}

export async function signEmployeeContract(input: {
	operationId: string;
	contractId: string;
	expectedVersion: number;
	consent: true;
	fullName: string;
	birthDate: string;
	bankAccountSuffix: string | null;
	signatureDataUrl: string;
}) {
	const response = await fetch(`${API_URL}/api/employee/self-service/contracts/sign`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json() as Promise<{
		contract: EmployeeContract;
		replayed: boolean;
	}>;
}

export function publishedEmployeeDocumentUrl(id: string, download = false) {
	const url = new URL(
		`/api/employee/self-service/published-documents/${encodeURIComponent(id)}/content`,
		API_URL,
	);
	if (download) url.searchParams.set("download", "1");
	return url.toString();
}
