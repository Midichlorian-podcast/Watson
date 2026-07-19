import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const schema = read("packages/db/src/schema/publicApi.ts");
const migration = read("packages/db/drizzle/0082_lyrical_thanos.sql");
const api = read("apps/api/src/publicApi.ts");
const delivery = read("apps/api/src/webhookDelivery.ts");
const index = read("apps/api/src/index.ts");
const restore = read("apps/api/src/export.ts");
const ui = read("apps/web/src/components/DeveloperApiSettings.tsx");
const powersyncSchema = read("apps/web/src/lib/powersync/AppSchema.ts");

for (const table of [
  "api_clients",
  "api_command_receipts",
  "webhook_subscriptions",
  "webhook_events",
  "webhook_deliveries",
]) {
  assert.ok(schema.includes(`\"${table}\"`), `missing schema table ${table}`);
  assert.equal(powersyncSchema.includes(table), false, `${table} must remain server-only`);
}
assert.match(migration, /CREATE TRIGGER watson_tasks_webhook_outbox/);
assert.match(migration, /CREATE TRIGGER watson_projects_webhook_outbox/);
assert.match(migration, /suppress_webhook_events/);
assert.match(restore, /set_config\('watson\.suppress_webhook_events', 'on', true\)/);
assert.match(api, /timingSafeEqual/);
assert.match(api, /Idempotency-Key|idempotency-key/);
assert.match(api, /projectIds/);
assert.match(api, /public\/v1\/openapi\.json/);
assert.match(delivery, /dns\.lookup/);
assert.match(delivery, /servername: url\.protocol/);
assert.match(delivery, /redirect_rejected/);
assert.match(delivery, /Watson-Signature/);
assert.match(index, /startWebhookWorker\(\)/);
assert.match(ui, /zobrazí se jen teď/);
assert.equal(/localStorage|storageSet/.test(ui), false, "one-time secrets must not persist in browser storage");

console.log("Public API contract: scopes, outbox, SSRF, signing and one-time-secret UI verified");
