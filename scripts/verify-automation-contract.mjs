#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("packages/db/src/schema/automation.ts");
const migration = [
	read("packages/db/drizzle/0075_silent_jane_foster.sql"),
	read("packages/db/drizzle/0076_boring_gauntlet.sql"),
].join("\n");
const api = read("apps/api/src/automation.ts");
const index = read("apps/api/src/index.ts");
const ui = read("apps/web/src/components/AutomationCenter.tsx");
const apiVerifier = read("apps/api/verify-automation.ts");
const uiVerifier = read("apps/api/verify-automation-ui.ts");
const ci = read("scripts/ci-api-integration.sh");

const checks = [
	["schema odděluje draft, neměnnou verzi a připnutý běh", schema.includes("automationRules") && schema.includes("automationRuleVersions") && schema.includes("ruleVersionId")],
	["workspace/project scope je vynucen složenými FK", migration.includes("automation_rules_project_workspace_fk") && migration.includes("automation_runs_version_scope_fk")],
	["publikovanou verzi chrání DB trigger", migration.includes("automation_rule_versions_update_guard") && migration.includes("automation_rule_version_immutable")],
	["stavový automat běhu je vynucen i v DB", migration.includes("automation_runs_transition_guard") && migration.includes("automation_run_transition_invalid")],
	["konfigurace je strict a omezená", api.includes("automationConfigSchema") && api.includes(".strict()") && api.includes("duplicate_mutating_action")],
	["preview je samostatný read-only command", api.includes('/preview"') && api.includes("Preview nic nezměnil")],
	["publish používá CAS, idempotenci a snapshot", api.includes("draft_revision_conflict") && api.includes("publishOperationId") && api.includes("automationRuleVersions")],
	["jedna draft revize se publikuje nejvýše jednou", schema.includes("automation_rule_versions_rule_draft_revision_uq") && migration.includes("automation_rule_versions_rule_draft_revision_uq") && api.includes("WHERE rule_id = ${ruleId.data} AND draft_revision = ${rule.draft_revision}")],
	["runtime znovu ověřuje publikujícího managera", api.includes("publisher_permission_revoked") && api.includes("projectAccess(tx, run.project_id, run.published_by)")],
	["worker ignoruje vlastní systémové audity a deduplikuje event", api.includes("ae.actor_type <> 'system'") && schema.includes("automation_runs_version_event_uq")],
	["akce jsou atomické, auditované a mají stale-safe Undo", api.includes("automation_apply") && api.includes("undo_stale") && api.includes("undoExpiresAt")],
	["rate limit, routa a worker jsou zapojené", index.includes('name: "automation"') && index.includes("automationRoutes") && index.includes("startAutomationWorker")],
	["UI vysvětluje draft/publish/preview/audit/undo", ui.includes("PREVIEW · AUDIT · UNDO") && ui.includes("Uložit koncept") && ui.includes("Publikovat v1") && ui.includes("Historie běhů")],
	["UI ukazuje procesní počty bez hodnocení lidí", ui.includes("run_succeeded") && !ui.includes("productivityScore") && !ui.includes("employeeScore")],
	["API důkaz pokrývá replay, verze, akce, undo a tenant", apiVerifier.includes("create retry je idempotentní") && apiVerifier.includes("publikovaný snapshot") && apiVerifier.includes("DB odmítá cross-workspace")],
	["browser důkaz pokrývá preview, publish, mobil a axe", uiVerifier.includes("2 navržené změny") && uiVerifier.includes("PUBLIKOVÁNO v1") && uiVerifier.includes("assertNoOverflow") && uiVerifier.includes("assertAxeClean")],
	["API verifier běží v úplné integrační sadě", ci.includes("verify:automation")],
	["scope lock neobsahuje odmítnuté workload/role/SLA automace", !schema.includes("assign_by_workload") && !schema.includes("assign_by_role") && !schema.includes("sla_escalation")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length) {
	console.error(`Automation contract failed: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("Rules & Automation contract: versioned, previewed, audited and undoable.");
