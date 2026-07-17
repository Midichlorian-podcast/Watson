#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  employee,
  integrations,
  index,
  client,
  screen,
  overview,
  sidebar,
  mobile,
  router,
  apiVerifier,
  uiVerifier,
  ci,
] = await Promise.all([
  read("apps/api/src/employee.ts"),
  read("apps/api/src/integrations.ts"),
  read("apps/api/src/index.ts"),
  read("apps/web/src/lib/employee.ts"),
  read("apps/web/src/screens/EmployeeHub.tsx"),
  read("apps/web/src/screens/Prehled.tsx"),
  read("apps/web/src/layout/Sidebar.tsx"),
  read("apps/web/src/layout/MobileTabBar.tsx"),
  read("apps/web/src/router.tsx"),
  read("apps/api/verify-employee-hub.ts"),
  read("apps/api/verify-employee-hub-ui.ts"),
  read("scripts/ci-api-integration.sh"),
]);

const checks = [
  [
    "server vrací jen explicitní veřejnou projekci",
    employee.includes("publicEmployeeStatus") &&
      employee.includes("publicEmployeeIdentity") &&
      employee.includes("relativeHref"),
  ],
  [
    "identita i status jsou validované provider kontraktem",
    employee.includes("luckyIdentitySchema.safeParse") &&
      employee.includes("employeeStatusSchema.safeParse"),
  ],
  [
    "všechny Employee odpovědi zakazují cache",
    employee.includes('employeeRoutes.use("*",') && employee.includes('"private, no-store"'),
  ],
  [
    "reconcile je owner-only, tenant-scoped a auditovaný",
    employee.includes("personalWorkspaceId") &&
      employee.includes("entityLinks.workspaceId") &&
      employee.includes("employee_reconcile") &&
      employee.includes("pg_advisory_xact_lock"),
  ],
  [
    "Employee API má session-or-IP rate limit",
    index.includes('"/api/employee/*"') && index.includes('name: "employee"'),
  ],
  [
    "provider href se považuje za nedůvěryhodný vstup",
    integrations.includes("href: z.string().max") && employee.includes('href.startsWith("//")'),
  ],
  [
    "klient čte online bez ukládání citlivého payloadu",
    client.includes('cache: "no-store"') &&
      client.includes('queryKey: ["employee-hub"]') &&
      !client.includes("storageSet"),
  ],
  [
    "Hub vysvětluje zdroj dat a nabízí explicitní sync akcí",
    screen.includes("employee.privacyNotice") &&
      screen.includes("employee.syncTasks") &&
      screen.includes("syncEmployeeTasks"),
  ],
  [
    "navigace a dashboard jsou gated skutečným linked stavem",
    sidebar.includes("employeeHub.data?.linked === true") &&
      mobile.includes("employeeHub.data?.linked === true") &&
      overview.includes("employeeHub.data?.linked") &&
      router.includes('path: "/zamestnanec"'),
  ],
  [
    "API důkaz pokrývá redakci, odkazy, cache a idempotenci",
    apiVerifier.includes("must-not-leak") &&
      apiVerifier.includes("absolutní provider odkaz") &&
      apiVerifier.includes("opakovaný sync je idempotentní"),
  ],
  [
    "browser důkaz pokrývá gating, dashboard, mobil a axe",
    uiVerifier.includes("Můj zaměstnanecký přehled") &&
      uiVerifier.includes("Můj stav") &&
      uiVerifier.includes("assertNoOverflow") &&
      uiVerifier.includes("assertAxeClean"),
  ],
  ["API verifier běží v úplné integrační sadě", ci.includes("verify:employee-hub")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length > 0) {
  console.error(`Employee Hub contract selhal: ${failed.map(([label]) => label).join(", ")}`);
  process.exit(1);
}
console.log("Employee Hub contract: minimalizovaný, online-only, gated a auditovatelný.");
