/** Browser audit Integration Centeru v Chromium/WebKitu včetně lifecycle a mobilního reflow. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import { accounts, auditEvents, and, eq, getDb, memberships, users, workspaces } from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, webkit } from "playwright";

const WEB = process.env.INTEGRATIONS_UI_WEB ?? "http://localhost:5173";
const API = process.env.INTEGRATIONS_UI_API ?? "http://localhost:8790";
const SCREENSHOT_DIR = process.env.INTEGRATIONS_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.INTEGRATIONS_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `integrations-ui-${browserName}-${suffix}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Integrations UI ${browserName}`,
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
			name: `Integrations UI ${browserName}`,
			ownerId: userId,
			isPersonal: true,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
	});
	return { userId, workspaceId, email, password };
}

async function assertAxeClean(page: import("playwright").Page, label: string) {
	await page.evaluate(axe.source);
	const violations = await page.evaluate(async () => {
		const runner = (globalThis as unknown as { axe: typeof axe }).axe;
		const result = await runner.run(document, {
			runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
		});
		return result.violations.map((violation) => violation.id);
	});
	if (violations.length) throw new Error(`integration_ui_axe_${label}:${violations.join(",")}`);
}

async function run(browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const context = await browser.newContext({ locale: "cs-CZ", reducedMotion: "reduce" });
		const page = await context.newPage();
		const runtimeErrors: string[] = [];
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") runtimeErrors.push(message.text());
		});
		await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
		await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
		await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.goto(`${WEB}/nastaveni?sekce=integrace`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.getByRole("heading", { name: "Propojené služby", exact: true }).waitFor();
		const card = page.getByRole("article").filter({ hasText: "LuckyOS" });
		const emailCard = page.getByRole("article").filter({ hasText: "E-mailové připomínky" });
		const attachmentCard = page.getByRole("article").filter({ hasText: "Přílohy Watson" });
		await card.getByText("Připraveno k testu", { exact: true }).waitFor();
		await emailCard.getByText("Připraveno k testu", { exact: true }).waitFor();
		await attachmentCard.getByText("Vestavěná služba.", { exact: true }).waitFor();
		await card.getByText("Co propojení smí", { exact: true }).click();
		for (const permission of [
			"Ověřit identitu zaměstnance",
			"Číst stav, termíny a upozornění zaměstnance",
			"Odesílat zaměstnanecké formuláře",
			"Předávat přílohy do vyhrazeného LuckyOS Drive",
		]) {
			await card.getByText(permission, { exact: true }).waitFor();
		}
		await card.getByRole("button", { name: "Otestovat spojení", exact: true }).click();
		await card.getByText("V pořádku", { exact: true }).waitFor();
		await page.getByText("Spojení s LuckyOS bylo ověřeno.", { exact: true }).waitFor();
		await emailCard.getByRole("button", { name: "Otestovat spojení", exact: true }).click();
		await emailCard.getByText("V pořádku", { exact: true }).waitFor();
		await page.getByText("Testovací e-mail provider přijal.", { exact: true }).waitFor();
		await attachmentCard.getByRole("button", { name: "Otestovat spojení", exact: true }).click();
		await attachmentCard.getByText("V pořádku", { exact: true }).waitFor();
		await page.getByText("Úložiště příloh bylo ověřeno.", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_desktop`);
		await page.goto(`${WEB}/nastaveni?sekce=oznameni`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.getByText("Zatím neaktivní", { exact: true }).waitFor();
		await page.getByText("Nastavení u úkolu", { exact: true }).waitFor();
		if ((await page.getByRole("switch").count()) !== 0)
			throw new Error("notification_settings_fake_switch");
		await assertAxeClean(page, `${browserName}_notifications`);
		await page.goto(`${WEB}/nastaveni?sekce=integrace`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await card.getByText("V pořádku", { exact: true }).waitFor();

		await card.getByRole("button", { name: "Odpojit", exact: true }).click();
		const confirmation = card.getByRole("alert").filter({ hasText: "Odpojit LuckyOS od Watsonu?" });
		await confirmation.waitFor();
		await confirmation.getByRole("button", { name: "Zrušit", exact: true }).click();
		await confirmation.waitFor({ state: "hidden" });
		await card.getByRole("button", { name: "Odpojit", exact: true }).click();
		await confirmation.getByRole("button", { name: "Ano, odpojit", exact: true }).click();
		await card.getByText("Odpojeno", { exact: true }).waitFor();
		const blocked = await page.evaluate(async (api) => {
			const response = await fetch(`${api}/api/employee/me`, {
				credentials: "include",
			});
			return response.json();
		}, API);
		if ((blocked as { reason?: string }).reason !== "luckyos_revoked") {
			throw new Error(`integration_ui_broker_not_revoked:${JSON.stringify(blocked)}`);
		}
		await page.reload({ waitUntil: "domcontentloaded" });
		await card.getByText("Odpojeno", { exact: true }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload({ waitUntil: "domcontentloaded" });
		await card.getByText("Odpojeno", { exact: true }).waitFor();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		);
		if (overflow) throw new Error("integration_ui_mobile_overflow");
		const activeSection = await page
			.getByRole("link", { name: "Integrace a pošta", exact: true })
			.boundingBox();
		if (!activeSection || activeSection.x < 0 || activeSection.x + activeSection.width > 390) {
			throw new Error(`integration_ui_active_section_clipped:${JSON.stringify(activeSection)}`);
		}
		const headerTitle = page.locator("header").getByText("Nastavení", { exact: true }).first();
		const headerTitleMetrics = await headerTitle.evaluate((node) => ({
			clientWidth: node.clientWidth,
			scrollWidth: node.scrollWidth,
			headerScrollLeft: node.closest("header")?.scrollLeft ?? 0,
		}));
		if (
			headerTitleMetrics.scrollWidth > headerTitleMetrics.clientWidth + 1 ||
			headerTitleMetrics.headerScrollLeft !== 0
		) {
			throw new Error(`integration_ui_header_clipped:${JSON.stringify(headerTitleMetrics)}`);
		}
		const reconnect = card.getByRole("button", { name: "Znovu připojit", exact: true });
		const box = await reconnect.boundingBox();
		if (!box || box.height < 44) throw new Error(`integration_ui_mobile_target:${box?.height}`);
		await assertAxeClean(page, `${browserName}_mobile`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-integration-center-390.png`,
				fullPage: true,
			});
			await emailCard.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-email-card-390.png`,
			});
			await attachmentCard.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-attachment-card-390.png`,
			});
		}
		await reconnect.click();
		await card.getByText("V pořádku", { exact: true }).waitFor();
		const audits = await db
			.select({ action: auditEvents.action })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, fixture.workspaceId),
					eq(auditEvents.entity, "integration_connection"),
				),
			);
		if (audits.length !== 5) throw new Error(`integration_ui_audit:${JSON.stringify(audits)}`);
		if (runtimeErrors.length > 0) {
			throw new Error(`integration_ui_runtime:${runtimeErrors.join(" | ")}`);
		}
		console.log(`  ✓ ${browserName}: tři providery, health, revoke/reconnect, mobile reflow a axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nIntegration Center UI checks passed.");
process.exit(0);
