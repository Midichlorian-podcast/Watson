import { API_URL } from "./api";
import { readPrivateJson, removePrivateJson, writePrivateJson } from "./powersync/privateState";

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_SELECTION = 10;
const PENDING_KEY = "pending_attachment_finalizations:v1";
let pendingSerial: Promise<void> = Promise.resolve();

export type StagedAttachment = {
	stageId: string;
	expiresAt: string;
	fileName: string;
	mime: string;
	sizeBytes: number;
	sha256: string;
};

type PendingFinalization = {
	stageId: string;
	taskId: string;
	createdAt: string;
};

export class AttachmentApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

async function apiError(response: Response): Promise<AttachmentApiError> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return new AttachmentApiError(
		typeof body?.error === "string" ? body.error : "attachment_request_failed",
		response.status,
	);
}

export async function stageAttachment(
	taskId: string,
	projectId: string,
	file: File,
): Promise<StagedAttachment> {
	if (file.size <= 0) throw new AttachmentApiError("attachment_empty", 422);
	if (file.size > ATTACHMENT_MAX_BYTES)
		throw new AttachmentApiError("attachment_too_large", 413);
	const form = new FormData();
	form.set("taskId", taskId);
	form.set("projectId", projectId);
	form.set("file", file, file.name);
	const response = await fetch(`${API_URL}/api/attachments/stage`, {
		method: "POST",
		credentials: "include",
		body: form,
	});
	if (!response.ok) throw await apiError(response);
	return (await response.json()) as StagedAttachment;
}

export async function finalizeAttachment(stageId: string): Promise<string> {
	const response = await fetch(`${API_URL}/api/attachment-stages/${stageId}/finalize`, {
		method: "POST",
		credentials: "include",
	});
	if (!response.ok) throw await apiError(response);
	const body = (await response.json()) as { attachmentId: string };
	return body.attachmentId;
}

export async function cancelAttachmentStage(stageId: string): Promise<void> {
	const response = await fetch(`${API_URL}/api/attachment-stages/${stageId}`, {
		method: "DELETE",
		credentials: "include",
	});
	if (!response.ok && response.status !== 404) throw await apiError(response);
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
	const response = await fetch(`${API_URL}/api/attachments/${attachmentId}`, {
		method: "DELETE",
		credentials: "include",
	});
	if (!response.ok) throw await apiError(response);
}

export function attachmentContentUrl(path: string, download = false): string {
	const url = new URL(path, API_URL);
	if (download) url.searchParams.set("download", "1");
	return url.toString();
}

export function attachmentSizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function isAttachmentPreviewable(mime: string): boolean {
	return (
		["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mime) ||
		mime === "text/plain" ||
		mime === "text/csv" ||
		mime === "text/markdown"
	);
}

async function pending(): Promise<PendingFinalization[]> {
	const value = await readPrivateJson<unknown>(PENDING_KEY, []);
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is PendingFinalization =>
			typeof row === "object" &&
			row !== null &&
			typeof (row as PendingFinalization).stageId === "string" &&
			typeof (row as PendingFinalization).taskId === "string" &&
			typeof (row as PendingFinalization).createdAt === "string",
	);
}

function serializePending<T>(operation: () => Promise<T>): Promise<T> {
	const next = pendingSerial.then(operation, operation);
	pendingSerial = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

export async function rememberAttachmentFinalization(stageId: string, taskId: string): Promise<void> {
	await serializePending(async () => {
		const rows = await pending();
		if (rows.some((row) => row.stageId === stageId)) return;
		await writePrivateJson(PENDING_KEY, [
			...rows,
			{ stageId, taskId, createdAt: new Date().toISOString() },
		]);
	});
}

async function keepPending(rows: PendingFinalization[]): Promise<void> {
	if (rows.length === 0) await removePrivateJson(PENDING_KEY);
	else await writePrivateJson(PENDING_KEY, rows);
}

/**
 * Dokončí staging po dosyncování offline-first tasku. Přechodná 409 zůstává ve
 * frontě; neplatný, expirovaný nebo již zrušený staging se bezpečně zahodí.
 */
export async function retryPendingAttachmentFinalizations(): Promise<number> {
	if (!navigator.onLine) return 0;
	return serializePending(async () => {
		const rows = await pending();
		if (rows.length === 0) return 0;
		const remaining: PendingFinalization[] = [];
		let finalized = 0;
		for (const row of rows) {
			try {
				await finalizeAttachment(row.stageId);
				finalized += 1;
			} catch (error) {
				if (
					error instanceof AttachmentApiError &&
					(error.code === "attachment_task_not_synced" ||
						error.status === 408 ||
						error.status === 429 ||
						error.status >= 500)
				) {
					remaining.push(row);
				} else if (!(error instanceof AttachmentApiError)) {
					remaining.push(row);
				}
			}
		}
		await keepPending(remaining);
		return finalized;
	});
}
