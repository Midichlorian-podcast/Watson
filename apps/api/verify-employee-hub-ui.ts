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

function multipartField(body: Buffer, field: string) {
  const value = body
    .toString("utf8")
    .match(new RegExp(`name="${field}"\\r\\n\\r\\n([^\\r\\n]+)`))?.[1];
  return value ?? null;
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
    const lifecycleCommands: Array<Record<string, unknown>> = [];
    const lifecycleFileCommands: Buffer[] = [];
    let lifecycleVersion = 1;
    let lifecycleCompleted: string[] = [];
    const absenceCommands: Array<Record<string, unknown>> = [];
    const documentCommands: Buffer[] = [];
    const expenseCommands: Buffer[] = [];
    const contractCommands: Array<Record<string, unknown>> = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    const ignoreIntentional502 = () => {
      const index = runtimeErrors.findIndex((message) => message.includes("status of 502"));
      if (index >= 0) runtimeErrors.splice(index, 1);
    };
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
    await page.route(/\/api\/employee\/self-service\/lifecycle\/respond-file(?:\?|$)/, async (route) => {
      lifecycleFileCommands.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
      lifecycleVersion += 1;
      lifecycleCompleted = [...new Set([...lifecycleCompleted, "identity_document"])];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ instance: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "submitted", version: lifecycleVersion }, replayed: false }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/lifecycle\/respond(?:\?|$)/, async (route) => {
      lifecycleCommands.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      if (lifecycleCommands.length === 1) {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "luckyos_unavailable" }) });
        return;
      }
      lifecycleVersion += 1;
      lifecycleCompleted = [...new Set([...lifecycleCompleted, "code_of_conduct"])];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ instance: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "in_progress", version: lifecycleVersion }, replayed: false }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/lifecycle(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          instances: [{
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            type: "onboarding",
            status: lifecycleCompleted.length === 2 ? "submitted" : lifecycleCompleted.length ? "in_progress" : "invited",
            title: "Dokončení nástupu",
            items: [
              { key: "code_of_conduct", label: "Pravidla spolupráce", description: "Potvrď, že ses s pravidly seznámil(a).", suggestedResponseType: "confirmation", completed: lifecycleCompleted.includes("code_of_conduct") },
              { key: "identity_document", label: "Doklad totožnosti", description: null, suggestedResponseType: "file", completed: lifecycleCompleted.includes("identity_document") },
            ],
            completedCount: lifecycleCompleted.length,
            totalCount: 2,
            dueAt: "2026-07-31T20:00:00.000Z",
            submittedAt: lifecycleCompleted.length === 2 ? "2026-07-17T11:00:00.000Z" : null,
            completedAt: null,
            cancelledAt: null,
            version: lifecycleVersion,
            createdAt: "2026-07-17T08:00:00.000Z",
            updatedAt: "2026-07-17T10:30:00.000Z",
          }],
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/absences(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        absenceCommands.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
        if (absenceCommands.length === 1) {
          await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ error: "luckyos_unavailable" }),
          });
          return;
        }
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          body: JSON.stringify({ absence: { id: "absence-upload-ui" }, replayed: false }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          cases: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              kind: "vacation",
              startDate: "2026-08-10",
              endDate: "2026-08-12",
              timezone: "Europe/Prague",
              visibility: "team",
              status: "resolved",
              priority: "normal",
              resolutionPublic: "Schváleno vedoucím",
              version: 2,
              createdAt: "2026-07-16T08:00:00.000Z",
              updatedAt: "2026-07-17T08:00:00.000Z",
            },
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              kind: "doctor",
              startDate: "2026-08-18",
              endDate: "2026-08-18",
              timezone: "Europe/Prague",
              visibility: "private",
              status: "in_review",
              priority: "normal",
              resolutionPublic: null,
              version: 1,
              createdAt: "2026-07-17T08:00:00.000Z",
              updatedAt: "2026-07-17T08:00:00.000Z",
            },
          ],
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/documents(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        documentCommands.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
        if (documentCommands.length === 1) {
          await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "luckyos_unavailable" }) });
          return;
        }
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ document: { id: "document-upload-ui" }, replayed: false }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          documents: [{
            id: "document-ui", type: "bank_account_confirmation", fileName: "potvrzeni.pdf",
            fileType: "application/pdf", fileSizeBytes: 1234, fileSha256: "a".repeat(64),
            note: null, reviewStatus: "pending", reviewNote: null, validFrom: "2026-07-01",
            validUntil: null, createdAt: "2026-07-16T08:00:00.000Z", updatedAt: "2026-07-16T08:00:00.000Z",
          }],
          publishedDocuments: [{
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", documentType: "payslip",
            periodYear: 2026, periodMonth: 6, title: "Výplatní páska červen", version: 1,
            fileName: "vyplatni-paska.pdf", mimeType: "application/pdf", sizeBytes: 4321,
            sha256: "b".repeat(64), publishedAt: "2026-07-15T08:00:00.000Z", updatedAt: "2026-07-15T08:00:00.000Z",
          }, {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", documentType: "contract",
            periodYear: 2026, periodMonth: null, title: "Dohoda o provedení práce", version: 4,
            fileName: "dpp.pdf", mimeType: "application/pdf", sizeBytes: 8765,
            publishedAt: "2026-07-16T08:00:00.000Z", updatedAt: "2026-07-16T08:00:00.000Z",
          }],
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/expenses(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        expenseCommands.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ claim: { id: "expense-upload-ui" }, replayed: false }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          claims: [{
            id: "expense-ui", title: "Jízdenka Brno", amount: 240, currency: "CZK", amountCzk: 240,
            exchangeRate: null, date: "2026-07-16", paymentSource: "personal_card", category: "transport",
            note: null, reimbursementSource: "accounting", status: "submitted", reviewerNote: null,
            reimbursedAt: null, receipt: { fileName: "jizdenka.pdf", mimeType: "application/pdf", sha256: "c".repeat(64) },
            createdAt: "2026-07-16T08:00:00.000Z", updatedAt: "2026-07-16T08:00:00.000Z",
          }],
          trainerProjects: [{ id: "trainer-project-ui", name: "Letní soustředění", status: "active", reviewStatus: "approved" }],
          fetchedAt: "2026-07-17T10:30:00.000Z",
        }),
      });
    });
    await page.route(/\/api\/employee\/self-service\/contracts\/sign(?:\?|$)/, async (route) => {
      contractCommands.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      if (contractCommands.length === 1) {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "contract_finalization_failed" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contract: { id: "contract-ui", workflowStatus: "signed" }, replayed: false }) });
    });
    await page.route(/\/api\/employee\/self-service\/contracts(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          contracts: [{
            id: "contract-ui", version: 4, type: "dpp", title: "Dohoda o provedení práce",
            validFrom: "2026-07-01", validUntil: "2026-12-31", status: "draft",
            workflowStatus: "sent_to_employee", signedDate: null, fileName: "dpp.pdf",
            finalPdfSha256: null, lockedAt: null, canSign: true, updatedAt: "2026-07-16T08:00:00.000Z",
          }],
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
    await page.getByRole("heading", { name: "Nástupní a výstupní postupy", exact: true }).waitFor();
		const maskedAccount = await page.getByLabel("Bankovní účet", { exact: false }).getAttribute("placeholder");
    if (maskedAccount !== "•••• 0100") throw new Error(`employee_hub_ui_bank_mask:${maskedAccount}`);

    await page.getByLabel("Telefon", { exact: true }).fill("+420 777 333 444");
    await page.getByRole("button", { name: "Odeslat žádost o změnu", exact: true }).click();
    await page.getByText("Uložení se nepodařilo.", { exact: false }).waitFor();
    ignoreIntentional502();
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

    const lifecyclePanel = page.locator("#nastup-a-odchod");
    await lifecyclePanel.getByText("Dokončení nástupu", { exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await lifecyclePanel.getByRole("button", { name: "Potvrdit tento krok", exact: true }).click();
    await page.getByText("Krok se nepodařilo potvrdit.", { exact: false }).waitFor();
    ignoreIntentional502();
    page.once("dialog", (dialog) => dialog.accept());
    await lifecyclePanel.getByRole("button", { name: "Potvrdit tento krok", exact: true }).click();
    await page.getByText("Krok byl bezpečně odeslán do LuckyOS.", { exact: true }).waitFor();
    if (
      lifecycleCommands.length !== 2 ||
      lifecycleCommands[0]?.operationId !== lifecycleCommands[1]?.operationId ||
      lifecycleCommands[0]?.lifecycleType !== "onboarding" ||
      lifecycleCommands[0]?.itemKey !== "code_of_conduct" ||
      lifecycleCommands[0]?.confirmed !== true ||
      "providerPersonId" in (lifecycleCommands[0] ?? {}) ||
      "scopes" in (lifecycleCommands[0] ?? {})
    ) throw new Error(`employee_hub_ui_lifecycle_retry:${JSON.stringify(lifecycleCommands)}`);
    await lifecyclePanel.locator('option[value="identity_document"]').waitFor({ state: "attached" });
    if (SCREENSHOT_DIR) {
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      await lifecyclePanel.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-lifecycle-next-step.png` });
    }
    await lifecyclePanel.locator("select").nth(1).selectOption("file");
    await lifecyclePanel.locator('input[type="file"]').setInputFiles({
      name: "doklad.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nWatson lifecycle UI\n%%EOF\n", "utf8"),
    });
    page.once("dialog", (dialog) => dialog.accept());
    await lifecyclePanel.getByRole("button", { name: "Potvrdit tento krok", exact: true }).click();
    await page.getByText("Všechny požadované kroky jsou odevzdané.", { exact: false }).waitFor();
    if (
      lifecycleFileCommands.length !== 1 ||
      multipartField(lifecycleFileCommands[0] ?? Buffer.alloc(0), "lifecycleType") !== "onboarding" ||
      multipartField(lifecycleFileCommands[0] ?? Buffer.alloc(0), "itemKey") !== "identity_document" ||
      multipartField(lifecycleFileCommands[0] ?? Buffer.alloc(0), "expectedVersion") !== "2"
    ) throw new Error(`employee_hub_ui_lifecycle_file:${lifecycleFileCommands[0]?.toString("utf8")}`);

    await page.getByRole("heading", { name: "Dovolená a absence", exact: true }).waitFor();
    const absencesPanel = page.locator("#absence");
    await absencesPanel.locator("select").selectOption("vacation");
    await absencesPanel.getByLabel("První den", { exact: true }).fill("2026-08-20");
    await absencesPanel.getByLabel("Poslední den", { exact: true }).fill("2026-08-22");
    await absencesPanel
      .getByLabel("Poznámka pro oprávněnou osobu v LuckyOS (volitelně)", { exact: true })
      .fill("Rodinná dovolená");
    await absencesPanel.getByRole("checkbox").check();
    page.once("dialog", (dialog) => dialog.accept());
    await absencesPanel.getByRole("button", { name: "Odeslat žádost", exact: true }).click();
    await page.getByText("Žádost se nepodařilo potvrdit.", { exact: false }).waitFor();
    ignoreIntentional502();
    page.once("dialog", (dialog) => dialog.accept());
    await absencesPanel.getByRole("button", { name: "Odeslat žádost", exact: true }).click();
    await page.getByText("Žádost byla bezpečně odeslána do LuckyOS.", { exact: true }).waitFor();
    if (
      absenceCommands.length !== 2 ||
      absenceCommands[0]?.operationId !== absenceCommands[1]?.operationId ||
      absenceCommands[0]?.kind !== "vacation" ||
      absenceCommands[0]?.startDate !== "2026-08-20" ||
      absenceCommands[0]?.endDate !== "2026-08-22" ||
      absenceCommands[0]?.visibility !== "private" ||
      absenceCommands[0]?.note !== "Rodinná dovolená" ||
      typeof absenceCommands[0]?.timezone !== "string" ||
      "priority" in (absenceCommands[0] ?? {}) ||
      "personId" in (absenceCommands[0] ?? {}) ||
      "scopes" in (absenceCommands[0] ?? {})
    ) throw new Error(`employee_hub_ui_absence_retry:${JSON.stringify(absenceCommands)}`);

    await page.getByRole("heading", { name: "Dokumenty a oficiální soubory", exact: true }).waitFor();
    await page.getByText("Výplatní páska červen", { exact: true }).waitFor();
    const pdf = {
      name: "potvrzeni.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nWatson employee UI\n%%EOF\n", "utf8"),
    };
    const documentsPanel = page.locator("#dokumenty");
    await documentsPanel.getByLabel("Soubor", { exact: true }).setInputFiles(pdf);
    await documentsPanel.locator("select").first().selectOption("bank_account_confirmation");
    await documentsPanel.getByLabel("Poznámka (volitelně)", { exact: true }).fill("Potvrzení účtu");
    await documentsPanel.getByRole("button", { name: "Nahrát ke kontrole", exact: true }).click();
    await page.getByText("Akci se nepodařilo potvrdit.", { exact: false }).waitFor();
    ignoreIntentional502();
    await documentsPanel.getByRole("button", { name: "Nahrát ke kontrole", exact: true }).click();
    await page.getByText("Dokument byl bezpečně předán do LuckyOS ke kontrole.", { exact: true }).waitFor();
    if (
      documentCommands.length !== 2 ||
      multipartField(documentCommands[0] ?? Buffer.alloc(0), "operationId") !==
        multipartField(documentCommands[1] ?? Buffer.alloc(0), "operationId") ||
      multipartField(documentCommands[0] ?? Buffer.alloc(0), "type") !== "bank_account_confirmation"
    ) throw new Error(`employee_hub_ui_document_retry:${documentCommands.map((body) => body.length).join(",")}`);

    await page.getByRole("heading", { name: "Výdaje a účtenky", exact: true }).waitFor();
    const expensesPanel = page.locator("#vydaje");
    await expensesPanel.getByLabel("Co bylo zaplaceno", { exact: true }).fill("Jízdenka Brno");
    await expensesPanel.getByLabel("Datum výdaje", { exact: true }).fill("2026-07-16");
    await expensesPanel.getByLabel("Částka", { exact: true }).fill("240");
    await expensesPanel.locator("select").nth(3).selectOption("trainer_fund");
    await expensesPanel.locator("select").nth(4).selectOption("trainer-project-ui");
    await expensesPanel.getByLabel("Účtenka nebo doklad", { exact: true }).setInputFiles(pdf);
    await expensesPanel.getByRole("button", { name: "Odeslat výdaj ke kontrole", exact: true }).click();
    await page.getByText("Výdaj a doklad byly bezpečně odeslány do LuckyOS.", { exact: true }).waitFor();
    if (
      expenseCommands.length !== 1 ||
      multipartField(expenseCommands[0] ?? Buffer.alloc(0), "title") !== "Jízdenka Brno" ||
      multipartField(expenseCommands[0] ?? Buffer.alloc(0), "trainerProjectId") !== "trainer-project-ui"
    ) throw new Error(`employee_hub_ui_expense_command:${expenseCommands[0]?.toString("utf8")}`);

    await page.getByRole("heading", { name: "Smlouvy a elektronický podpis", exact: true }).waitFor();
    await page.getByRole("button", { name: "Zkontrolovat a podepsat", exact: true }).click();
    await page.getByRole("link", { name: "Otevřít PDF smlouvy", exact: true }).waitFor();
    await page.getByLabel("Celé jméno", { exact: true }).fill("Eva Testovací");
    await page.getByLabel("Datum narození", { exact: true }).fill("1990-01-02");
    await page.getByLabel("Poslední 4 číslice čísla účtu", { exact: true }).fill("0100");
    await page.getByLabel("Nahrát PNG/JPG podpis", { exact: true }).setInputFiles({
      name: "podpis.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YKx7QAAAABJRU5ErkJggg==", "base64"),
    });
    await page.locator("#smlouvy").getByRole("checkbox").check();
    if (SCREENSHOT_DIR) {
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      await page.locator("#smlouvy").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-contract-sign-desktop.png` });
    }
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Elektronicky podepsat", exact: true }).click();
    await page.getByText("Finální dokument se nepodařilo bezpečně vytvořit", { exact: false }).waitFor();
    ignoreIntentional502();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Elektronicky podepsat", exact: true }).click();
    await page.getByText("Smlouva byla podepsána a finální dokument vznikl v LuckyOS.", { exact: true }).waitFor();
    if (
      contractCommands.length !== 2 || contractCommands[0]?.operationId !== contractCommands[1]?.operationId ||
      contractCommands[0]?.expectedVersion !== 4 || contractCommands[0]?.consent !== true ||
      contractCommands[0]?.bankAccountSuffix !== "0100" ||
      !String(contractCommands[0]?.signatureDataUrl).startsWith("data:image/png;base64,")
    ) throw new Error(`employee_hub_ui_contract_retry:${JSON.stringify(contractCommands)}`);
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
      await page.locator("#nastup-a-odchod").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-lifecycle-desktop.png` });
      await page.locator("#absence").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-absences-desktop.png` });
      await page.locator("#dokumenty").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-documents-desktop.png` });
      await page.locator("#vydaje").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-expenses-desktop.png` });
      await page.locator("#smlouvy").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-contracts-desktop.png` });
    }

    await page.goto(`${WEB}/prehled`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText("Můj stav", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Otevřít přehled", exact: true }).waitFor();

    await page.goto(`${WEB}/postupy`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Moje zaměstnanecké postupy", exact: true }).waitFor();
    await page.getByText("Dokončení nástupu", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Otevřít moje kroky", exact: true }).waitFor();
    await assertNoOverflow(page, `${browserName}_procedures`);
    await assertAxeClean(page, `${browserName}_procedures`);
    if (SCREENSHOT_DIR) {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-procedures-desktop.png`, fullPage: true });
    }

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
    const documentsLinkBox = await page.getByRole("link", { name: "Dokumenty", exact: true }).boundingBox();
    if (!documentsLinkBox || documentsLinkBox.height < 44) {
      throw new Error(`employee_hub_ui_mobile_documents_target:${JSON.stringify(documentsLinkBox)}`);
    }
    const absencesLinkBox = await page.getByRole("link", { name: "Dovolená a absence", exact: true }).boundingBox();
    if (!absencesLinkBox || absencesLinkBox.height < 44) {
      throw new Error(`employee_hub_ui_mobile_absences_target:${JSON.stringify(absencesLinkBox)}`);
    }
    const lifecycleLinkBox = await page.getByRole("link", { name: "Nástup a odchod", exact: true }).boundingBox();
    if (!lifecycleLinkBox || lifecycleLinkBox.height < 44) {
      throw new Error(`employee_hub_ui_mobile_lifecycle_target:${JSON.stringify(lifecycleLinkBox)}`);
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
      await page.locator("#nastup-a-odchod").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-lifecycle-mobile.png` });
      await page.locator("#absence").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-absences-mobile.png` });
      await page.locator("#dokumenty").screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-employee-documents-mobile.png` });
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
