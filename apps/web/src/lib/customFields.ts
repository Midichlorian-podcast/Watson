import { API_URL } from "./api";
import { powerSync } from "./powersync/db";

export const CUSTOM_FIELD_TYPES = [
	"text",
	"number",
	"select",
	"date",
	"checkbox",
	"url",
	"person",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomFieldOption = { id: string; label: string };

export class CustomFieldApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

async function errorFrom(response: Response): Promise<CustomFieldApiError> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return new CustomFieldApiError(
		typeof body?.error === "string" ? body.error : "custom_field_request_failed",
		response.status,
	);
}

async function request(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...init.headers },
	});
	if (!response.ok) throw await errorFrom(response);
	return response.json();
}

export async function createCustomField(input: {
	id: string;
	projectId: string;
	name: string;
	fieldType: CustomFieldType;
	options?: string[];
}): Promise<void> {
	await request(`/api/projects/${input.projectId}/custom-fields`, {
		method: "POST",
		body: JSON.stringify({
			id: input.id,
			name: input.name,
			fieldType: input.fieldType,
			...(input.fieldType === "select" ? { options: input.options } : {}),
		}),
	});
}

export async function updateCustomField(
	fieldId: string,
	patch: { name?: string; options?: string[]; position?: number },
): Promise<void> {
	await request(`/api/custom-fields/${fieldId}`, {
		method: "PATCH",
		body: JSON.stringify(patch),
	});
}

export async function deleteCustomField(fieldId: string, expectedName: string): Promise<void> {
	await request(`/api/custom-fields/${fieldId}?confirm=${encodeURIComponent(expectedName)}`, {
		method: "DELETE",
	});
}

export async function setTaskCustomFieldValue(
	taskId: string,
	projectId: string,
	fieldId: string,
	value: unknown,
): Promise<void> {
	const existing = await powerSync.getOptional<{ id: string }>(
		"SELECT id FROM task_custom_field_values WHERE task_id = ? AND field_id = ? LIMIT 1",
		[taskId, fieldId],
	);
	if (value === null) {
		if (existing) await powerSync.execute("DELETE FROM task_custom_field_values WHERE id = ?", [existing.id]);
		return;
	}
	const encoded = JSON.stringify(value);
	const now = new Date().toISOString();
	if (existing) {
		await powerSync.execute(
			"UPDATE task_custom_field_values SET value = ?, updated_at = ? WHERE id = ?",
			[encoded, now, existing.id],
		);
		return;
	}
	await powerSync.execute(
		"INSERT INTO task_custom_field_values (id, field_id, task_id, project_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[crypto.randomUUID(), fieldId, taskId, projectId, encoded, now, now],
	);
}

export function parseCustomFieldOptions(value: unknown): CustomFieldOption[] {
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
		(option): option is CustomFieldOption =>
			typeof option === "object" &&
			option !== null &&
			typeof (option as CustomFieldOption).id === "string" &&
			typeof (option as CustomFieldOption).label === "string",
	);
}

export function parseCustomFieldValue(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
