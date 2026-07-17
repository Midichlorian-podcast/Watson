/**
 * F5 Mail M1 — autoritativní metadata osobních schránek a oddělený credential vault.
 *
 * Mailbox secrets se nikdy nesynchronizují do PowerSyncu ani nevracejí klientovi.
 * `mail_account_credentials` obsahuje pouze AES-256-GCM envelope; význam AAD a
 * rotaci klíčů drží serverový `mailVault.ts`.
 */
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { workspaces } from "./workspace";

/**
 * M1 je záměrně osobní: účet vlastní právě jeden uživatel. Sdílené schránky a
 * delegovaná ACL přijdou až v M3, aby první provider sync nemohl omylem rozšířit
 * viditelnost soukromé pošty na celý workspace.
 */
export const mailAccounts = pgTable(
	"mail_accounts",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: uuid("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: varchar("provider", { length: 24 }).notNull(),
		emailAddress: varchar("email_address", { length: 320 }).notNull(),
		displayName: varchar("display_name", { length: 160 }),
		/** SHA-256 provider identity; raw Google `sub` ani přihlašovací jméno sem nepatří. */
		providerAccountHash: varchar("provider_account_hash", { length: 64 }).notNull(),
		status: varchar("status", { length: 24 }).notNull().default("connected"),
		/** Skutečně udělené provider scopes, ne požadované přání klienta. */
		grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
		capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
		lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
		lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
		/** Jen Watson allowlist; upstream error text ani adresy se neukládají. */
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("mail_accounts_provider_valid", sql`${t.provider} in ('google', 'imap_smtp')`),
		check(
			"mail_accounts_status_valid",
			sql`${t.status} in ('connected', 'syncing', 'degraded', 'reauth_required', 'revoked')`,
		),
		check(
			"mail_accounts_revoke_consistent",
			sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`,
		),
		check(
			"mail_accounts_provider_hash_valid",
			sql`${t.providerAccountHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"mail_accounts_error_code_valid",
			sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} in ('mail_auth_revoked', 'mail_token_expired', 'mail_provider_unavailable', 'mail_sync_cursor_invalid', 'mail_credentials_invalid', 'mail_scope_missing', 'mail_contract_rejected', 'mail_rate_limited')`,
		),
		check("mail_accounts_scopes_array", sql`jsonb_typeof(${t.grantedScopes}) = 'array'`),
		check(
			"mail_accounts_capabilities_array",
			sql`jsonb_typeof(${t.capabilities}) = 'array'`,
		),
		check("mail_accounts_version_positive", sql`${t.version} > 0`),
		uniqueIndex("mail_accounts_owner_provider_identity_uq").on(
			t.ownerUserId,
			t.provider,
			t.providerAccountHash,
		),
		uniqueIndex("mail_accounts_owner_address_uq").on(
			t.ownerUserId,
			t.provider,
			sql`lower(${t.emailAddress})`,
		),
		index("mail_accounts_workspace_owner_idx").on(t.workspaceId, t.ownerUserId),
	],
);

/**
 * Jeden rotovatelný credential envelope na účet. Při revoke se řádek fyzicky
 * smaže; metadata účtu a audit zůstanou jako bezpečná historická stopa.
 */
export const mailAccountCredentials = pgTable(
	"mail_account_credentials",
	{
		accountId: uuid("account_id")
			.primaryKey()
			.references(() => mailAccounts.id, { onDelete: "cascade" }),
		secretKind: varchar("secret_kind", { length: 24 }).notNull(),
		algorithm: varchar("algorithm", { length: 24 }).notNull().default("aes-256-gcm-v1"),
		keyId: varchar("key_id", { length: 64 }).notNull(),
		/** Base64url hodnoty; samy o sobě neobsahují žádný plaintext provider údaj. */
		nonce: varchar("nonce", { length: 24 }).notNull(),
		authTag: varchar("auth_tag", { length: 32 }).notNull(),
		ciphertext: text("ciphertext").notNull(),
		credentialVersion: integer("credential_version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check(
			"mail_account_credentials_kind_valid",
			sql`${t.secretKind} in ('google_oauth', 'imap_smtp')`,
		),
		check(
			"mail_account_credentials_algorithm_valid",
			sql`${t.algorithm} = 'aes-256-gcm-v1'`,
		),
		check("mail_account_credentials_key_id_valid", sql`length(${t.keyId}) between 1 and 64`),
		check("mail_account_credentials_nonce_valid", sql`length(${t.nonce}) between 16 and 24`),
		check("mail_account_credentials_tag_valid", sql`length(${t.authTag}) between 22 and 32`),
		check("mail_account_credentials_ciphertext_valid", sql`length(${t.ciphertext}) > 0`),
		check(
			"mail_account_credentials_version_positive",
			sql`${t.credentialVersion} > 0`,
		),
	],
);

/**
 * Krátkodobý serverový OAuth handshake. State se ukládá jen jako SHA-256 hash a
 * PKCE verifier jen jako vault envelope. Řádky nejsou klientsky synchronizované.
 */
export const mailOauthSessions = pgTable(
	"mail_oauth_sessions",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: uuid("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: varchar("provider", { length: 24 }).notNull().default("google"),
		stateHash: varchar("state_hash", { length: 64 }).notNull(),
		algorithm: varchar("algorithm", { length: 24 }).notNull().default("aes-256-gcm-v1"),
		keyId: varchar("key_id", { length: 64 }).notNull(),
		nonce: varchar("nonce", { length: 24 }).notNull(),
		authTag: varchar("auth_tag", { length: 32 }).notNull(),
		ciphertext: text("ciphertext").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		check("mail_oauth_sessions_provider_valid", sql`${t.provider} = 'google'`),
		check("mail_oauth_sessions_state_hash_valid", sql`${t.stateHash} ~ '^[0-9a-f]{64}$'`),
		check("mail_oauth_sessions_algorithm_valid", sql`${t.algorithm} = 'aes-256-gcm-v1'`),
		check("mail_oauth_sessions_key_id_valid", sql`length(${t.keyId}) between 1 and 64`),
		check("mail_oauth_sessions_nonce_valid", sql`length(${t.nonce}) between 16 and 24`),
		check("mail_oauth_sessions_tag_valid", sql`length(${t.authTag}) between 22 and 32`),
		check("mail_oauth_sessions_ciphertext_valid", sql`length(${t.ciphertext}) > 0`),
		check("mail_oauth_sessions_expiry_valid", sql`${t.expiresAt} > ${t.createdAt}`),
		uniqueIndex("mail_oauth_sessions_state_hash_uq").on(t.stateHash),
		index("mail_oauth_sessions_owner_created_idx").on(t.ownerUserId, t.createdAt),
		index("mail_oauth_sessions_expiry_idx").on(t.expiresAt),
	],
);

/** Idempotentní mailbox lifecycle commandy. Response je vždy redigovaný public snapshot. */
export const mailCommandReceipts = pgTable(
	"mail_command_receipts",
	{
		id: pk(),
		accountId: uuid("account_id")
			.notNull()
			.references(() => mailAccounts.id, { onDelete: "cascade" }),
		actorUserId: uuid("actor_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		operationId: varchar("operation_id", { length: 128 }).notNull(),
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		action: varchar("action", { length: 24 }).notNull(),
		response: jsonb("response").$type<Record<string, unknown>>().notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		check("mail_command_receipts_action_valid", sql`${t.action} in ('revoke')`),
		check(
			"mail_command_receipts_request_hash_valid",
			sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`,
		),
		check("mail_command_receipts_response_object", sql`jsonb_typeof(${t.response}) = 'object'`),
		uniqueIndex("mail_command_receipts_actor_operation_uq").on(t.actorUserId, t.operationId),
		index("mail_command_receipts_account_idx").on(t.accountId, t.createdAt),
	],
);

/**
 * Autoritativní mailbox sync cursor a krátký distributed lease. Jeden účet má
 * nejvýše jeden běh; expirovaný lease převezme jiná API replika. Page token je
 * pouze neprůhledný provider cursor, nikdy OAuth credential.
 */
export const mailSyncStates = pgTable(
	"mail_sync_states",
	{
		accountId: uuid("account_id")
			.primaryKey()
			.references(() => mailAccounts.id, { onDelete: "cascade" }),
		status: varchar("status", { length: 24 }).notNull().default("pending"),
		syncMode: varchar("sync_mode", { length: 16 }).notNull().default("full"),
		historyId: varchar("history_id", { length: 64 }),
		baselineHistoryId: varchar("baseline_history_id", { length: 64 }),
		pageToken: varchar("page_token", { length: 2048 }),
		fullSyncGeneration: uuid("full_sync_generation").notNull().defaultRandom(),
		requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
		leaseToken: uuid("lease_token"),
		leaseUntil: timestamp("lease_until", { withTimezone: true }),
		attempts: integer("attempts").notNull().default(0),
		lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check(
			"mail_sync_states_status_valid",
			sql`${t.status} in ('pending', 'running', 'idle', 'retry', 'dead', 'reauth_required')`,
		),
		check("mail_sync_states_mode_valid", sql`${t.syncMode} in ('full', 'partial')`),
		check(
			"mail_sync_states_lease_consistent",
			sql`(${t.status} = 'running') = (${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL)`,
		),
		check(
			"mail_sync_states_history_valid",
			sql`${t.historyId} IS NULL OR ${t.historyId} ~ '^[0-9]{1,64}$'`,
		),
		check(
			"mail_sync_states_baseline_valid",
			sql`${t.baselineHistoryId} IS NULL OR ${t.baselineHistoryId} ~ '^[0-9]{1,64}$'`,
		),
		check(
			"mail_sync_states_partial_cursor",
			sql`${t.syncMode} <> 'partial' OR ${t.historyId} IS NOT NULL`,
		),
		check("mail_sync_states_attempts_nonnegative", sql`${t.attempts} >= 0`),
		check(
			"mail_sync_states_error_valid",
			sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} in ('mail_provider_timeout', 'mail_provider_unavailable', 'mail_rate_limited', 'mail_auth_rejected', 'mail_contract_rejected', 'mail_history_expired')`,
		),
		check("mail_sync_states_version_positive", sql`${t.version} > 0`),
		index("mail_sync_states_claim_idx").on(t.status, t.nextAttemptAt, t.requestedAt),
		index("mail_sync_states_lease_idx").on(t.leaseUntil),
	],
);

/**
 * Provider index + autentizovaně šifrovaný obsah zprávy. Předmět, adresy,
 * snippet i MIME těla jsou uvnitř ciphertextu; otevřené zůstávají jen opaque
 * Gmail ID, datum/velikost a labely potřebné pro bezpečný incremental sync.
 */
export const mailMessages = pgTable(
	"mail_messages",
	{
		id: pk(),
		accountId: uuid("account_id")
			.notNull()
			.references(() => mailAccounts.id, { onDelete: "cascade" }),
		providerMessageId: varchar("provider_message_id", { length: 128 }).notNull(),
		providerThreadId: varchar("provider_thread_id", { length: 128 }).notNull(),
		historyId: varchar("history_id", { length: 64 }).notNull(),
		internalDate: timestamp("internal_date", { withTimezone: true }).notNull(),
		labelIds: jsonb("label_ids").$type<string[]>().notNull().default([]),
		sizeEstimate: integer("size_estimate").notNull().default(0),
		algorithm: varchar("algorithm", { length: 24 }).notNull().default("aes-256-gcm-v1"),
		keyId: varchar("key_id", { length: 64 }).notNull(),
		nonce: varchar("nonce", { length: 24 }).notNull(),
		authTag: varchar("auth_tag", { length: 32 }).notNull(),
		ciphertext: text("ciphertext").notNull(),
		contentVersion: integer("content_version").notNull().default(1),
		contentTruncated: boolean("content_truncated").notNull().default(false),
		lastSeenSyncGeneration: uuid("last_seen_sync_generation").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check(
			"mail_messages_provider_message_id_valid",
			sql`${t.providerMessageId} ~ '^[A-Za-z0-9_-]{1,128}$'`,
		),
		check(
			"mail_messages_provider_thread_id_valid",
			sql`${t.providerThreadId} ~ '^[A-Za-z0-9_-]{1,128}$'`,
		),
		check("mail_messages_history_valid", sql`${t.historyId} ~ '^[0-9]{1,64}$'`),
		check("mail_messages_labels_array", sql`jsonb_typeof(${t.labelIds}) = 'array'`),
		check("mail_messages_size_nonnegative", sql`${t.sizeEstimate} >= 0`),
		check("mail_messages_algorithm_valid", sql`${t.algorithm} = 'aes-256-gcm-v1'`),
		check("mail_messages_key_id_valid", sql`length(${t.keyId}) between 1 and 64`),
		check("mail_messages_nonce_valid", sql`length(${t.nonce}) between 16 and 24`),
		check("mail_messages_tag_valid", sql`length(${t.authTag}) between 22 and 32`),
		check("mail_messages_ciphertext_valid", sql`length(${t.ciphertext}) > 0`),
		check("mail_messages_content_version_positive", sql`${t.contentVersion} > 0`),
		uniqueIndex("mail_messages_account_provider_uq").on(t.accountId, t.providerMessageId),
		index("mail_messages_account_date_idx").on(t.accountId, t.internalDate),
		index("mail_messages_account_thread_idx").on(t.accountId, t.providerThreadId),
	],
);
