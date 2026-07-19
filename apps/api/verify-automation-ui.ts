/** F6 browser audit automatizací: create → preview → publish, historie, mobil a WCAG. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const WEB = process.env.AUTOMATION_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.AUTOMATION_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.AUTOMATION_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `automation-ui-${browserName}-${stamp}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({ id: userId, name: `Automation UI ${browserName}`, email, emailVerified: true });
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name: `Automation UI ${browserName}`,
			ownerId: userId,
			isPersonal: false,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
		await tx.insert(projects).values({
			id: projectId,
			workspaceId,
			ownerId: userId,
			name: "Projekt automatizací",
		});
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
		await tx.insert(tasks).values({
			id: taskId,
			projectId,
			name: "Úkol pro bezpečný preview",
			priority: 2,
			createdBy: userId,
		});
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
		return result.violations.map((violation) => `${violation.id}:${violation.nodes[0]?.target.join("|")}`);
	});
	if (violations.length) throw new Error(`automation_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
	if (overflow) throw new Error(`automation_ui_overflow_${label}`);
}

async function run(browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const context = await browser.newContext({ locale: "cs-CZ", reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
		const page = await context.newPage();
		const runtimeErrors: string[] = [];
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && !message.text().includes("503")) runtimeErrors.push(message.text());
		});
		await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
		await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
		await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.goto(`${WEB}/postupy?view=automation`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("heading", { name: "Automatizace", exact: true }).waitFor();
		await page.getByText("Zatím žádné pravidlo", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_empty`);

		await page.getByRole("button", { name: "+ Nové pravidlo", exact: true }).click();
		await page.getByRole("dialog", { name: "Nové pravidlo" }).waitFor();
		await page.getByLabel("Název pravidla").fill("Po dokončení nastav následný krok");
		await page.getByRole("checkbox", { name: /Změnit prioritu/ }).check();
		await page.getByLabel("Nová priorita").selectOption("1");
		await page.getByRole("checkbox", { name: /Přidat komentář/ }).check();
		await page.getByLabel("Text automatického komentáře").fill("Automaticky připravte závěrečný report.");
		await assertAxeClean(page, `${browserName}_builder`);
		await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
		await page.getByRole("dialog", { name: "Automatizace Po dokončení nastav následný krok" }).waitFor({ timeout: 30_000 });
		await page.getByText("NEPUBLIKOVÁNO", { exact: true }).waitFor();

		await page.getByLabel("Úkol pro preview").selectOption({ label: "Úkol pro bezpečný preview" });
		await page.getByRole("button", { name: "Spustit preview", exact: true }).click();
		await page.getByText("2 navržené změny", { exact: true }).waitFor();
		await page.getByText(/Preview nic nezměnil/).waitFor();
		await page.getByRole("button", { name: "Publikovat v1", exact: true }).click();
		await page.getByText("PUBLIKOVÁNO v1", { exact: true }).waitFor({ timeout: 30_000 });
		await page.getByText("Žádný běh. Preview se do historie nepočítá, protože nic nemění.", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_detail`);
		await page.getByRole("button", { name: "Zavřít", exact: true }).click();
		await page.getByText("v1", { exact: true }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(page, `${browserName}_390_list`);
		const createBox = await page.getByRole("button", { name: "+ Nové pravidlo", exact: true }).boundingBox();
		if (!createBox || createBox.height < 44) throw new Error(`automation_ui_create_target:${createBox?.height}`);
		await page.getByRole("button", { name: "+ Nové pravidlo", exact: true }).click();
		await assertNoOverflow(page, `${browserName}_390_builder`);
		if (await page.locator("[data-action-toast]").count()) throw new Error(`automation_ui_passive_toast_blocks_next_action_${browserName}`);
		const saveBox = await page.getByRole("button", { name: "Uložit koncept", exact: true }).boundingBox();
		if (!saveBox || saveBox.height < 44) throw new Error(`automation_ui_save_target:${saveBox?.height}`);
		await assertAxeClean(page, `${browserName}_390_builder`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-automation-390.png`, fullPage: true });
		}
		await page.keyboard.press("Escape");
		await page.getByRole("dialog", { name: "Nové pravidlo" }).waitFor({ state: "detached" });
		if (runtimeErrors.length) throw new Error(`automation_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(`  ✓ ${browserName}: create, preview, publish, history, 390 px and axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nRules & Automation UI checks passed.");
process.exit(0);
