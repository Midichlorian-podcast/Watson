/**
 * Postgres enumy odvozené z jednoho zdroje pravdy (@watson/shared).
 * Tím se DB schéma a FE/BE validace nikdy nerozejdou.
 */
import {
	ACTOR_TYPES,
	AI_LEVELS,
	AI_SUGGESTION_STATUS,
	ASSIGNMENT_MODES,
	CALENDAR_PROVIDERS,
	CHAIN_DUE_BASIS,
	CHAIN_GATES,
	CHAIN_STATES,
	CHAIN_STEP_STATES,
	GOAL_METRICS,
	GOAL_PERIODIC,
	GOAL_SCOPES,
	NOTIFICATION_CHANNELS,
	OWNER_SCOPES,
	PROJECT_KINDS,
	PROJECT_LAYOUTS,
	PROJECT_ROLES,
	PROJECT_STATUSES,
	PROJECT_VISIBILITY,
	RECURRENCE_BASIS,
	REMINDER_TYPES,
	STATUS_SCOPES,
	WORKSPACE_ROLES,
} from "@watson/shared";
import { pgEnum } from "drizzle-orm/pg-core";

/** Pomocník: readonly tuple → mutable tuple, který pgEnum vyžaduje. */
const tuple = <T extends readonly [string, ...string[]]>(values: T) =>
	[...values] as [string, ...string[]];

export const workspaceRoleEnum = pgEnum(
	"workspace_role",
	tuple(WORKSPACE_ROLES),
);
export const projectRoleEnum = pgEnum("project_role", tuple(PROJECT_ROLES));
export const projectVisibilityEnum = pgEnum(
	"project_visibility",
	tuple(PROJECT_VISIBILITY),
);
export const projectLayoutEnum = pgEnum(
	"project_layout",
	tuple(PROJECT_LAYOUTS),
);
export const projectKindEnum = pgEnum("project_kind", tuple(PROJECT_KINDS));
export const projectStatusEnum = pgEnum(
	"project_status",
	tuple(PROJECT_STATUSES),
);
export const statusScopeEnum = pgEnum("status_scope", tuple(STATUS_SCOPES));
export const assignmentModeEnum = pgEnum(
	"assignment_mode",
	tuple(ASSIGNMENT_MODES),
);
export const recurrenceBasisEnum = pgEnum(
	"recurrence_basis",
	tuple(RECURRENCE_BASIS),
);
export const reminderTypeEnum = pgEnum("reminder_type", tuple(REMINDER_TYPES));
export const notificationChannelEnum = pgEnum(
	"notification_channel",
	tuple(NOTIFICATION_CHANNELS),
);
export const aiLevelEnum = pgEnum("ai_level", tuple(AI_LEVELS));
export const aiSuggestionStatusEnum = pgEnum(
	"ai_suggestion_status",
	tuple(AI_SUGGESTION_STATUS),
);
export const actorTypeEnum = pgEnum("actor_type", tuple(ACTOR_TYPES));
export const ownerScopeEnum = pgEnum("owner_scope", tuple(OWNER_SCOPES));
export const calendarProviderEnum = pgEnum(
	"calendar_provider",
	tuple(CALENDAR_PROVIDERS),
);
export const chainStateEnum = pgEnum("chain_state", tuple(CHAIN_STATES));
export const chainStepStateEnum = pgEnum(
	"chain_step_state",
	tuple(CHAIN_STEP_STATES),
);
export const chainGateEnum = pgEnum("chain_gate", tuple(CHAIN_GATES));
export const chainDueBasisEnum = pgEnum(
	"chain_due_basis",
	tuple(CHAIN_DUE_BASIS),
);
export const goalScopeEnum = pgEnum("goal_scope", tuple(GOAL_SCOPES));
export const goalMetricEnum = pgEnum("goal_metric", tuple(GOAL_METRICS));
export const goalPeriodicEnum = pgEnum("goal_periodic", tuple(GOAL_PERIODIC));
