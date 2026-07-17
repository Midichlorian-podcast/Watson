export type OutboxOperation = {
	id: string;
	table: string;
	rowId: string;
	op: "PUT" | "PATCH" | "DELETE";
	data: Record<string, unknown>;
	previous: Record<string, unknown>;
};

export type OutboxDiff = { field: string; before: string; after: string };

const SENSITIVE_FIELD = /(password|secret|token|cipher|private.?key|recovery|credential)/i;
const TECHNICAL_FIELD = /^(id|created_at|updated_at|created_by|updated_by)$/;

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function safeValue(field: string, value: unknown): string {
	if (SENSITIVE_FIELD.test(field)) return "••••••";
	if (value == null || value === "") return "—";
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function operationDiff(operation: OutboxOperation, limit = 8): OutboxDiff[] {
	const fields = new Set<string>();
	if (operation.op === "DELETE") {
		for (const field of Object.keys(operation.previous)) fields.add(field);
	} else {
		for (const field of Object.keys(operation.data)) fields.add(field);
	}
	return [...fields]
		.filter((field) => !TECHNICAL_FIELD.test(field))
		.sort()
		.slice(0, limit)
		.map((field) => ({
			field,
			before: safeValue(field, operation.previous[field]),
			after: operation.op === "DELETE" ? "∅" : safeValue(field, operation.data[field]),
		}));
}

export function normalizePendingOperation(input: {
	clientId: number;
	table: string;
	id: string;
	op: string;
	opData?: Record<string, unknown>;
	previousValues?: Record<string, unknown>;
}): OutboxOperation {
	return {
		id: String(input.clientId),
		table: input.table,
		rowId: input.id,
		op: input.op === "DELETE" ? "DELETE" : input.op === "PATCH" ? "PATCH" : "PUT",
		data: record(input.opData),
		previous: record(input.previousValues),
	};
}

export function parseRejectedOperation(
	id: string,
	table: string,
	rowId: string,
	op: string,
	payload: string | null,
): OutboxOperation {
	let envelope: Record<string, unknown> = {};
	try {
		envelope = record(payload ? JSON.parse(payload) : {});
	} catch {
		/* nečitelný legacy payload zůstane kopírovatelný, UI nesmí spadnout */
	}
	return {
		id,
		table,
		rowId,
		op: op === "DELETE" ? "DELETE" : op === "PATCH" ? "PATCH" : "PUT",
		data: record(envelope.data),
		previous: record(envelope.previous),
	};
}

export function formatQueueBytes(size: number | null, locale: string): string {
	if (size == null) return "—";
	const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
	if (size < 1024) return `${formatter.format(size)} B`;
	if (size < 1024 * 1024) return `${formatter.format(size / 1024)} kB`;
	return `${formatter.format(size / (1024 * 1024))} MB`;
}
