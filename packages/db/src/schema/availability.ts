/**
 * Dostupnost člověka v konkrétním workspace.
 *
 * Profil drží opakující se pracovní/quiet-hours rozvrh a ruční snooze. Konkrétní
 * časové výjimky (Focus Time, absence, nedostupnost, svátek) jsou samostatné
 * řádky, aby šly auditovat, zobrazit v kalendáři a později napojit na LuckyOS.
 * Scope je záměrně membership, ne globální user profil: člověk nesmí prozradit
 * dostupnost jednomu týmu jen proto, že ji nastavil v jiném prostoru.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { tasks } from "./task";
import { memberships, workspaces } from "./workspace";

export type WorkingHoursConfig = {
	enabled: boolean;
	days: Array<{
		/** ISO weekday: 1 = Monday, 7 = Sunday. */
		day: number;
		intervals: Array<{ startMinute: number; endMinute: number }>;
	}>;
};

export type QuietHoursConfig = {
	enabled: boolean;
	/** ISO weekdays on which the quiet period starts. */
	days: number[];
	startMinute: number;
	endMinute: number;
};

export const DEFAULT_WORKING_HOURS: WorkingHoursConfig = {
	enabled: false,
	days: [],
};

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
	enabled: false,
	days: [1, 2, 3, 4, 5, 6, 7],
	startMinute: 22 * 60,
	endMinute: 7 * 60,
};

export const availabilityProfiles = pgTable(
	"availability_profiles",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		workingHours: jsonb("working_hours")
			.$type<WorkingHoursConfig>()
			.notNull()
			.default(DEFAULT_WORKING_HOURS),
		quietHours: jsonb("quiet_hours")
			.$type<QuietHoursConfig>()
			.notNull()
			.default(DEFAULT_QUIET_HOURS),
		/** null/null = ruční snooze vypnutý; started + null until = bez omezení. */
		manualSnoozeStartedAt: timestamp("manual_snooze_started_at", { withTimezone: true }),
		manualSnoozeUntil: timestamp("manual_snooze_until", { withTimezone: true }),
		/** Optimistic CAS pro explicitní save/conflict UX. */
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("availability_profiles_workspace_user_uq").on(t.workspaceId, t.userId),
		index("availability_profiles_user_idx").on(t.userId),
		foreignKey({
			name: "availability_profiles_membership_fk",
			columns: [t.userId, t.workspaceId],
			foreignColumns: [memberships.userId, memberships.workspaceId],
		}).onDelete("cascade"),
		check(
			"availability_profiles_json_shape",
			sql`jsonb_typeof(${t.workingHours}) = 'object' and jsonb_typeof(${t.quietHours}) = 'object'`,
		),
		check("availability_profiles_version_positive", sql`${t.version} >= 1`),
		check(
			"availability_profiles_snooze_shape",
			sql`${t.manualSnoozeUntil} is null or ${t.manualSnoozeStartedAt} is not null`,
		),
	],
);

export const availabilityBlocks = pgTable(
	"availability_blocks",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		kind: varchar("kind", { length: 20 }).notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		/** IANA zóna použitá při vytvoření; instant se při změně profilu neposouvá. */
		timezone: varchar("timezone", { length: 64 }).notNull(),
		label: varchar("label", { length: 160 }),
		/** private = kolegové vidí typ a čas, ne uživatelův popisek. */
		visibility: varchar("visibility", { length: 12 }).notNull().default("team"),
		source: varchar("source", { length: 16 }).notNull().default("manual"),
		/** LuckyOS žádost je pending; až resolved projekce smí ovlivnit plánování a snooze. */
		approvalStatus: varchar("approval_status", { length: 16 }).notNull().default("approved"),
		externalId: varchar("external_id", { length: 240 }),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("availability_blocks_workspace_time_idx").on(t.workspaceId, t.startsAt, t.endsAt),
		index("availability_blocks_user_time_idx").on(t.userId, t.startsAt, t.endsAt),
		uniqueIndex("availability_blocks_external_uq")
			.on(t.workspaceId, t.userId, t.source, t.externalId)
			.where(sql`${t.externalId} is not null`),
		uniqueIndex("availability_blocks_id_workspace_user_uq").on(t.id, t.workspaceId, t.userId),
		foreignKey({
			name: "availability_blocks_membership_fk",
			columns: [t.userId, t.workspaceId],
			foreignColumns: [memberships.userId, memberships.workspaceId],
		}).onDelete("cascade"),
		check(
			"availability_blocks_kind_valid",
			sql`${t.kind} in ('focus', 'unavailable', 'absence', 'holiday')`,
		),
		check(
			"availability_blocks_visibility_valid",
			sql`${t.visibility} in ('team', 'private')`,
		),
		check(
			"availability_blocks_source_valid",
			sql`${t.source} in ('manual', 'calendar', 'luckyos')`,
		),
		check(
			"availability_blocks_approval_status_valid",
			sql`${t.approvalStatus} in ('pending', 'approved', 'rejected', 'cancelled')`,
		),
		check(
			"availability_blocks_pending_source_valid",
			sql`${t.approvalStatus} = 'approved' or ${t.source} = 'luckyos'`,
		),
		check("availability_blocks_time_valid", sql`${t.endsAt} > ${t.startsAt}`),
		check("availability_blocks_version_positive", sql`${t.version} >= 1`),
		check(
			"availability_blocks_timezone_format",
			sql`${t.timezone} ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'`,
		),
	],
);

/** Výslovná, auditovaná nouzová výjimka dovolující jeden úkol přes konkrétní Focus Time. */
export const availabilityTaskOverrides = pgTable(
	"availability_task_overrides",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		blockId: uuid("block_id")
			.notNull()
			.references(() => availabilityBlocks.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		assigneeId: uuid("assignee_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
		reason: varchar("reason", { length: 500 }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("availability_task_overrides_scope_uq").on(t.blockId, t.taskId, t.assigneeId),
		index("availability_task_overrides_task_idx").on(t.taskId),
		index("availability_task_overrides_workspace_idx").on(t.workspaceId),
		foreignKey({
			name: "availability_task_overrides_block_scope_fk",
			columns: [t.blockId, t.workspaceId, t.assigneeId],
			foreignColumns: [availabilityBlocks.id, availabilityBlocks.workspaceId, availabilityBlocks.userId],
		}).onDelete("cascade"),
		check("availability_task_overrides_reason_length", sql`char_length(${t.reason}) between 8 and 500`),
	],
);

export type AvailabilityProfile = typeof availabilityProfiles.$inferSelect;
export type AvailabilityBlock = typeof availabilityBlocks.$inferSelect;
export type AvailabilityTaskOverride = typeof availabilityTaskOverrides.$inferSelect;
