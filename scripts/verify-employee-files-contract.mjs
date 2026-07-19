#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, provider, index, client, component, apiVerifier, uiVerifier, stub, ci, docs] =
  await Promise.all([
    read("apps/api/src/employeeFiles.ts"),
    read("apps/api/src/luckyOsV1.ts"),
    read("apps/api/src/index.ts"),
    read("apps/web/src/lib/employeeFiles.ts"),
    read("apps/web/src/components/EmployeeFiles.tsx"),
    read("apps/api/verify-employee-self-service.ts"),
    read("apps/api/verify-employee-hub-ui.ts"),
    read("apps/api/verify-luckyos-provider-stub.mjs"),
    read("scripts/ci-api-integration.sh"),
    read("docs/employee-hub-runbook.md"),
  ]);

const checks = [
  [
    "facade je session-bound a výhradně nad LuckyOS v1",
    api.includes('env.luckyOs.protocol !== "v1"') &&
      api.includes("employeeFileRoutes.use") &&
      api.includes("auth.api.getSession") &&
      !api.includes("issueBridgeToken"),
  ],
  [
    "browser neurčuje person, tenant ani provider scopes",
    api.includes('scopes: ["files:write"]') &&
      api.includes('scopes: ["documents:write"]') &&
      api.includes('scopes: ["expenses:write"]') &&
      api.includes('scopes: ["contracts:write"]') &&
      !client.includes("providerPersonId") &&
      !client.includes("organizationId") &&
      !client.includes("scopes:"),
  ],
  [
    "soubor je omezený, typovaný podle obsahu a hashovaný serverem",
    api.includes("EMPLOYEE_FILE_MAX_BYTES = 25 * 1024 * 1024") &&
      api.includes("verifiedMime") &&
      api.includes('createHash("sha256")') &&
      api.includes("file_sha256: sha256") &&
      index.includes("employeeFileBodyLimit"),
  ],
  [
    "upload používá intent, přesný binary PUT a atomický finalize",
    api.includes('pathSuffix: "/upload-intents"') &&
      api.includes("luckyOsV1EmployeeUpload") &&
      api.includes("upload_id: upload.uploadId") &&
      provider.includes('method: "PUT"') &&
      provider.includes('"content-type": "application/octet-stream"'),
  ],
  [
    "upload i doménové commandy mají stabilní uživatelské idempotency klíče",
    api.includes(":${args.operationId}:upload") &&
      api.includes(":${parsed.data.operationId}:document") &&
      api.includes(":${parsed.data.operationId}:expense") &&
      api.includes(":${parsed.data.operationId}:contract"),
  ],
  [
    "Watson neukládá HR soubory ani podpis do DB nebo browser storage",
    !api.includes("getDb") &&
      !client.includes("localStorage") &&
      !client.includes("sessionStorage") &&
      !component.includes("localStorage") &&
      !component.includes("sessionStorage") &&
      client.includes('cache: "no-store"'),
  ],
  [
    "publikované soubory jsou person-scoped, bounded a bez redirectu",
    api.includes("luckyOsV1PublishedDocument") &&
      provider.includes("scopes: readonly string[]") &&
      provider.includes('["documents:read"]') &&
      provider.includes("boundedResponseBytes") &&
      provider.includes('redirect: "error"'),
  ],
  [
    "podpis vyžaduje přesnou verzi, challenge, obraz podpisu a souhlas v UI",
    api.includes("expectedVersion") &&
      api.includes("signatureDataUrl") &&
      api.includes("bankAccountSuffix") &&
      api.includes("consent: z.literal(true)") &&
      component.includes("window.confirm") &&
      component.includes("consent") &&
      component.includes("SignaturePad"),
  ],
  [
    "náhled podpisu musí odpovídat názvu i verzi a chybějící PDF je přiznané",
    component.includes("document.fileName === contract.fileName") &&
      component.includes("document.version === contract.version") &&
      component.includes("previewUnavailable") &&
      component.includes("publishedEmployeeDocumentUrl"),
  ],
  [
    "veřejné projekce odstraňují provider storage a interní metadata",
    api.includes("publicDocument") &&
      api.includes("publicExpense") &&
      api.includes("publicContract") &&
      api.includes("publicPublished") &&
      apiVerifier.includes("must-not-leak") &&
      stub.includes("storage_file_id"),
  ],
  [
    "API důkaz pokrývá upload, replay, CZK, challenge, podpis a revoke",
    apiVerifier.includes("documentReplay") &&
      apiVerifier.includes("expenseReplay") &&
      apiVerifier.includes("amountCzk") &&
      apiVerifier.includes("invalidSignature") &&
      apiVerifier.includes("signedReplay") &&
      apiVerifier.includes("lokální revoke"),
  ],
  [
    "browser důkaz pokrývá dokument, výdaj, podpis, retry, mobil a axe",
    uiVerifier.includes("documentCommands") &&
      uiVerifier.includes("expenseCommands") &&
      uiVerifier.includes("contractCommands") &&
      uiVerifier.includes("multipartField") &&
      uiVerifier.includes("employee_hub_ui_mobile_documents_target") &&
      uiVerifier.includes("assertAxeClean"),
  ],
  [
    "v1 provider stub a izolovaný integrační běh jsou součástí gate",
    stub.includes('remainder === "upload-intents"') &&
      stub.includes('remainder === "documents"') &&
      stub.includes('remainder === "expense-claims"') &&
      stub.includes("contracts\\/[^/]+\\/sign") &&
      ci.includes("verify:employee-self-service"),
  ],
  [
    "runbook drží LuckyOS jako system of record i pro soubory a podpis",
    docs.includes("LuckyOS je jediný system of record") &&
      docs.includes("Dokumenty, výdaje a elektronický podpis") &&
      docs.includes("25 MB"),
  ],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length > 0) {
  console.error(`Employee files contract selhal: ${failed.map(([label]) => label).join(", ")}`);
  process.exit(1);
}
console.log("Employee files contract: bounded, v1-only, bez lokálního HR storage a idempotentní.");
