import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
	schema,
	migration,
	invariantMigration,
	serviceMigration,
	integrations,
	serviceIntegrations,
	emailProvider,
	push,
	employee,
	index,
	ui,
	settings,
	powerSyncSchema,
	powerSyncGateway,
	cs,
	en,
	ci,
] = await Promise.all([
	read("packages/db/src/schema/system.ts"),
	read("packages/db/drizzle/0065_happy_stranger.sql"),
	read("packages/db/drizzle/0066_cultured_cerise.sql"),
	read("packages/db/drizzle/0067_early_galactus.sql"),
	read("apps/api/src/integrations.ts"),
	read("apps/api/src/serviceIntegrations.ts"),
	read("apps/api/src/emailProvider.ts"),
	read("apps/api/src/push.ts"),
	read("apps/api/src/employee.ts"),
	read("apps/api/src/index.ts"),
	read("apps/web/src/components/IntegrationCenter.tsx"),
	read("apps/web/src/screens/Nastaveni.tsx"),
	read("apps/web/src/lib/powersync/AppSchema.ts"),
	read("apps/api/src/powersync.ts"),
	read("packages/i18n/src/locales/cs.json"),
	read("packages/i18n/src/locales/en.json"),
	read("scripts/ci-api-integration.sh"),
]);

const failures = [];
const requireText = (source, token, label) => {
	if (!source.includes(token)) failures.push(`${label}: chybí ${token}`);
};

for (const column of [
	"ownerUserId",
	"provider",
	"status",
	"scopes",
	"capabilities",
	"lastTestedAt",
	"lastSuccessAt",
	"lastErrorAt",
	"lastErrorCode",
	"revokedAt",
	"version",
]) {
	requireText(schema, column, `registry ${column}`);
}
for (const guard of [
	"integration_connections_provider_valid",
	"integration_connections_status_valid",
	"integration_connections_scopes_array",
	"integration_connections_owner_provider_uq",
	"integration_command_receipts_actor_operation_uq",
]) {
	requireText(migration, guard, `DB guard ${guard}`);
}
for (const invariant of [
	"integration_connections_revoke_consistent",
	"integration_connections_error_code_valid",
	"integration_connection_personal_scope_guard",
	"integration_receipt_owner_guard",
]) {
	requireText(invariantMigration, invariant, `DB invariant ${invariant}`);
}
for (const provider of ["resend_email", "watson_attachments", "email_contract_rejected"]) {
	requireText(serviceMigration, provider, `rozšířený provider ${provider}`);
}
for (const route of [
	'"/api/integrations"',
	'"/api/integrations/luckyos/test"',
	'"/api/integrations/luckyos/revoke"',
	'"/api/integrations/luckyos/reconnect"',
]) {
	requireText(integrations, route, `route ${route}`);
}
for (const route of [
	'"/api/integrations/resend_email/test"',
	'"/api/integrations/resend_email/revoke"',
	'"/api/integrations/resend_email/reconnect"',
	'"/api/integrations/watson_attachments/test"',
]) {
	requireText(serviceIntegrations, route, `service route ${route}`);
}
for (const guarantee of [
	"safeErrorCode",
	"isLuckyOsRevoked",
	"recordLuckyOsHealth",
	"validateLuckyPayload",
	"employeeStatusSchema.safeParse",
	"idempotency_key_reused",
	"stale_version",
	"pg_advisory_xact_lock",
	"integrationCommandReceipts",
	"auditEvents",
]) {
	requireText(integrations, guarantee, `serverový kontrakt ${guarantee}`);
}
for (const guarantee of [
	"sendProviderEmail",
	"Idempotency-Key",
	"email_contract_rejected",
	"AbortSignal.timeout",
]) {
	requireText(emailProvider, guarantee, `e-mail provider ${guarantee}`);
}
for (const guarantee of [
	"sendTaskReminderEmail",
	"reminderEmailAvailability",
	"providerMessageId",
	"delivery.permanent",
]) {
	requireText(push + serviceIntegrations, guarantee, `reminder kontrakt ${guarantee}`);
}
requireText(employee, "if (res.revoked)", "employee passthrough respektuje revoke");
requireText(employee, "isLuckyOsRevoked(session.user.id)", "upload respektuje revoke");
requireText(index, '"/api/integrations/*"', "provider endpoint má rate limit");
requireText(settings, "<IntegrationCenter />", "Integration Center je v Nastavení");
for (const uiToken of [
	"integration.lastSuccessAt",
	"integration.lastTestedAt",
	"integration.lastErrorCode",
	"integration.scopes.map",
	"integrationProvider.${integration.provider}.revokeTitle",
	"expectedVersion: integration.version",
	"crypto.randomUUID()",
]) {
	requireText(ui, uiToken, `UI ${uiToken}`);
}
for (const [locale, source] of [
	["cs", cs],
	["en", en],
]) {
	for (const key of [
		"integrationCenterTitle",
		"integrationStatus",
		"integrationError",
		"integrationScope",
		"integrationRevokeConfirmDesc",
	]) {
		requireText(source, `"${key}"`, `${locale} překlad ${key}`);
	}
}
requireText(ci, "verify:integrations", "API integrační důkaz běží v CI");
requireText(ci, "verify-luckyos-provider-stub.mjs", "CI nepoužívá reálný LuckyOS");
requireText(ci, "verify-email-provider-stub.mjs", "CI neposílá reálný e-mail");
requireText(settings, "notificationPlanned", "Oznámení nepředstírá aktivní digest");
requireText(settings, "notificationPerTask", "Reminder stav odkazuje na skutečný per-task model");
requireText(powerSyncGateway, "reminderEmailAvailability(userId)", "write-path ověřuje e-mail provider");

for (const forbidden of ["integration_connections", "integration_command_receipts"]) {
	if (powerSyncSchema.includes(forbidden) || powerSyncGateway.includes(`${forbidden}:`)) {
		failures.push(`${forbidden} nesmí být v browser DB ani obecném write gateway`);
	}
}
if (/baseUrl|authorization|accessToken|refreshToken/.test(ui)) {
	failures.push("Integration Center UI nesmí pracovat s provider URL ani credentials");
}

if (failures.length) {
	console.error(`Integration contract selhal (${failures.length}):`);
	for (const failure of failures) console.error(` - ${failure}`);
	process.exit(1);
}

console.log(
	"Integration contract ověřen: redigovaný health, scopes, revoke/reconnect, CAS, audit a server-only registry.",
);
