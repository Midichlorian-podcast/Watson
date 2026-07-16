/**
 * Interní rezervace schůzek. Nabídka a její sloty jsou samostatný povrch nad
 * kalendářem; teprve potvrzená rezervace atomicky materializuje běžný meeting hub.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { meetings } from "./meetings";
import { tasks } from "./task";
import { projectMembers, projects, workspaces } from "./workspace";

export const bookingPages = pgTable(
	"booking_pages",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: varchar("title", { length: 200 }).notNull(),
		description: text("description"),
		durationMin: integer("duration_min").notNull(),
		timezone: varchar("timezone", { length: 64 }).notNull(),
		organizerId: uuid("organizer_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("booking_pages_id_project_uq").on(t.id, t.projectId),
		uniqueIndex("booking_pages_id_workspace_uq").on(t.id, t.workspaceId),
		index("booking_pages_workspace_idx").on(t.workspaceId, t.archivedAt, t.createdAt),
		foreignKey({
			name: "booking_pages_project_workspace_fk",
			columns: [t.projectId, t.workspaceId],
			foreignColumns: [projects.id, projects.workspaceId],
		}).onDelete("cascade"),
		check("booking_pages_title_valid", sql`char_length(trim(${t.title})) between 1 and 200`),
		check(
			"booking_pages_description_valid",
			sql`${t.description} is null or char_length(${t.description}) <= 2000`,
		),
		check("booking_pages_duration_valid", sql`${t.durationMin} between 5 and 1440`),
		check(
			"booking_pages_timezone_shape",
			sql`${t.timezone} ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'`,
		),
		check("booking_pages_version_valid", sql`${t.version} > 0`),
	],
);

/** Pevní účastníci každé rezervace; rezervující zaměstnanec se přidá navíc. */
export const bookingPageParticipants = pgTable(
	"booking_page_participants",
	{
		id: pk(),
		pageId: uuid("page_id").notNull(),
		projectId: uuid("project_id").notNull(),
		userId: uuid("user_id").notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("booking_page_participants_page_user_uq").on(t.pageId, t.userId),
		index("booking_page_participants_user_idx").on(t.userId, t.pageId),
		foreignKey({
			name: "booking_page_participants_page_project_fk",
			columns: [t.pageId, t.projectId],
			foreignColumns: [bookingPages.id, bookingPages.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "booking_page_participants_project_member_fk",
			columns: [t.projectId, t.userId],
			foreignColumns: [projectMembers.projectId, projectMembers.userId],
		}).onDelete("cascade"),
	],
);

export const bookingSlots = pgTable(
	"booking_slots",
	{
		id: pk(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => bookingPages.id, { onDelete: "cascade" }),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("booking_slots_id_page_uq").on(t.id, t.pageId),
		uniqueIndex("booking_slots_page_start_uq")
			.on(t.pageId, t.startsAt)
			.where(sql`${t.cancelledAt} is null`),
		index("booking_slots_page_time_idx").on(t.pageId, t.startsAt),
		check("booking_slots_time_valid", sql`${t.endsAt} > ${t.startsAt}`),
		check("booking_slots_version_valid", sql`${t.version} > 0`),
	],
);

/**
 * Historická stopa rezervace zůstává i po zrušení. Meeting a hub jsou nullable,
 * aby generický auditovaný delete úkolu nevytvořil dangling FK.
 */
export const bookingReservations = pgTable(
	"booking_reservations",
	{
		id: pk(),
		pageId: uuid("page_id").notNull(),
		slotId: uuid("slot_id").notNull(),
		projectId: uuid("project_id").notNull(),
		bookedBy: uuid("booked_by").references(() => users.id, { onDelete: "set null" }),
		meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "set null" }),
		hubTaskId: uuid("hub_task_id").references(() => tasks.id, { onDelete: "set null" }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		foreignKey({
			name: "booking_reservations_page_project_fk",
			columns: [t.pageId, t.projectId],
			foreignColumns: [bookingPages.id, bookingPages.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "booking_reservations_slot_page_fk",
			columns: [t.slotId, t.pageId],
			foreignColumns: [bookingSlots.id, bookingSlots.pageId],
		}).onDelete("cascade"),
		uniqueIndex("booking_reservations_active_slot_uq")
			.on(t.slotId)
			.where(sql`${t.cancelledAt} is null`),
		uniqueIndex("booking_reservations_meeting_uq").on(t.meetingId),
		uniqueIndex("booking_reservations_hub_uq").on(t.hubTaskId),
		index("booking_reservations_booker_idx").on(t.bookedBy, t.cancelledAt, t.createdAt),
		check("booking_reservations_version_valid", sql`${t.version} > 0`),
		check(
			"booking_reservations_meeting_pair_valid",
			sql`(${t.meetingId} is null) = (${t.hubTaskId} is null)`,
		),
	],
);

export type BookingPage = typeof bookingPages.$inferSelect;
export type BookingSlot = typeof bookingSlots.$inferSelect;
export type BookingReservation = typeof bookingReservations.$inferSelect;
