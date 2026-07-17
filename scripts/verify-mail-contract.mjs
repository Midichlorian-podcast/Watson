import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, vault, powersync, mailScreen, demoBanner, env, preflight, migration] =
  await Promise.all([
    read("packages/db/src/schema/mail.ts"),
    read("apps/api/src/mailVault.ts"),
    read("apps/api/src/powersync.ts"),
    read("apps/web/src/mail/MailScreen.tsx"),
    read("apps/web/src/mail/DemoBanner.tsx"),
    read("apps/api/src/env.ts"),
    read("scripts/verify-production-config.mjs"),
    read("packages/db/drizzle/0068_overjoyed_obadiah_stane.sql"),
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
assert.match(mailScreen, /<MailDemoBanner/);
assert.match(demoBanner, /data-mail-demo-banner/);
assert.match(env, /MAIL_VAULT_KEYS_JSON/);
assert.match(preflight, /mail_vault_keyring/);
assert.match(migration, /mail_accounts_owner_scope_guard/);
assert.match(migration, /mail_account_credentials_provider_guard/);

console.log("Mail M1 static contract: vault isolated, DB guards present, demo claim preserved.");

