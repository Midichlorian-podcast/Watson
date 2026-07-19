/**
 * F8c — server-only public API credentials and transactional webhook outbox.
 *
 * None of these tables is synchronized to clients or included in user backups:
 * API credentials, delivery metadata and retry state remain an operational concern.
 */
import { sql } from "drizzle-orm";
import {
	boolean,
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

export const apiClients = pgTable(
	"api_clients",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 120 }).notNull(),
		/** Non-secret lookup prefix; the full bearer token is returned only once. */
		keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
		/** SHA-256 of a high-entropy bearer token. Plaintext is never persisted. */
		keyHash: varchar("key_hash", { length: 64 }).notNull(),
		scopes: varchar("scopes", { length: 32 }).array().notNull(),
		/** An API client can never silently expand to every future project. */
		projectIds: uuid("project_ids").array().notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("api_clients_name_nonempty", sql`char_length(btrim(${t.name})) > 0`),
		check("api_clients_key_prefix_format", sql`${t.keyPrefix} ~ '^[A-Za-z0-9_-]{8,16}$'`),
		check("api_clients_key_hash_format", sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
		check("api_clients_scopes_nonempty", sql`cardinality(${t.scopes}) between 1 and 3`),
		check("api_clients_projects_nonempty", sql`cardinality(${t.projectIds}) between 1 and 100`),
		check(
			"api_clients_scopes_valid",
			sql`${t.scopes} <@ ARRAY['projects:read','tasks:read','tasks:write']::varchar[]`,
		),
		check("api_clients_expiry_future", sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`),
		uniqueIndex("api_clients_key_prefix_uq").on(t.keyPrefix),
		uniqueIndex("api_clients_key_hash_uq").on(t.keyHash),
		index("api_clients_workspace_idx").on(t.workspaceId, t.revokedAt),
	],
);

export const apiCommandReceipts = pgTable(
	"api_command_receipts",
	{
		id: pk(),
		clientId: uuid("client_id")
			.notNull()
			.references(() => apiClients.id, { onDelete: "cascade" }),
		idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		statusCode: integer("status_code").notNull(),
		response: jsonb("response").$type<Record<string, unknown>>().notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		check("api_command_receipts_hash_format", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
		check("api_command_receipts_status_valid", sql`${t.statusCode} between 200 and 299`),
		uniqueIndex("api_command_receipts_client_key_uq").on(t.clientId, t.idempotencyKey),
		index("api_command_receipts_created_idx").on(t.createdAt),
	],
);

export const webhookSubscriptions = pgTable(
	"webhook_subscriptions",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 120 }).notNull(),
		endpointUrl: varchar("endpoint_url", { length: 2048 }).notNull(),
		eventTypes: varchar("event_types", { length: 48 }).array().notNull(),
		projectIds: uuid("project_ids").array().notNull(),
		active: boolean("active").notNull().default(true),
		version: integer("version").notNull().default(1),
		failureCount: integer("failure_count").notNull().default(0),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("webhook_subscriptions_name_nonempty", sql`char_length(btrim(${t.name})) > 0`),
		check("webhook_subscriptions_events_nonempty", sql`cardinality(${t.eventTypes}) between 1 and 7`),
		check("webhook_subscriptions_projects_nonempty", sql`cardinality(${t.projectIds}) between 1 and 100`),
		check(
			"webhook_subscriptions_events_valid",
			sql`${t.eventTypes} <@ ARRAY['task.created','task.updated','task.completed','task.deleted','project.created','project.updated','project.deleted']::varchar[]`,
		),
		check("webhook_subscriptions_version_positive", sql`${t.version} > 0`),
		check("webhook_subscriptions_failure_count_valid", sql`${t.failureCount} >= 0`),
		index("webhook_subscriptions_workspace_idx").on(t.workspaceId, t.active),
	],
);

export const webhookEvents = pgTable(
	"webhook_events",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		eventType: varchar("event_type", { length: 48 }).notNull(),
		entityType: varchar("entity_type", { length: 24 }).notNull(),
		entityId: uuid("entity_id").notNull(),
		/** Deliberately not an FK: delete events must survive deletion of the project. */
		projectId: uuid("project_id").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
		fanoutAt: timestamp("fanout_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		check("webhook_events_entity_valid", sql`${t.entityType} in ('task','project')`),
		check(
			"webhook_events_type_valid",
			sql`${t.eventType} in ('task.created','task.updated','task.completed','task.deleted','project.created','project.updated','project.deleted')`,
		),
		check("webhook_events_payload_object", sql`jsonb_typeof(${t.payload}) = 'object'`),
		index("webhook_events_fanout_idx").on(t.fanoutAt, t.occurredAt),
		index("webhook_events_workspace_idx").on(t.workspaceId, t.occurredAt),
	],
);

export const webhookDeliveries = pgTable(
	"webhook_deliveries",
	{
		id: pk(),
		subscriptionId: uuid("subscription_id")
			.notNull()
			.references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
		eventId: uuid("event_id")
			.notNull()
			.references(() => webhookEvents.id, { onDelete: "cascade" }),
		status: varchar("status", { length: 16 }).notNull().default("pending"),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
		leaseUntil: timestamp("lease_until", { withTimezone: true }),
		responseStatus: integer("response_status"),
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("webhook_deliveries_status_valid", sql`${t.status} in ('pending','delivered','dead')`),
		check("webhook_deliveries_attempts_valid", sql`${t.attemptCount} between 0 and 8`),
		check(
			"webhook_deliveries_response_status_valid",
			sql`${t.responseStatus} is null or ${t.responseStatus} between 100 and 599`,
		),
		uniqueIndex("webhook_deliveries_subscription_event_uq").on(t.subscriptionId, t.eventId),
		index("webhook_deliveries_pending_idx").on(t.status, t.nextAttemptAt),
	],
);

export type ApiClient = typeof apiClients.$inferSelect;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
