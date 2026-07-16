export type ImportSource = "csv" | "asana" | "trello" | "todoist";

export type ImportField =
	| "name"
	| "description"
	| "dueDate"
	| "priority"
	| "completed"
	| "sourceKey"
	| "parentSourceKey"
	| "sectionName"
	| "assignees"
	| "labels"
	| "attachmentNames";

export type ImportMapping = Partial<Record<ImportField, string>>;

export type CsvTable = {
	headers: string[];
	rows: Record<string, string>[];
	delimiter: "," | ";" | "\t";
};

export type ImportMember = { id: string; name: string; email: string };

export type ImportItem = {
	sourceKey: string;
	parentSourceKey: string | null;
	name: string;
	description: string | null;
	sectionName: string | null;
	dueDate: string | null;
	priority: number;
	completed: boolean;
	assigneeIds: string[];
	labels: string[];
	attachmentNames: string[];
};

export type ImportIssue = {
	row: number;
	field: ImportField | "file";
	code: string;
	value?: string;
};

export const IMPORT_FIELDS: ImportField[] = [
	"name",
	"description",
	"dueDate",
	"priority",
	"completed",
	"sourceKey",
	"parentSourceKey",
	"sectionName",
	"assignees",
	"labels",
	"attachmentNames",
];

const MAX_ROWS = 2_000;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 100_000;

const FIELD_ALIASES: Record<ImportSource, Partial<Record<ImportField, string[]>>> = {
	csv: {
		name: ["name", "task", "task name", "title", "název", "úkol"],
		description: ["description", "notes", "note", "popis", "poznámka"],
		dueDate: ["due", "due date", "deadline", "termín", "datum"],
		priority: ["priority", "priorita"],
		completed: ["completed", "complete", "done", "status", "hotovo"],
		sourceKey: ["id", "task id", "source id", "external id"],
		parentSourceKey: ["parent id", "parent task", "parent", "parent task id"],
		sectionName: ["section", "list", "board", "project section", "sekce", "seznam"],
		assignees: ["assignee", "assignees", "assigned to", "owner", "řešitel"],
		labels: ["labels", "label", "tags", "tag", "štítky"],
		attachmentNames: ["attachments", "attachment", "files", "file", "přílohy"],
	},
	asana: {
		name: ["name", "task name"],
		description: ["notes", "description"],
		dueDate: ["due date", "due"],
		priority: ["priority"],
		completed: ["completed at", "completed", "status"],
		sourceKey: ["task id", "id"],
		parentSourceKey: ["parent task", "parent task id", "parent id"],
		sectionName: ["section/column", "section", "projects"],
		assignees: ["assignee", "assignee email"],
		labels: ["tags", "tag"],
		attachmentNames: ["attachments", "files"],
	},
	trello: {
		name: ["card name", "name", "title"],
		description: ["card description", "description"],
		dueDate: ["due date", "due"],
		priority: ["priority"],
		completed: ["completed", "closed", "status"],
		sourceKey: ["card id", "id", "shortlink"],
		parentSourceKey: ["parent card id", "parent id"],
		sectionName: ["list name", "list", "board name"],
		assignees: ["members", "member", "assignees"],
		labels: ["labels", "label"],
		attachmentNames: ["attachments", "attachment links"],
	},
	todoist: {
		name: ["content", "task", "name"],
		description: ["description", "notes"],
		dueDate: ["due date", "date", "deadline"],
		priority: ["priority"],
		completed: ["completed", "checked", "status"],
		sourceKey: ["id", "task id"],
		parentSourceKey: ["parent id", "parent_id"],
		sectionName: ["section", "section name", "project"],
		assignees: ["assignee", "responsible"],
		labels: ["labels", "label"],
		attachmentNames: ["attachments", "files"],
	},
};

function normalizeHeader(value: string) {
	return value.trim().toLocaleLowerCase().replace(/[_.-]+/g, " ").replace(/\s+/g, " ");
}

function delimiterScore(text: string, delimiter: "," | ";" | "\t") {
	let count = 0;
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			if (quoted && text[index + 1] === '"') index += 1;
			else quoted = !quoted;
		} else if (!quoted && char === delimiter) count += 1;
		else if (!quoted && (char === "\n" || char === "\r")) break;
	}
	return count;
}

export function detectDelimiter(text: string): "," | ";" | "\t" {
	const choices = ([",", ";", "\t"] as const).map((delimiter) => ({
		delimiter,
		score: delimiterScore(text, delimiter),
	}));
	choices.sort((left, right) => right.score - left.score);
	return choices[0]?.delimiter ?? ",";
}

export function parseDelimitedText(input: string): CsvTable {
	const text = input.replace(/^\uFEFF/, "");
	const delimiter = detectDelimiter(text);
	const records: string[][] = [];
	let record: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index <= text.length; index += 1) {
		const char = text[index];
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else if (char === '"') quoted = false;
			else if (char === undefined) throw new Error("csv_unclosed_quote");
			else cell += char;
			continue;
		}
		if (char === '"' && cell.length === 0) quoted = true;
		else if (char === delimiter) {
			record.push(cell);
			cell = "";
		} else if (char === "\n" || char === "\r" || char === undefined) {
			record.push(cell);
			if (record.some((value) => value.length > 0)) records.push(record);
			record = [];
			cell = "";
			if (char === "\r" && text[index + 1] === "\n") index += 1;
		} else cell += char;
		if (cell.length > MAX_CELL_LENGTH) throw new Error("csv_cell_too_long");
	}
	const rawHeaders = records.shift() ?? [];
	if (rawHeaders.length === 0) throw new Error("csv_empty");
	if (rawHeaders.length > MAX_COLUMNS) throw new Error("csv_too_many_columns");
	const headers: string[] = [];
	const used = new Set<string>();
	for (let index = 0; index < rawHeaders.length; index += 1) {
		const base = rawHeaders[index]?.trim() || `Column ${index + 1}`;
		let name = base;
		let suffix = 2;
		while (used.has(normalizeHeader(name))) name = `${base} (${suffix++})`;
		used.add(normalizeHeader(name));
		headers.push(name);
	}
	if (records.length > MAX_ROWS) throw new Error("csv_too_many_rows");
	const rows = records.map((values) => {
		if (values.slice(headers.length).some((value) => value.trim().length > 0))
			throw new Error("csv_too_many_values");
		return Object.fromEntries(
			headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
		);
	});
	return { headers, rows, delimiter };
}

export function suggestMapping(source: ImportSource, headers: string[]): ImportMapping {
	const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
	const mapping: ImportMapping = {};
	const aliases = { ...FIELD_ALIASES.csv, ...FIELD_ALIASES[source] };
	for (const field of IMPORT_FIELDS) {
		for (const alias of aliases[field] ?? []) {
			const header = normalized.get(normalizeHeader(alias));
			if (header) {
				mapping[field] = header;
				break;
			}
		}
	}
	return mapping;
}

function splitList(value: string) {
	return [
		...new Set(
			value
				.trim()
				.replace(/^\[|\]$/g, "")
				.split(/[;|,\n]/)
				.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
				.filter(Boolean),
		),
	];
}

function parseCompleted(value: string): boolean | null {
	const normalized = value.trim().toLocaleLowerCase();
	if (!normalized) return false;
	if (["1", "true", "yes", "y", "done", "complete", "completed", "closed", "ano", "hotovo"].includes(normalized))
		return true;
	if (["0", "false", "no", "n", "open", "incomplete", "active", "ne"].includes(normalized))
		return false;
	if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) return true;
	return null;
}

function parsePriority(value: string, source: ImportSource): number | null {
	const normalized = value.trim().toLocaleLowerCase();
	if (!normalized) return 4;
	const token = normalized.match(/(?:^|\s)p?([1-4])(?:\s|$)/)?.[1];
	if (token) {
		const number = Number(token);
		return source === "todoist" && /^\d$/.test(normalized) ? 5 - number : number;
	}
	if (["urgent", "critical", "highest", "acute", "akutní"].includes(normalized)) return 1;
	if (["high", "soon", "vysoká"].includes(normalized)) return 2;
	if (["medium", "normal", "střední"].includes(normalized)) return 3;
	if (["low", "lowest", "nízká"].includes(normalized)) return 4;
	return null;
}

function parseDateOnly(value: string): string | null | undefined {
	const normalized = value.trim();
	if (!normalized) return null;
	const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
	const local = normalized.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
	const candidate = iso
		? `${iso[1]}-${iso[2]}-${iso[3]}`
		: local
			? `${local[3]}-${local[2]?.padStart(2, "0")}-${local[1]?.padStart(2, "0")}`
			: null;
	if (!candidate) return undefined;
	const parsed = new Date(`${candidate}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
		? candidate
		: undefined;
}

export function normalizeImportRows(
	table: CsvTable,
	mapping: ImportMapping,
	members: ImportMember[],
	source: ImportSource = "csv",
): { items: ImportItem[]; errors: ImportIssue[]; warnings: ImportIssue[] } {
	const errors: ImportIssue[] = [];
	const warnings: ImportIssue[] = [];
	const memberLookup = new Map<string, string[]>();
	for (const member of members) {
		for (const key of [member.name, member.email].map((value) => value.trim().toLocaleLowerCase()))
			memberLookup.set(key, [...new Set([...(memberLookup.get(key) ?? []), member.id])]);
	}
	const read = (row: Record<string, string>, field: ImportField) =>
		mapping[field] ? (row[mapping[field] as string] ?? "") : "";
	const items = table.rows.map((row, index): ImportItem => {
		const rowNumber = index + 2;
		const name = read(row, "name").trim();
		if (!name) errors.push({ row: rowNumber, field: "name", code: "required" });
		if (name.length > 500) errors.push({ row: rowNumber, field: "name", code: "too_long" });
		const rawSourceKey = read(row, "sourceKey").trim();
		const sourceKey = rawSourceKey || String(index + 1);
		if (sourceKey.length > 200)
			errors.push({ row: rowNumber, field: "sourceKey", code: "too_long" });
		const parentSourceKey = read(row, "parentSourceKey").trim() || null;
		if (parentSourceKey && parentSourceKey.length > 200)
			errors.push({ row: rowNumber, field: "parentSourceKey", code: "too_long" });
		const sectionName = read(row, "sectionName").trim() || null;
		if (sectionName && sectionName.length > 200)
			errors.push({ row: rowNumber, field: "sectionName", code: "too_long" });
		const dueDate = parseDateOnly(read(row, "dueDate"));
		if (dueDate === undefined)
			errors.push({ row: rowNumber, field: "dueDate", code: "invalid_date", value: read(row, "dueDate") });
		const priority = parsePriority(read(row, "priority"), source);
		if (priority === null)
			warnings.push({ row: rowNumber, field: "priority", code: "defaulted", value: read(row, "priority") });
		const completed = parseCompleted(read(row, "completed"));
		if (completed === null)
			warnings.push({ row: rowNumber, field: "completed", code: "defaulted", value: read(row, "completed") });
		const assigneeIds: string[] = [];
		for (const assignee of splitList(read(row, "assignees"))) {
			const emailInBrackets = assignee.match(/<([^<>]+@[^<>]+)>/)?.[1];
			const lookupKeys = [assignee, emailInBrackets ?? ""]
				.map((value) => value.trim().toLocaleLowerCase())
				.filter(Boolean);
			const matches = [...new Set(lookupKeys.flatMap((key) => memberLookup.get(key) ?? []))];
			if (matches.length === 1) assigneeIds.push(matches[0] as string);
			else warnings.push({
				row: rowNumber,
				field: "assignees",
				code: matches.length > 1 ? "ambiguous_assignee" : "unmatched_assignee",
				value: assignee,
			});
		}
		const uniqueAssigneeIds = [...new Set(assigneeIds)];
		const labelValues = splitList(read(row, "labels"));
		const attachmentValues = splitList(read(row, "attachmentNames"));
		if (uniqueAssigneeIds.length > 20)
			errors.push({ row: rowNumber, field: "assignees", code: "too_many" });
		if (labelValues.length > 50)
			errors.push({ row: rowNumber, field: "labels", code: "too_many" });
		if (attachmentValues.length > 50)
			errors.push({ row: rowNumber, field: "attachmentNames", code: "too_many" });
		return {
			sourceKey,
			parentSourceKey,
			name,
			description: read(row, "description") || null,
			sectionName,
			dueDate: dueDate ?? null,
			priority: priority ?? 4,
			completed: completed ?? false,
			assigneeIds: uniqueAssigneeIds,
			labels: labelValues,
			attachmentNames: attachmentValues,
		};
	});
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!item) continue;
		if (item.labels.some((label) => label.length > 100))
			errors.push({ row: index + 2, field: "labels", code: "too_long" });
		if (item.attachmentNames.some((name) => name.length > 255))
			errors.push({ row: index + 2, field: "attachmentNames", code: "too_long" });
	}
	const sourceKeys = new Set(items.map((item) => item.sourceKey));
	const sourceKeysByName = new Map<string, string[]>();
	for (const item of items) {
		const key = item.name.toLocaleLowerCase();
		sourceKeysByName.set(key, [...(sourceKeysByName.get(key) ?? []), item.sourceKey]);
	}
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!item?.parentSourceKey || sourceKeys.has(item.parentSourceKey)) continue;
		const nameMatches = sourceKeysByName.get(item.parentSourceKey.toLocaleLowerCase()) ?? [];
		if (nameMatches.length === 1) item.parentSourceKey = nameMatches[0] ?? item.parentSourceKey;
		else if (nameMatches.length > 1)
			errors.push({
				row: index + 2,
				field: "parentSourceKey",
				code: "ambiguous_parent",
				value: item.parentSourceKey,
			});
	}
	const seen = new Map<string, number>();
	for (let index = 0; index < items.length; index += 1) {
		const key = items[index]?.sourceKey ?? "";
		if (seen.has(key)) errors.push({ row: index + 2, field: "sourceKey", code: "duplicate_source_key", value: key });
		else seen.set(key, index);
	}
	return { items, errors, warnings };
}

export async function sha256File(file: File): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function matchSupportingFiles(
	items: ImportItem[],
	files: File[],
): { bySourceKey: Map<string, File[]>; missing: string[]; unused: File[] } {
	const available = new Map<string, File[]>();
	for (const file of files) {
		const path = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
			.replace(/\\/g, "/")
			.toLocaleLowerCase();
		for (const key of [path, path.split("/").pop() ?? path])
			available.set(key, [...(available.get(key) ?? []), file]);
	}
	const used = new Set<File>();
	const bySourceKey = new Map<string, File[]>();
	const missing: string[] = [];
	for (const item of items) {
		const matches: File[] = [];
		for (const expected of item.attachmentNames) {
			const key = expected.replace(/\\/g, "/").toLocaleLowerCase();
			const candidates = available.get(key) ?? available.get(key.split("/").pop() ?? key) ?? [];
			const file = candidates.find((candidate) => !used.has(candidate));
			if (file) {
				used.add(file);
				matches.push(file);
			} else missing.push(expected);
		}
		bySourceKey.set(item.sourceKey, matches);
	}
	return { bySourceKey, missing, unused: files.filter((file) => !used.has(file)) };
}
