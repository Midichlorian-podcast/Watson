/** Browser proof for the gated Employee Hub, dashboard summary, mobile reflow and accessibility. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import { accounts, eq, getDb, memberships, users, workspaces } from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const WEB = process.env.EMPLOYEE_HUB_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.EMPLOYEE_HUB_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.EMPLOYEE_HUB_UI_BROWSERS ?? "chromium,webkit")
  .split(",")
  .filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

const statusPayload = {
  linked: true,
  selfService: true,
  fetchedAt: "2026-07-17T10:30:00.000Z",
  status: {
    person: { id: "employee-ui", fullName: "Eva Testovací", personType: "dpp" },
    readiness: {
      status: "blocked",
      blockers: [
        {
          type: "missing_document",
          explanation: "Doplň potvrzení pro personální evidenci.",
          href: "/employee/documents",
        },
      ],
      missingDocuments: ["potvrzení"],
      hasSubmittedAttendance: false,
      parentContributionCompleted: false,
    },
    deadlines: {
      attendanceDueDay: 10,
      payrollDay: 15,
      withholdingTaxDay: null,
      countdowns: [
        {
          key: "attendance",
          label: "Odevzdat docházku",
          due: "2026-08-10",
          daysRemaining: 3,
          severity: "urgent",
        },
      ],
    },
    dppProgress: { hoursUsed: 120, hoursLimit: 300, monthlyHours: 20, monthlyLimit: 80 },
    submissions: {},
    notifications: [
      {
        id: "notification-ui",
        type: "missing_document",
        title: "Doplň potvrzení",
        message: "Potvrzení je potřeba před uzávěrkou.",
        href: "/employee/documents",
        due: "2026-08-10",
        isRead: false,
      },
    ],
  },
};

async function provision(browserName: string) {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `employee-hub-ui-${browserName}-${suffix}@watson.test`;
  const password = `Watson-${crypto.randomUUID()}-A1!`;
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      name: `Employee Hub UI ${browserName}`,
      email,
      emailVerified: true,
    });
    await tx.insert(accounts).values({
      id: crypto.randomUUID(),
      userId,
      accountId: email,
      providerId: "credential",
      password: await hashPassword(password),
    });
    await tx.insert(workspaces).values({
      id: workspaceId,
      name: `Employee Hub UI ${browserName}`,
      ownerId: userId,
      isPersonal: true,
    });
    await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
  });
  return { userId, workspaceId, email, password };
}

async function assertAxeClean(page: Page, label: string) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const runner = (globalThis as unknown as { axe: typeof axe }).axe;
    const result = await runner.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.map((violation) => violation.id);
  });
  if (violations.length > 0)
    throw new Error(`employee_hub_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (overflow) throw new Error(`employee_hub_ui_overflow_${label}`);
}

async function run(browserName: "chromium" | "webkit") {
  const fixture = await provision(browserName);
  let browser: Browser | undefined;
  try {
    browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
    const context = await browser.newContext({
      locale: "cs-CZ",
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    const profileCommands: Array<Record<string, unknown>> = [];
    const attendanceCommands: Array<Record<string, unknown>> = [];
    const smallNumberCommands: Array<Record<string, unknown>> = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await page.route(/\/api\/employee\/status(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify(statusPayload),
      });
    });
    await page.route(/\/api\/employee\/sync(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ linked: true, created: 1, skipped: 0, projectId: "employee-ui" }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/profile(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          profile: {
            name: "Eva Testovací",
            personType: "dpp",
            email: "eva@watson.test",
            phone: "+420 777 111 222",
            address: "Praha",
            bankAccountMasked: "•••• 0100",
            active: true,
            version: 3,
          },
          requests: [
            {
              id: "profile-request-ui",
              version: 1,
              status: "pending",
              fields: ["phone"],
              reviewerNote: null,
              updatedAt: "2026-07-16T08:00:00.000Z",
            },
          ],
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/profile-change(?:\?|$)/, async (route) => {
      profileCommands.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      if (profileCommands.length === 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "luckyos_unavailable" }),
        });
        return;
      }
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ replayed: false }) });
    });
    await page.route(/\/api\/employee\/self-service\/attendance(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        attendanceCommands.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ replayed: false }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          attendance: {
            period: "2026-07",
            expectedVersion: 1,
            status: "draft",
            reviewerNote: null,
            updatedAt: "2026-07-16T08:00:00.000Z",
            records: [
              {
                id: "attendance-ui",
                date: "2026-07-02",
                activityType: "training",
                hours: 2.5,
                note: "Trénink",
              },
            ],
          },
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/small-numbers(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        smallNumberCommands.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ replayed: false }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          smallNumbers: {
            period: "2026-07",
            choreographies: [{ id: "choreography-ui", name: "Sólová choreografie", status: "active" }],
            entries: [
              {
                id: "small-number-ui",
                version: 2,
                choreographyId: "choreography-ui",
                choreographyName: "Sólová choreografie",
                hoursMinutes: 90,
                note: "Rozpracováno",
                status: "draft",
                reviewerNote: null,
                updatedAt: "2026-07-16T08:00:00.000Z",
              },
            ],
          },
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });

    await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
    await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForSelector("main", { timeout: 30_000 });
    await page.getByRole("link", { name: "Zaměstnanec", exact: true }).waitFor();

    await page.goto(`${WEB}/zamestnanec`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Můj zaměstnanecký přehled", exact: true }).waitFor();
    await page.getByText("Doplň potvrzení pro personální evidenci.", { exact: true }).waitFor();
    await page.getByText("Odevzdat docházku", { exact: true }).waitFor();
    await page.getByText("Čerpání DPP", { exact: true }).waitFor();
    await page.getByText("Watson zobrazuje jen nezbytné údaje.", { exact: false }).waitFor();
    await page.getByRole("heading", { name: "Profilové údaje", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Docházka", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Malá čísla", exact: true }).waitFor();
		const maskedAccount = await page.getByLabel("Bankovní účet", { exact: false }).getAttribute("placeholder");
    if (maskedAccount !== "•••• 0100") throw new Error(`employee_hub_ui_bank_mask:${maskedAccount}`);

    await page.getByLabel("Telefon", { exact: true }).fill("+420 777 333 444");
    await page.getByRole("button", { name: "Odeslat žádost o změnu", exact: true }).click();
    await page.getByText("Uložení se nepodařilo.", { exact: false }).waitFor();
    const intentionalProviderFailure = runtimeErrors.findIndex((message) =>
      message.includes("status of 502"),
    );
    if (intentionalProviderFailure >= 0) runtimeErrors.splice(intentionalProviderFailure, 1);
    await page.getByRole("button", { name: "Odeslat žádost o změnu", exact: true }).click();
    await page.getByText("Žádost o změnu byla bezpečně odeslána.", { exact: true }).waitFor();
    if (
      profileCommands.length !== 2 ||
      profileCommands[0]?.operationId !== profileCommands[1]?.operationId ||
      (profileCommands[0]?.patch as Record<string, unknown>)?.phone !== "+420 777 333 444"
    ) {
      throw new Error(`employee_hub_ui_profile_command:${JSON.stringify(profileCommands)}`);
    }

    await page.getByLabel("Popis práce", { exact: true }).fill("Trénink a příprava");
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).first().click();
    await page.getByText("Koncept docházky byl uložen do LuckyOS.", { exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Odevzdat", exact: true }).first().click();
    await page.getByText("Docházka byla odevzdána ke kontrole.", { exact: true }).waitFor();
    if (attendanceCommands.length !== 2 || attendanceCommands[0]?.action !== "save_draft" || attendanceCommands[1]?.action !== "submit") {
      throw new Error(`employee_hub_ui_attendance_commands:${JSON.stringify(attendanceCommands)}`);
    }

    await page.getByLabel("Celé hodiny", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).last().click();
    await page.getByText("Koncept malých čísel byl uložen do LuckyOS.", { exact: true }).waitFor();
    if (smallNumberCommands.length !== 1 || smallNumberCommands[0]?.hoursMinutes !== 150) {
      throw new Error(`employee_hub_ui_small_number_command:${JSON.stringify(smallNumberCommands)}`);
    }
    await assertNoOverflow(page, `${browserName}_desktop`);
    await assertAxeClean(page, `${browserName}_desktop`);
    await page.getByRole("button", { name: "Přenést akce do úkolů", exact: true }).click();
    await page.getByText("Do úkolů byla přenesena 1 nová akce.", { exact: true }).waitFor();
    if (SCREENSHOT_DIR) {
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${browserName}-employee-hub-desktop.png`,
        fullPage: true,
      });
      await page.locator("#profil").screenshot({
        path: `${SCREENSHOT_DIR}/${browserName}-employee-profile-desktop.png`,
      });
      await page.locator("#dochazka").screenshot({
        path: `${SCREENSHOT_DIR}/${browserName}-employee-attendance-desktop.png`,
      });
      await page.locator("#mala-cisla").screenshot({
        path: `${SCREENSHOT_DIR}/${browserName}-employee-small-numbers-desktop.png`,
      });
    }

    await page.goto(`${WEB}/prehled`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText("Můj stav", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Otevřít přehled", exact: true }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB}/zamestnanec`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Můj zaměstnanecký přehled", exact: true }).waitFor();
    const syncBox = await page
      .getByRole("button", { name: "Přenést akce do úkolů", exact: true })
      .boundingBox();
    if (!syncBox || syncBox.height < 44) {
      throw new Error(`employee_hub_ui_mobile_target:${JSON.stringify(syncBox)}`);
    }
    const profileLinkBox = await page.getByRole("link", { name: "Profil", exact: true }).boundingBox();
    if (!profileLinkBox || profileLinkBox.height < 44) {
      throw new Error(`employee_hub_ui_mobile_self_service_target:${JSON.stringify(profileLinkBox)}`);
    }
    await assertNoOverflow(page, `${browserName}_mobile`);
    await assertAxeClean(page, `${browserName}_mobile`);
    if (SCREENSHOT_DIR) {
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${browserName}-employee-hub-mobile.png`,
        fullPage: true,
      });
      await page.locator("#dochazka").screenshot({
        path: `${SCREENSHOT_DIR}/${browserName}-employee-attendance-mobile.png`,
      });
    }

    await page.goto(`${WEB}/prehled`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("button", { name: "Více", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Zaměstnanec", exact: true })
      .waitFor();
    if (runtimeErrors.length > 0) {
      throw new Error(`employee_hub_ui_runtime:${runtimeErrors.join(" | ")}`);
    }
    console.log(`  ✓ ${browserName}: gating, self-service, explicit submit, 390 px a axe`);
  } finally {
    await browser?.close();
    await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
    await db.delete(users).where(eq(users.id, fixture.userId));
  }
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nEmployee Hub + self-service UI: vše prošlo");
process.exit(0);
