export type TimelineKind =
	| "task_created"
	| "task_updated"
	| "task_rescheduled"
	| "task_completed"
	| "task_reopened"
	| "task_deleted"
	| "task_restored"
	| "comment_added"
	| "comment_updated"
	| "comment_deleted"
	| "decision_marked"
	| "decision_unmarked"
	| "assignment_added"
	| "assignment_updated"
	| "assignment_removed"
	| "acceptance_requested"
	| "acceptance_accepted"
	| "acceptance_declined"
	| "acceptance_cancelled"
	| "reminder_added"
	| "reminder_updated"
	| "reminder_removed"
	| "attachment_added"
	| "attachment_removed"
	| "custom_field_updated"
	| "poll_created"
	| "poll_updated"
	| "poll_closed"
	| "poll_reopened"
	| "poll_deleted"
	| "poll_response_updated"
	| "dependency_added"
	| "dependency_removed"
	| "occurrence_updated"
	| "meeting_updated"
	| "integration_created";

export type TimelineChange = {
	field: string;
	oldValue?: string | null;
	newValue?: string | null;
};

export type TaskTimelineEvent = {
	id: string;
	source: "audit" | "legacy";
	kind: TimelineKind;
	actorType: "user" | "ai" | "system";
	actorUserId: string | null;
	actorName: string | null;
	createdAt: string;
	changedFields: string[];
	changes: TimelineChange[];
	commentId?: string;
	excerpt?: string;
	relatedTaskId?: string;
	relatedUserId?: string;
	direction?: "blocked_by" | "blocks";
};

export type RawAuditTimelineRow = {
	id: string;
	entity: string;
	entity_id: string | null;
	action: string;
	diff: unknown;
	before: unknown;
	actor_type: string | null;
	actor_user_id: string | null;
	actor_name: string | null;
	created_at: string | Date;
};

export type RawLegacyTimelineRow = {
	id: string;
	field: string | null;
	old_value: string | null;
	new_value: string | null;
	user_id: string | null;
	user_name: string | null;
	created_at: string | Date;
};

const TASK_FIELDS = new Set([
	"name",
	"description",
	"why_now",
	"priority",
	"color",
	"due_date",
	"start_date",
	"start_timezone",
	"deadline",
	"duration_min",
	"days",
	"recurrence",
	"recurrence_rule",
	"assignment_mode",
	"status_id",
	"parent_id",
	"completed_at",
]);
const SCHEDULE_FIELDS = new Set(["due_date", "start_date", "start_timezone", "deadline"]);
const VALUE_FIELDS = new Set([
	"name",
	"priority",
	"due_date",
	"start_date",
	"deadline",
	"duration_min",
	"days",
	"recurrence",
	"assignment_mode",
]);

const recordOf = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const stringOf = (value: unknown, max = 240): string | null => {
	if (value == null) return null;
	if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
		return null;
	const normalized = String(value).replace(/\s+/g, " ").trim();
	if (!normalized) return null;
	return normalized.slice(0, max);
};

/** PowerSync audit drží JSON scalar jako serializovaný text, API command jako scalar. */
const jsonScalarStringOf = (value: unknown): string | null => {
	if (typeof value === "string") {
		try {
			return stringOf(JSON.parse(value));
		} catch {
			return stringOf(value);
		}
	}
	return stringOf(value);
};

const idOf = (value: unknown): string | undefined => {
	const candidate = stringOf(value, 64);
	return candidate && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : undefined;
};

const actorTypeOf = (value: string | null): "user" | "ai" | "system" =>
	value === "ai" ? "ai" : value === "user" ? "user" : "system";

function taskChanges(diff: Record<string, unknown>, before: Record<string, unknown>) {
	const fields = Object.keys(diff).filter((field) => TASK_FIELDS.has(field));
	const changes = fields.map<TimelineChange>((field) => {
		if (!VALUE_FIELDS.has(field)) return { field };
		return {
			field,
			oldValue: stringOf(before[field]),
			newValue: stringOf(diff[field]),
		};
	});
	return { fields, changes };
}

function kindForAction(entity: string, action: string): TimelineKind | null {
	const removed = action === "delete";
	const added = action === "put" || action === "create";
	switch (entity) {
		case "comments":
			return removed ? "comment_deleted" : added ? "comment_added" : "comment_updated";
		case "comment_decisions":
			return removed ? "decision_unmarked" : "decision_marked";
		case "assignments":
			return removed ? "assignment_removed" : added ? "assignment_added" : "assignment_updated";
		case "task_acceptances":
			if (action === "requested") return "acceptance_requested";
			if (action === "accepted") return "acceptance_accepted";
			if (action === "declined") return "acceptance_declined";
			return "acceptance_cancelled";
		case "reminders":
			return removed ? "reminder_removed" : added ? "reminder_added" : "reminder_updated";
		case "attachments":
			return removed ? "attachment_removed" : "attachment_added";
		case "task_custom_field_values":
			return "custom_field_updated";
		case "task_polls":
			if (removed) return "poll_deleted";
			if (added) return "poll_created";
			if (action === "close") return "poll_closed";
			if (action === "reopen") return "poll_reopened";
			return "poll_updated";
		case "task_poll_responses":
			return "poll_response_updated";
		case "task_dependencies":
			return removed ? "dependency_removed" : "dependency_added";
		case "task_occurrence_overrides":
			return "occurrence_updated";
		case "meetings":
			return "meeting_updated";
		case "employee_reconcile":
			return "integration_created";
		case "task_delete_batch":
			return action === "restore" ? "task_restored" : "task_deleted";
		default:
			return null;
	}
}

export function mapAuditTimelineEvent(
	row: RawAuditTimelineRow,
	taskId: string,
): TaskTimelineEvent | null {
	const diff = recordOf(row.diff);
	const before = recordOf(row.before);
	const base = {
		id: `audit:${row.id}`,
		source: "audit" as const,
		actorType: actorTypeOf(row.actor_type),
		actorUserId: row.actor_user_id,
		actorName: row.actor_name,
		createdAt: new Date(row.created_at).toISOString(),
	};

	if (row.entity === "tasks") {
		const { fields, changes } = taskChanges(diff, before);
		let kind: TimelineKind = "task_updated";
		if (row.action === "put" || row.action === "create") kind = "task_created";
		else if (row.action === "delete") kind = "task_deleted";
		else if (Object.hasOwn(diff, "completed_at"))
			kind = diff.completed_at ? "task_completed" : "task_reopened";
		else if (fields.some((field) => SCHEDULE_FIELDS.has(field))) kind = "task_rescheduled";
		return { ...base, kind, changedFields: fields, changes };
	}

	const kind = kindForAction(row.entity, row.action);
	if (!kind) return null;
	const data = row.action === "delete" ? before : diff;
	const common: Omit<TaskTimelineEvent, "kind"> = {
		...base,
		changedFields: [],
		changes: [],
	};
	if (row.entity === "comments") {
		return {
			...common,
			kind,
			commentId: row.entity_id ?? undefined,
			excerpt: row.action === "delete" ? undefined : (stringOf(data.body) ?? undefined),
		};
	}
	if (row.entity === "comment_decisions") {
		return { ...common, kind, commentId: idOf(data.comment_id) };
	}
	if (row.entity === "assignments") {
		return { ...common, kind, relatedUserId: idOf(data.user_id) };
	}
	if (row.entity === "task_acceptances") {
		return { ...common, kind, relatedUserId: idOf(data.assignee_id) };
	}
	if (row.entity === "attachments") {
		return { ...common, kind, excerpt: stringOf(data.file_name) ?? undefined };
	}
	if (row.entity === "task_custom_field_values") {
		return {
			...common,
			kind,
			excerpt: stringOf(data.field_name) ?? undefined,
			changedFields: ["custom_field"],
			changes: [
				{
					field: "custom_field",
					oldValue: jsonScalarStringOf(before.value),
					newValue: jsonScalarStringOf(diff.value),
				},
			],
		};
	}
	if (row.entity === "task_polls") {
		return { ...common, kind, excerpt: stringOf(data.question) ?? undefined };
	}
	if (row.entity === "task_poll_responses") {
		return {
			...common,
			kind,
			excerpt: stringOf(data.question) ?? undefined,
			relatedUserId: idOf(data.respondent_id),
		};
	}
	if (row.entity === "task_dependencies") {
		const blocking = idOf(data.blocking_task_id);
		const blocked = idOf(data.blocked_task_id);
		const direction = blocked === taskId ? "blocked_by" : "blocks";
		return {
			...common,
			kind,
			direction,
			relatedTaskId: direction === "blocked_by" ? blocking : blocked,
		};
	}
	return { ...common, kind };
}

export function mapLegacyTimelineEvent(row: RawLegacyTimelineRow): TaskTimelineEvent | null {
	const field = row.field ?? "";
	if (!field) return null;
	let kind: TimelineKind = "task_updated";
	let normalizedField = field;
	if (field === "created") kind = "task_created";
	else if (field === "completed") {
		kind = row.new_value ? "task_completed" : "task_reopened";
		normalizedField = "completed_at";
	} else if (field === "comment_decision") {
		kind = row.new_value ? "decision_marked" : "decision_unmarked";
	} else if (SCHEDULE_FIELDS.has(field)) kind = "task_rescheduled";
	const showValue = VALUE_FIELDS.has(normalizedField);
	return {
		id: `legacy:${row.id}`,
		source: "legacy",
		kind,
		actorType: "user",
		actorUserId: row.user_id,
		actorName: row.user_name,
		createdAt: new Date(row.created_at).toISOString(),
		changedFields: field === "created" ? [] : [normalizedField],
		changes:
			field === "created" || field === "completed" || field === "comment_decision"
				? []
				: [
						{
							field: normalizedField,
							oldValue: showValue ? row.old_value : undefined,
							newValue: showValue ? row.new_value : undefined,
						},
					],
		commentId:
			field === "comment_decision" ? (idOf(row.new_value) ?? idOf(row.old_value)) : undefined,
	};
}

function sameSemanticEvent(audit: TaskTimelineEvent, legacy: TaskTimelineEvent): boolean {
	if (audit.source !== "audit" || legacy.source !== "legacy") return false;
	if (audit.actorUserId && legacy.actorUserId && audit.actorUserId !== legacy.actorUserId) return false;
	if (Math.abs(Date.parse(audit.createdAt) - Date.parse(legacy.createdAt)) > 20_000) return false;
	if (audit.kind !== legacy.kind) return false;
	if (legacy.changedFields.length > 0) {
		return legacy.changedFields.some((field) => audit.changedFields.includes(field));
	}
	if (legacy.commentId || audit.commentId) return legacy.commentId === audit.commentId;
	return true;
}

/** Autoritativní audit má přednost; starší client-side historie doplní jen chybějící události. */
export function mergeTaskTimeline(
	auditRows: RawAuditTimelineRow[],
	legacyRows: RawLegacyTimelineRow[],
	taskId: string,
): TaskTimelineEvent[] {
	const audit = auditRows
		.map((row) => mapAuditTimelineEvent(row, taskId))
		.filter((event): event is TaskTimelineEvent => Boolean(event));
	const legacy = legacyRows
		.map(mapLegacyTimelineEvent)
		.filter((event): event is TaskTimelineEvent => Boolean(event))
		.filter((event) => !audit.some((candidate) => sameSemanticEvent(candidate, event)));
	return [...audit, ...legacy].sort(
		(left, right) =>
			Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id),
	);
}

export function encodeTimelineCursor(event: TaskTimelineEvent): string {
	return Buffer.from(JSON.stringify({ at: event.createdAt, id: event.id })).toString("base64url");
}

export function decodeTimelineCursor(value: string | null): { at: string; id: string } | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
			at?: unknown;
			id?: unknown;
		};
		if (typeof parsed.at !== "string" || Number.isNaN(Date.parse(parsed.at))) return null;
		if (typeof parsed.id !== "string" || !/^(audit|legacy):[0-9a-f-]{36}$/i.test(parsed.id))
			return null;
		return { at: new Date(parsed.at).toISOString(), id: parsed.id };
	} catch {
		return null;
	}
}
