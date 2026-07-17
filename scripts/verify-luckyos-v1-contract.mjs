import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("apps/api/src/luckyOsV1.ts");
const powersync = read("apps/api/src/powersync.ts");
const integrations = read("apps/api/src/integrations.ts");
const index = read("apps/api/src/index.ts");
const env = read("apps/api/src/env.ts");
const schema = read("packages/db/src/schema/employeeIntegration.ts");
const migration = read("packages/db/drizzle/0077_blushing_wasp.sql");
const linkMigration = read("packages/db/drizzle/0078_right_doorman.sql");
const sync = read("powersync/sync-config.yaml");
const verifier = read("apps/api/verify-luckyos-v1.ts");
const production = read("scripts/verify-production-config.mjs");
const ci = read("scripts/ci-api-integration.sh");

const v1Token = powersync.slice(
	powersync.indexOf("export async function issueLuckyOsV1Token"),
	powersync.indexOf("export const powersyncRoutes"),
);
assert.match(v1Token, /setAudience\("lucky-os"\)/);
assert.match(v1Token, /setIssuer\("watson"\)/);
assert.match(v1Token, /setJti\(randomUUID\(\)\)/);
assert.match(v1Token, /organization_id/);
assert.match(v1Token, /watson_user_id/);
assert.match(v1Token, /scope: scopes\.join/);
assert.doesNotMatch(v1Token, /email:|person_id:/);

assert.match(api, /createHmac\("sha256", webhookSecret\(\)\)/);
assert.match(api, /timingSafeEqual/);
assert.match(api, /WEBHOOK_CLOCK_SKEW_MS = 5 \* 60_000/);
assert.match(api, /EVENT_MAX_BYTES = 64 \* 1024/);
assert.match(api, /payloadHash: hashBody\(rawBody\)/);
assert.match(api, /idempotency_conflict/);
assert.match(api, /stale_identity_event/);
assert.match(api, /identity_person_conflict/);
assert.match(api, /identity_link_conflict/);
assert.match(api, /providerLinkId: args\.event\.aggregate\.id/);
assert.match(api, /integrationConnections\.revokedAt/);
assert.match(api, /redirect: "error"/);
assert.match(api, /PROVIDER_JSON_MAX_BYTES/);
assert.match(api, /encodeURIComponent\(binding\.providerPersonId\)/);
assert.doesNotMatch(
	api.slice(api.indexOf("export async function luckyOsV1EmployeeFetch")),
	/personId:\s*string/,
);

assert.match(schema, /luckyos_identity_bindings/);
assert.match(schema, /luckyos_event_inbox/);
assert.match(schema, /octet_length/);
assert.match(migration, /luckyos_event_inbox_idempotency_uq/);
assert.match(migration, /luckyos_identity_bindings_provider_person_uq/);
assert.match(linkMigration, /provider_link_id/);
assert.match(linkMigration, /luckyos_identity_bindings_provider_link_uq/);
assert.doesNotMatch(sync, /luckyos_identity_bindings|luckyos_event_inbox/);

assert.match(env, /LUCKYOS_PROTOCOL/);
assert.match(env, /LUCKYOS_ORGANIZATION_ID/);
assert.match(env, /LUCKYOS_WEBHOOK_SIGNING_SECRET/);
assert.match(integrations, /env\.luckyOs\.protocol !== "legacy"/);
assert.match(integrations, /luckyOsV1EmployeeFetch/);
assert.match(index, /luckyOsWebhookRateLimit/);
assert.match(index, /app\.route\("\/", luckyOsV1Routes\)/);
assert.match(production, /luckyos_webhook_secret_isolation/);
assert.match(verifier, /unsigned\/forged event must fail/);
assert.match(verifier, /cross-tenant event must fail/);
assert.match(verifier, /same idempotency key with another body must conflict/);
assert.match(verifier, /out-of-order event must not downgrade state/);
assert.match(verifier, /Watson-side revoke must precede token issuance/);
assert.match(ci, /verify:luckyos-v1/);

console.log(
	"LuckyOS v1 contract: exact JWT, signed inbox, server-only identity, replay/order/revoke and fail-closed config verified.",
);
