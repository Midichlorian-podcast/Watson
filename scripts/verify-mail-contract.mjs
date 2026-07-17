import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, vault, powersync, mailAccounts, mailScreen, demoBanner, env, preflight, foundationMigration, oauthMigration] =
  await Promise.all([
    read("packages/db/src/schema/mail.ts"),
    read("apps/api/src/mailVault.ts"),
    read("apps/api/src/powersync.ts"),
    read("apps/api/src/mailAccounts.ts"),
    read("apps/web/src/mail/MailScreen.tsx"),
    read("apps/web/src/mail/DemoBanner.tsx"),
    read("apps/api/src/env.ts"),
    read("scripts/verify-production-config.mjs"),
    read("packages/db/drizzle/0068_overjoyed_obadiah_stane.sql"),
    read("packages/db/drizzle/0069_bouncy_betty_brant.sql"),
  ]);

assert.match(schema, /mailAccounts = pgTable/);
assert.match(schema, /mailAccountCredentials = pgTable/);
assert.doesNotMatch(schema, /accessToken|refreshToken|password/i);
assert.match(vault, /aes-256-gcm/);
assert.match(vault, /setAAD\(aad\(context\)\)/);
assert.match(vault, /randomBytes\(12\)/);
assert.match(vault, /mail_vault_not_configured/);
assert.doesNotMatch(powersync, /mail_account_credentials/);
assert.doesNotMatch(powersync, /mail_accounts/);
assert.match(mailAccounts, /https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
assert.match(mailAccounts, /code_challenge_method:\s*"S256"/);
assert.match(mailAccounts, /stateHash:\s*sha256\(state\)/);
assert.match(mailAccounts, /eq\(mailOauthSessions\.ownerUserId, session\.user\.id\)/);
assert.match(mailAccounts, /delete\(mailOauthSessions\)/);
assert.doesNotMatch(mailAccounts, /https:\/\/mail\.google\.com\//);
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

console.log("Mail M1 static contract: vault, Google PKCE/state binding, DB guards, and demo claim verified.");
