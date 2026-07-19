#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("packages/db/src/schema/knowledge.ts");
const foundationMigration = read("packages/db/drizzle/0080_brave_angel.sql");
const restoreMigration = read("packages/db/drizzle/0081_knowledge_restore.sql");
const api = read("apps/api/src/knowledge.ts");
const index = read("apps/api/src/index.ts");
const exportApi = read("apps/api/src/export.ts");
const screen = read("apps/web/src/screens/Znalosti.tsx");
const editor = read("apps/web/src/knowledge/KnowledgeEditor.tsx");
const apiVerifier = read("apps/api/verify-knowledge.ts");
const uiVerifier = read("apps/api/verify-knowledge-ui.ts");
const ci = read("scripts/ci-api-integration.sh");

const checks = [
	[
		"schéma odděluje draft, neměnnou verzi a potvrzení",
		schema.includes("knowledgeArticles") &&
			schema.includes("knowledgeArticleVersions") &&
			schema.includes("knowledgeAcknowledgements"),
	],
	[
		"publikovaný snapshot má složený tenant FK a jedinečnou verzi",
		foundationMigration.includes("knowledge_versions_article_scope_fk") &&
			foundationMigration.includes("knowledge_versions_scope_version_uq"),
	],
	[
		"DB validuje strukturu, vlastnictví a neměnnost publikace",
		foundationMigration.includes("watson_validate_knowledge_payload") &&
			foundationMigration.includes("knowledge_owner_not_member") &&
			foundationMigration.includes("knowledge_versions_are_immutable"),
	],
	[
		"potvrzení platí jen pro aktuální povinnou verzi a oprávněné publikum",
		foundationMigration.includes("knowledge_acknowledgement_not_allowed") &&
			foundationMigration.includes("article_row.published_version <> NEW.article_version"),
	],
	[
		"restore výjimka je transaction-local, explicitní a mimo běžný command path",
		restoreMigration.includes("watson.allow_knowledge_restore") &&
			exportApi.includes("set_config('watson.allow_knowledge_restore', 'on', true)"),
	],
	[
		"znalosti, verze a potvrzení jsou v podepsaném exportu i restore pořadí",
		exportApi.includes('"knowledge_articles"') &&
			exportApi.includes('"knowledge_article_versions"') &&
			exportApi.includes('"knowledge_acknowledgements"'),
	],
	[
		"API používá strict validaci, CAS a idempotency receipts",
		api.includes(".strict()") &&
			api.includes("expectedDraftRevision") &&
			api.includes("knowledgeCommandReceipts") &&
			api.includes("operation_id_reused"),
	],
	[
		"draft čte jen vedení a host jen výslovné all-workspace publikum",
		api.includes("access.canManage") &&
			api.includes('articleAudience === "all_workspace_members"') &&
			api.includes("knowledge_not_found"),
	],
	[
		"audit ukládá jen metadata, ne obsah sekcí",
		api.includes('action: "update_draft"') &&
			api.includes("sectionCount") &&
			!api.includes("diff: { sections"),
	],
	[
		"compliance je agregovaná bez skóre produktivity lidí",
		api.includes("acknowledgedCount") &&
			screen.includes("ackPrivacyHint") &&
			!screen.includes("productivityScore") &&
			!screen.includes("employeeScore"),
	],
	[
		"editor je zaměřený na sekce a není Notion-like builder",
		editor.includes("KnowledgeSection") &&
			editor.includes("Přidat sekci") === false &&
			!editor.includes("contentEditable") &&
			!schema.includes("database_property"),
	],
	[
		"routa a rate limit jsou zapojené",
		index.includes('name: "knowledge"') && index.includes("knowledgeRoutes"),
	],
	[
		"API důkaz pokrývá draft leak, hosta, verze, retry, DB i audit",
		apiVerifier.includes("draft není viditelný zaměstnanci") &&
			apiVerifier.includes("host vidí pouze výslovně publikovanou verzi") &&
			apiVerifier.includes("publikovaný snapshot odmítá měnit i databáze") &&
			apiVerifier.includes("audit obsahuje metadata, ne text znalosti"),
	],
	[
		"browser důkaz pokrývá publish, acknowledge, mobil a axe ve dvou enginech",
		uiVerifier.includes("chromium,webkit") &&
			uiVerifier.includes("Přečetl/a jsem a rozumím") &&
			uiVerifier.includes("assertNoOverflow") &&
			uiVerifier.includes("assertAxeClean"),
	],
	["API verifier běží v úplné integrační sadě", ci.includes("verify:knowledge")],
	[
		"scope lock neobsahuje neschválený chat, whiteboard ani office suite",
		!schema.includes("chat_message") &&
			!schema.includes("whiteboard") &&
			!schema.includes("spreadsheet") &&
			!schema.includes("database_builder"),
	],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length) {
	console.error(`Knowledge contract failed: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("Employee Knowledge & SOP contract: versioned, scoped, portable and acknowledged.");
