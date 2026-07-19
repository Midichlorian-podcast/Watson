#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
	api,
	projection,
	provider,
	availability,
	taskAvailability,
	radar,
	schema,
	migration,
	sync,
	client,
	component,
	selfService,
	apiVerifier,
	uiVerifier,
	stub,
	docs,
] = await Promise.all([
	read("apps/api/src/employeeAbsences.ts"),
	read("apps/api/src/employeeAbsenceProjection.ts"),
	read("apps/api/src/luckyOsV1.ts"),
	read("apps/api/src/availability.ts"),
	read("apps/api/src/taskAvailability.ts"),
	read("apps/api/src/radar.ts"),
	read("packages/db/src/schema/availability.ts"),
	read("packages/db/drizzle/0079_flat_jean_grey.sql"),
	read("powersync/sync-config.yaml"),
	read("apps/web/src/lib/employeeAbsences.ts"),
	read("apps/web/src/components/EmployeeAbsences.tsx"),
	read("apps/web/src/components/EmployeeSelfService.tsx"),
	read("apps/api/verify-employee-self-service.ts"),
	read("apps/api/verify-employee-hub-ui.ts"),
	read("apps/api/verify-luckyos-provider-stub.mjs"),
	read("docs/employee-hub-runbook.md"),
]);

const checks = [
	[
		"absence je session-bound v1 facade s přesnými serverovými scopes",
		api.includes("auth.api.getSession") &&
			api.includes('env.luckyOs.protocol !== "v1"') &&
			api.includes('scopes: ["cases:read"]') &&
			api.includes('["assignments:write", "cases:write"]') &&
			!client.includes("personId") &&
			!client.includes("organizationId") &&
			!client.includes("scopes:"),
	],
	[
		"vstup je striktní, IANA-bound, nejvýše roční a hlídá překryv",
		api.includes("absenceRequestSchema") &&
			api.includes(".strict()") &&
			projection.includes("calendarDayDistance(startDate, endDate) > 365") &&
			projection.includes("nextValidZonedDateTimeToIso") &&
			api.includes('error: "absence_overlap"'),
	],
	[
		"provider command je idempotentní a browser nemůže zvolit prioritu ani upload",
		api.includes(":${parsed.data.operationId}:absence") &&
			api.includes('command: "case.create"') &&
			api.includes('priority: "normal"') &&
			api.includes("upload_id: null") &&
			!client.includes("upload_id"),
	],
	[
		"projekce ukládá jen provozní minimum a nikdy poznámku zaměstnance",
		projection.includes("availabilityBlocks") &&
			projection.includes('source: "luckyos"') &&
			projection.includes("approvalStatus") &&
			!projection.includes("employee_message") &&
			!projection.includes("employeeMessage") &&
			!projection.includes("note:") &&
			projection.includes("resolutionPublic: input.resolution_public"),
	],
	[
		"pending/approved stav je v DB omezený a synchronizovaný bez soukromého popisku",
		schema.includes("availability_blocks_approval_status_valid") &&
			schema.includes("availability_blocks_pending_source_valid") &&
			migration.includes('ADD COLUMN "approval_status"') &&
			sync.includes("approval_status") &&
			!sync.match(/SELECT[^;]*label[^;]*FROM availability_blocks/s),
	],
	[
		"jen schválený blok ovlivní plánování, Nerušit a Radar",
		availability.includes('eq(availabilityBlocks.approvalStatus, "approved")') &&
			taskAvailability.includes("b.approval_status = 'approved'") &&
			radar.includes('eq(availabilityBlocks.approvalStatus, "approved")'),
	],
	[
		"podepsaný event znovu načte autoritativní case a zůstává retryable",
		provider.includes("isAbsenceCaseEvent") &&
			provider.includes("absenceCaseEventPayloadSchema") &&
			provider.includes('new LuckyOsV1Error("invalid_absence_event", 422)') &&
			provider.includes("projectAbsenceEvent") &&
			provider.includes('scopes: ["cases:read"]') &&
		provider.includes("absence_projection_retry_required") &&
			provider.includes("if (!ownerUserId && !identity && args.event.person_id)") &&
			provider.includes('new LuckyOsV1Error("absence_projection_unavailable", 503)'),
	],
	[
		"UI vysvětluje pending stav, potvrzuje odeslání a nic nepersistuje",
		selfService.includes("<EmployeeAbsences />") &&
			component.includes("window.confirm") &&
			component.includes('t("employee.absences.description")') &&
			!client.includes("localStorage") &&
			!client.includes("sessionStorage") &&
			client.includes('cache: "no-store"'),
	],
	[
		"API důkaz pokrývá validaci, replay, překryv, více prostorů, event a redakci",
		apiVerifier.includes("invalidAbsence") &&
			apiVerifier.includes("absenceReplay") &&
			apiVerifier.includes("overlappingAbsence") &&
		apiVerifier.includes("pendingBlocks.length === 2") &&
			apiVerifier.includes("invalidAbsenceEvent") &&
			apiVerifier.includes("absenceEventReplay") &&
			apiVerifier.includes("auditLeak.length === 0"),
	],
	[
		"stub a browser verifier mají skutečný case command i uživatelský tok",
		stub.includes("v1Cases") &&
			stub.includes('command.command !== "case.create"') &&
			stub.includes('scopes.has("assignments:write")') &&
			uiVerifier.includes("absenceCommands") &&
			uiVerifier.includes("employee_hub_ui_mobile_absences_target"),
	],
	[
		"runbook drží LuckyOS jako HR autoritu a popisuje retry i privacy hranici",
		docs.includes("Dovolená a absence") &&
			docs.includes("jediný HR system of record") &&
			docs.includes("neukládají do Watson DB") &&
			docs.includes("webhook vrátí řízené 503"),
	],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length > 0) {
	console.error(`Employee absences contract selhal: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("Employee absences contract: LuckyOS-authoritative, privacy-minimised and retryable.");
