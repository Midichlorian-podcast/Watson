#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, files, index, client, component, selfService, procedures, apiVerifier, uiVerifier, stub, ci, docs] =
	await Promise.all([
		read("apps/api/src/employeeLifecycle.ts"),
		read("apps/api/src/employeeFiles.ts"),
		read("apps/api/src/index.ts"),
		read("apps/web/src/lib/employeeLifecycle.ts"),
		read("apps/web/src/components/EmployeeLifecycle.tsx"),
		read("apps/web/src/components/EmployeeSelfService.tsx"),
		read("apps/web/src/screens/Postupy.tsx"),
		read("apps/api/verify-employee-self-service.ts"),
		read("apps/api/verify-employee-hub-ui.ts"),
		read("apps/api/verify-luckyos-provider-stub.mjs"),
		read("scripts/ci-api-integration.sh"),
		read("docs/employee-hub-runbook.md"),
	]);

const checks = [
	[
		"facade je session-bound, v1-only a bez lokálního HR persistence",
		api.includes("auth.api.getSession") &&
			api.includes('env.luckyOs.protocol !== "v1"') &&
			api.includes("isLuckyOsRevoked") &&
			!api.includes("getDb") &&
			!api.includes("issueBridgeToken"),
	],
	[
		"person, tenant a minimální onboarding/offboarding scopes volí jen server",
		api.includes('scopes: ["onboarding:read"]') &&
			api.includes('scopes: ["offboarding:read"]') &&
			api.includes('scopes: [`${parsed.data.lifecycleType}:write`]') &&
			!client.includes("providerPersonId") &&
			!client.includes("organizationId") &&
			!client.includes("scopes:"),
	],
	[
		"provider payload prochází strict kontraktem a allowlist projekcí",
		api.includes("lifecycleInstanceSchema") &&
			api.includes("publicMetadata") &&
			api.includes("publicLifecycle") &&
			api.includes("validateCommandResult") &&
			!client.includes("public_payload") &&
			!client.includes("internal_payload"),
	],
	[
		"odpovědi vyžadují přesnou verzi, explicitní potvrzení a stabilní idempotency",
		api.includes("expectedVersion") &&
			api.includes("confirmation_required") &&
			api.includes(":${parsed.data.operationId}:lifecycle") &&
			component.includes("window.confirm") &&
			component.includes("retry.current"),
	],
	[
		"souborový krok používá ověřený upload s odděleným lifecycle účelem",
		files.includes('"lifecycle_document"') &&
			api.includes('purpose: "lifecycle_document"') &&
			api.includes("EMPLOYEE_FILE_MAX_BYTES") &&
			index.includes("/api/employee/self-service/lifecycle/respond-file"),
	],
	[
		"citlivé odpovědi zůstávají online a jen krátce v paměti",
		client.includes('cache: "no-store"') &&
			client.includes("gcTime: 60_000") &&
			!client.includes("localStorage") &&
			!client.includes("sessionStorage") &&
			!component.includes("localStorage") &&
			!component.includes("sessionStorage"),
	],
	[
		"Postupy zobrazují autoritativní průběh bez duplikace task/chains state",
		selfService.includes("<EmployeeLifecycle />") &&
			procedures.includes("useEmployeeLifecycle") &&
			procedures.includes("personalLifecycle") &&
			!api.includes("chains") &&
			!api.includes("tasks"),
	],
	[
		"API důkaz pokrývá redakci, validaci, replay, konflikt i soubor",
		apiVerifier.includes("lifecycleInstances") &&
			apiVerifier.includes("invalidLifecycle") &&
			apiVerifier.includes("lifecycleReplay") &&
			apiVerifier.includes("lifecycleIdempotencyConflict") &&
			apiVerifier.includes("lifecycleFileReplay") &&
			apiVerifier.includes("must-not-leak"),
	],
	[
		"browser důkaz pokrývá retry, file, Postupy, mobil a axe",
		uiVerifier.includes("lifecycleCommands") &&
			uiVerifier.includes("lifecycleFileCommands") &&
			uiVerifier.includes("employee_hub_ui_mobile_lifecycle_target") &&
			uiVerifier.includes("employee-procedures-desktop") &&
			uiVerifier.includes("assertAxeClean"),
	],
	[
		"provider stub vynucuje scopes, verzi, ownera uploadu a idempotency",
		stub.includes('onboarding: "onboarding:read"') &&
			stub.includes('offboarding: "offboarding:read"') &&
			stub.includes('upload.purpose !== "lifecycle_document"') &&
			stub.includes("command.expected_version !== instance.version") &&
			stub.includes('request.headers["idempotency-key"]'),
	],
	[
		"integrační gate a runbook drží LuckyOS jako jediný system of record",
		ci.includes("verify:employee-self-service") &&
			docs.includes("Nástupní a výstupní postupy") &&
			docs.includes("LuckyOS je jediný system of record") &&
			docs.includes("verify-employee-lifecycle-contract"),
	],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length > 0) {
	console.error(`Employee lifecycle contract selhal: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("Employee lifecycle: LuckyOS-authoritative, redigovaný, idempotentní a napojený do Postupů.");
