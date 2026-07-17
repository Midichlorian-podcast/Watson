#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, employee, index, client, component, apiVerifier, uiVerifier, stub, ci, docs] =
  await Promise.all([
    read("apps/api/src/employeeSelfService.ts"),
    read("apps/api/src/employee.ts"),
    read("apps/api/src/index.ts"),
    read("apps/web/src/lib/employeeSelfService.ts"),
    read("apps/web/src/components/EmployeeSelfService.tsx"),
    read("apps/api/verify-employee-self-service.ts"),
    read("apps/api/verify-employee-hub-ui.ts"),
    read("apps/api/verify-luckyos-provider-stub.mjs"),
    read("scripts/ci-api-integration.sh"),
    read("docs/employee-hub-runbook.md"),
  ]);

const checks = [
  [
    "self-service je výhradně explicitní LuckyOS v1 facade",
    api.includes('env.luckyOs.protocol !== "v1"') &&
      api.includes("luckyOsV1EmployeeFetch") &&
      !api.includes("issueBridgeToken"),
  ],
  [
    "profil, docházka a malá čísla mají oddělené strict vstupy",
    api.includes("profileChangeInput") &&
      api.includes("attendanceInput") &&
      api.includes("smallNumberInput") &&
      (api.match(/\.strict\(\)/g)?.length ?? 0) >= 6,
  ],
  [
    "person ID a scopes volí pouze server",
    api.includes('scopes: ["profile:write"]') &&
      api.includes('scopes: ["attendance:write"]') &&
      api.includes('scopes: ["small-numbers:write"]') &&
      !client.includes("providerPersonId") &&
      !client.includes("scopes:"),
  ],
  [
    "citlivé provider payloady procházejí veřejnou allowlist projekcí",
    api.includes("publicProfile") &&
      api.includes("publicProfileRequest") &&
      api.includes("publicAttendance") &&
      api.includes("publicSmallNumbers") &&
      api.includes("publicCommand") &&
      api.includes("maskBankAccount"),
  ],
  [
    "commandy jsou explicitní a idempotentní",
    api.includes("idempotencyKey") &&
      api.includes("operationId") &&
      api.includes('action: z.enum(["save_draft", "submit"])') &&
      api.includes('status: z.enum(["draft", "submitted"])'),
  ],
  [
    "status mapuje v1 work items do stávajícího task reconciliation",
    api.includes("workItemNotificationType") &&
      api.includes('return "attendance_reminder"') &&
      employee.includes("readLuckyOsV1Status") &&
      employee.includes("reconcileEmployeeTasks"),
  ],
  [
    "citlivá data zůstávají online a jen krátce v paměti",
    client.includes('cache: "no-store"') &&
      client.includes("gcTime: 60_000") &&
      !client.includes("localStorage") &&
      !client.includes("sessionStorage") &&
      !component.includes("localStorage") &&
      !component.includes("sessionStorage"),
  ],
  [
    "UI odděluje koncept od potvrzeného odevzdání",
    component.includes('save("save_draft")') &&
      component.includes('save("submit")') &&
      component.includes("window.confirm") &&
      component.includes("employee.selfService.unsaved") &&
      component.includes("useStableOperationId") &&
      component.includes("operation.forPayload"),
  ],
  [
    "API důkaz pokrývá redakci, replay, konflikt, validaci, sync a revoke",
    apiVerifier.includes("must-not-leak") &&
      apiVerifier.includes("profileConflict") &&
      apiVerifier.includes("invalidFuture") &&
      apiVerifier.includes("attendanceReplay") &&
      apiVerifier.includes("smallSave") &&
      apiVerifier.includes("lokální revoke"),
  ],
  [
    "browser důkaz pokrývá oba formulářové enginy, mobil a axe",
    uiVerifier.includes("profileCommands") &&
      uiVerifier.includes("attendanceCommands") &&
      uiVerifier.includes("smallNumberCommands") &&
      uiVerifier.includes("chromium") &&
      uiVerifier.includes("webkit") &&
      uiVerifier.includes("assertAxeClean"),
  ],
  [
    "provider stub vyžaduje minimální read/write scopes a idempotency key",
    stub.includes('"profile:write"') &&
      stub.includes('"attendance:write"') &&
      stub.includes('"small-numbers:write"') &&
      stub.includes('request.headers["idempotency-key"]'),
  ],
  [
    "v1 self-service verifier běží v izolovaném API procesu",
    ci.includes('export LUCKYOS_PROTOCOL="v1"') &&
      ci.includes("verify:employee-self-service") &&
      ci.includes("stop_api"),
  ],
  [
    "runbook drží LuckyOS jako autoritu a popisuje self-service",
    docs.includes("LuckyOS je jediný system of record") &&
      docs.includes("Profil, docházka a malá čísla") &&
      docs.includes("verify:employee-self-service"),
  ],
  [
    "Employee API zůstává rate-limitované a no-store",
    index.includes('name: "employee"') && api.includes("private, no-store"),
  ],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length > 0) {
  console.error(`Employee self-service contract selhal: ${failed.map(([label]) => label).join(", ")}`);
  process.exit(1);
}
console.log("Employee self-service contract: v1-only, minimalizovaný, idempotentní a human-in-the-loop.");
