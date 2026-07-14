/**
 * Sestavení INSERT řádku úkolu z výstupu Quick Add parseru — čistá funkce (testy bez UI).
 *
 * KONTRAKT (CC-P0-02):
 * - `recurrence_basis` NIKDY není NULL: PostgreSQL sloupec je NOT NULL a explicitní
 *   SQL NULL nespustí DB default — server by celý insert odmítl 400 a connector
 *   operaci zahodil (úkol po resyncu zmizí).
 * - `days` z parseru se ukládá; jinak se vícedennost tiše ztratí.
 */
import type { ParsedDraft } from "./types";

export interface QuickAddTaskInput {
	parsed: Pick<
		ParsedDraft,
		"priority" | "due" | "deadline" | "startMin" | "durationMin" | "days" | "recurrence"
	>;
	taskId: string;
	projectId: string;
	/** Vyčištěný název (parsed.name.trim() — validuje caller). */
	name: string;
	assignmentMode: "single" | "shared_all";
	userId: string | null;
	/** Reálný „dnešek" YYYY-MM-DD — základ start_date, když je čas bez data. */
	today: string;
	/** ISO timestamp vzniku. */
	now: string;
}

export interface QuickAddTaskRow {
	columns: string[];
	values: (string | number | null)[];
}

export function buildQuickAddTaskRow(input: QuickAddTaskInput): QuickAddTaskRow {
	const { parsed, taskId, projectId, name, assignmentMode, userId, today, now } = input;
	// start_date = termín (nebo dnes) + čas dne, pokud parser rozpoznal čas.
	let startDate: string | null = null;
	if (parsed.startMin != null) {
		const base = parsed.due ?? today;
		const hh = String(Math.floor(parsed.startMin / 60)).padStart(2, "0");
		const mm = String(parsed.startMin % 60).padStart(2, "0");
		startDate = `${base}T${hh}:${mm}:00`;
	}
	const columns = [
		"id",
		"project_id",
		"name",
		"priority",
		"due_date",
		"start_date",
		"deadline",
		"duration_min",
		"days",
		"recurrence",
		"recurrence_rule",
		"recurrence_basis",
		"assignment_mode",
		"created_by",
		"created_at",
	];
	const values: (string | number | null)[] = [
		taskId,
		projectId,
		name,
		parsed.priority ?? 2,
		parsed.due ?? null,
		startDate,
		parsed.deadline ?? null,
		parsed.durationMin ?? null,
		parsed.days ?? null,
		parsed.recurrence?.label ?? null,
		parsed.recurrence ? JSON.stringify(parsed.recurrence) : null,
		"due_date",
		assignmentMode,
		userId,
		now,
	];
	return { columns, values };
}

/** SQL text INSERTu pro sestavu sloupců (placeholdery dle počtu). */
export function quickAddInsertSql(row: QuickAddTaskRow): string {
	return `INSERT INTO tasks (${row.columns.join(", ")}) VALUES (${row.columns
		.map(() => "?")
		.join(", ")})`;
}
