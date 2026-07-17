/**
 * Server-only Watson ↔ LuckyOS v1 integration state.
 *
 * Neither table is synchronized to PowerSync. `providerPersonId` is an opaque
 * routing identifier used only when Watson calls the person-scoped LuckyOS API;
 * it is never an authority supplied by the browser.
 */
import { sql } from "drizzle-orm";
import {
	check,
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
import { workspaces } from "./workspace";

/** Latest provider identity binding projected from signed LuckyOS events. */
export const luckyOsIdentityBindings = pgTable(
	"luckyos_identity_bindings",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: uuid("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		organizationId: varchar("organization_id", { length: 255 }).notNull(),
		providerLinkId: varchar("provider_link_id", { length: 255 }).notNull(),
		providerPersonId: varchar("provider_person_id", { length: 255 }).notNull(),
		status: varchar("status", { length: 24 }).notNull(),
		providerVersion: integer("provider_version").notNull(),
		lastEventId: uuid("last_event_id").notNull(),
		lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
		reasonCode: varchar("reason_code", { length: 64 }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check(
			"luckyos_identity_bindings_status_valid",
			sql`${t.status} in ('pending', 'active', 'suspended', 'revoked')`,
		),
		check("luckyos_identity_bindings_version_positive", sql`${t.providerVersion} > 0`),
		uniqueIndex("luckyos_identity_bindings_owner_uq").on(t.ownerUserId),
		uniqueIndex("luckyos_identity_bindings_provider_link_uq").on(
			t.organizationId,
			t.providerLinkId,
		),
		uniqueIndex("luckyos_identity_bindings_provider_person_uq").on(
			t.organizationId,
			t.providerPersonId,
		),
		index("luckyos_identity_bindings_workspace_idx").on(t.workspaceId, t.status),
	],
);

/**
 * Durable signed-event inbox and idempotency receipt. Safe provider payloads
 * remain server-only so later F7 workers can consume them without asking
 * LuckyOS to redeliver. DB size checks cap accidental retention of large PII.
 */
export const luckyOsEventInbox = pgTable(
	"luckyos_event_inbox",
	{
		eventId: uuid("event_id").primaryKey(),
		idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
		payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
		organizationId: varchar("organization_id", { length: 255 }).notNull(),
		eventType: varchar("event_type", { length: 160 }).notNull(),
		aggregateType: varchar("aggregate_type", { length: 160 }).notNull(),
		aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
		aggregateVersion: integer("aggregate_version").notNull(),
		providerPersonId: varchar("provider_person_id", { length: 255 }),
		ownerUserId: uuid("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		correlationId: varchar("correlation_id", { length: 128 }).notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		status: varchar("status", { length: 24 }).notNull().default("pending"),
		disposition: varchar("disposition", { length: 64 }).notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		receivedAt: createdAt(),
	},
	(t) => [
		check("luckyos_event_inbox_version_positive", sql`${t.aggregateVersion} > 0`),
		check(
			"luckyos_event_inbox_status_valid",
			sql`${t.status} in ('pending', 'processed', 'ignored', 'failed')`,
		),
		check("luckyos_event_inbox_payload_bounded", sql`octet_length(${t.payload}::text) <= 65536`),
		uniqueIndex("luckyos_event_inbox_idempotency_uq").on(t.idempotencyKey),
		index("luckyos_event_inbox_pending_idx")
			.on(t.receivedAt)
			.where(sql`${t.status} = 'pending'`),
		index("luckyos_event_inbox_owner_idx").on(t.ownerUserId, t.receivedAt),
	],
);

export type LuckyOsIdentityBinding = typeof luckyOsIdentityBindings.$inferSelect;
export type LuckyOsEventInboxEntry = typeof luckyOsEventInbox.$inferSelect;
