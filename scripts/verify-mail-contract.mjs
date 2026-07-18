import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, vault, contentVault, powersync, mailAccounts, mailSync, mailExecution, mailOutbound, mailAdvanced, personalTools, exportRoutes, personalWorkspace, personalComposer, mailScreen, demoBanner, env, preflight, foundationMigration, oauthMigration, syncMigration, generationMigration, executionMigration, outboundMigration, advancedMigration, advancedGuards] =
  await Promise.all([
    read("packages/db/src/schema/mail.ts"),
    read("apps/api/src/mailVault.ts"),
    read("apps/api/src/mailContentVault.ts"),
    read("apps/api/src/powersync.ts"),
    read("apps/api/src/mailAccounts.ts"),
    read("apps/api/src/mailSync.ts"),
    read("apps/api/src/mailExecution.ts"),
    read("apps/api/src/mailOutbound.ts"),
    read("apps/api/src/mailAdvanced.ts"),
    read("apps/web/src/mail/usePersonalMailTools.ts"),
    read("apps/api/src/export.ts"),
    read("apps/web/src/mail/PersonalMailWorkspace.tsx"),
    read("apps/web/src/mail/PersonalMailComposer.tsx"),
    read("apps/web/src/mail/MailScreen.tsx"),
    read("apps/web/src/mail/DemoBanner.tsx"),
    read("apps/api/src/env.ts"),
    read("scripts/verify-production-config.mjs"),
    read("packages/db/drizzle/0068_overjoyed_obadiah_stane.sql"),
    read("packages/db/drizzle/0069_bouncy_betty_brant.sql"),
    read("packages/db/drizzle/0070_mysterious_jackpot.sql"),
    read("packages/db/drizzle/0071_cute_beyonder.sql"),
    read("packages/db/drizzle/0072_smart_cammi.sql"),
    read("packages/db/drizzle/0073_bored_fat_cobra.sql"),
    read("packages/db/drizzle/0084_bitter_phil_sheldon.sql"),
    read("packages/db/drizzle/0085_mail_advanced_guards.sql"),
  ]);

assert.match(schema, /mailAccounts = pgTable/);
assert.match(schema, /mailAccountCredentials = pgTable/);
assert.match(schema, /mailSyncStates = pgTable/);
assert.match(schema, /mailMessages = pgTable/);
assert.match(schema, /mailTaskLinks = pgTable/);
assert.match(schema, /mailOutboundMessages = pgTable/);
assert.match(schema, /mailSavedViews = pgTable/);
assert.match(schema, /mailProviderLabels = pgTable/);
assert.match(schema, /mailFollowups = pgTable/);
assert.doesNotMatch(schema, /accessToken|refreshToken|password/i);
assert.match(vault, /aes-256-gcm/);
assert.match(vault, /setAAD\(aad\(context\)\)/);
assert.match(vault, /randomBytes\(12\)/);
assert.match(vault, /mail_vault_not_configured/);
assert.match(contentVault, /createHmac\("sha256"/);
assert.match(contentVault, /watson-mail-content-v1/);
assert.match(contentVault, /createCipheriv\(CIPHER, key, nonce\)/);
assert.doesNotMatch(powersync, /mail_account_credentials/);
assert.doesNotMatch(powersync, /mail_accounts/);
assert.doesNotMatch(powersync, /mail_messages/);
assert.doesNotMatch(powersync, /mail_sync_states/);
assert.doesNotMatch(powersync, /mail_task_links/);
assert.doesNotMatch(powersync, /mail_outbound_messages/);
assert.doesNotMatch(powersync, /mail_saved_views/);
assert.doesNotMatch(powersync, /mail_provider_labels/);
assert.doesNotMatch(powersync, /mail_followups/);
assert.match(mailAccounts, /https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
assert.match(mailAccounts, /code_challenge_method:\s*"S256"/);
assert.match(mailAccounts, /stateHash:\s*sha256\(state\)/);
assert.match(mailAccounts, /eq\(mailOauthSessions\.ownerUserId, session\.user\.id\)/);
assert.match(mailAccounts, /delete\(mailOauthSessions\)/);
assert.doesNotMatch(mailAccounts, /https:\/\/mail\.google\.com\//);
assert.match(mailAccounts, /delete\(mailMessages\)/);
assert.match(mailAccounts, /delete\(mailSyncStates\)/);
assert.match(mailSync, /users\/me\/history/);
assert.match(mailSync, /mail_history_expired/);
assert.match(mailSync, /fullSyncGeneration/);
assert.match(mailSync, /ownerAccount\(accountId\.data, session\.user\.id\)/);
assert.match(mailSync, /hasHtml: content\.htmlBody\.length > 0/);
assert.doesNotMatch(mailSync, /htmlBody: content\.htmlBody/);
assert.match(mailExecution, /eq\(mailAccounts\.ownerUserId, session\.user\.id\)/);
assert.match(mailExecution, /mail_execution_personal_project_required/);
assert.match(mailExecution, /insert\(tasks\)/);
assert.match(mailExecution, /insert\(assignments\)/);
assert.match(mailExecution, /insert\(mailTaskLinks\)/);
assert.match(mailExecution, /action: active \? "replace_from_mail" : "create_from_mail"/);
assert.match(mailOutbound, /encryptMailContent/);
assert.match(mailOutbound, /authenticatedGoogleMailFetch/);
assert.match(mailOutbound, /users\/me\/messages\/send/);
assert.match(mailOutbound, /status: "uncertain"/);
assert.match(mailOutbound, /mail_delivery_uncertain/);
assert.match(mailOutbound, /outbound\.status = 'queued'/);
assert.match(mailOutbound, /FOR UPDATE OF outbound SKIP LOCKED/);
assert.match(mailOutbound, /Message-ID: <watson-/);
assert.match(mailAdvanced, /MAX_SEARCH_CORPUS = 5_000/);
assert.match(mailAdvanced, /decryptMailContent/);
assert.match(mailAdvanced, /parseMailSearch/);
assert.match(mailAdvanced, /mail_view_name_exists/);
assert.match(mailAdvanced, /reconcileFollowups/);
assert.match(mailAdvanced, /Agregace schránky, nikoli skóre produktivity zaměstnance/);
assert.match(personalTools, /\/api\/mail\/search/);
assert.match(personalTools, /scheduleFollowup/);
assert.match(exportRoutes, /WHEN t\.mail_th LIKE 'personal:%'/);
assert.match(exportRoutes, /restored tasks do not retain mail deep links/);
assert.match(personalWorkspace, /Execution Inbox/);
assert.match(personalWorkspace, /model\.createExecutionTask/);
assert.match(personalWorkspace, /model\.cancelOutbound/);
assert.match(personalComposer, /model\.enqueueOutbound/);
assert.match(personalComposer, /Nezapomněl\/a jsi přílohu/);
assert.match(personalComposer, /Po kliknutí máš 10 sekund na vrácení odeslání/);
assert.match(mailScreen, /<MailDemoBanner/);
assert.match(demoBanner, /data-mail-demo-banner/);
assert.match(env, /MAIL_VAULT_KEYS_JSON/);
assert.match(env, /MAIL_GOOGLE_CLIENT_ID/);
assert.match(env, /MAIL_GOOGLE_CLIENT_SECRET/);
assert.match(env, /MAIL_GOOGLE_REDIRECT_URI/);
assert.match(preflight, /mail_vault_keyring/);
assert.match(foundationMigration, /mail_accounts_owner_scope_guard/);
assert.match(foundationMigration, /mail_account_credentials_provider_guard/);
assert.match(oauthMigration, /mail_oauth_sessions_owner_scope_guard/);
assert.match(oauthMigration, /mail_command_receipts_actor_guard/);
assert.match(oauthMigration, /mail_oauth_sessions_state_hash_valid/);
assert.match(syncMigration, /mail_sync_states_lease_consistent/);
assert.match(syncMigration, /mail_sync_states_partial_cursor/);
assert.match(syncMigration, /mail_messages_account_id_mail_accounts_id_fk/);
assert.match(generationMigration, /last_seen_sync_generation/);
assert.match(generationMigration, /full_sync_generation/);
assert.match(executionMigration, /mail_task_links_scope_guard/);
assert.match(executionMigration, /mail_task_link_account_scope_mismatch/);
assert.match(executionMigration, /mail_task_link_message_scope_mismatch/);
assert.match(executionMigration, /mail_task_link_task_scope_mismatch/);
assert.match(outboundMigration, /mail_outbound_messages/);
assert.match(outboundMigration, /mail_outbound_account_scope_mismatch/);
assert.match(outboundMigration, /mail_outbound_transition_invalid/);
assert.match(outboundMigration, /mail_outbound_source_immutable/);
assert.match(advancedMigration, /mail_saved_views/);
assert.match(advancedMigration, /mail_provider_labels/);
assert.match(advancedMigration, /mail_followups/);
assert.match(advancedGuards, /mail_saved_view_owner_mismatch/);
assert.match(advancedGuards, /mail_followup_owner_mismatch/);

console.log("Mail M1/M2+ static contract: OAuth, encrypted sync/send/search, provider labels, views, follow-up, analytics, DB guards, and honest UI verified.");
