/** Browser audit Integration Centeru v Chromium/WebKitu včetně lifecycle a mobilního reflow. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	auditEvents,
	and,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	users,
	workspaces,
} from "@watson/db";
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
	const projectId = crypto.randomUUID();
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
		await tx.insert(projects).values({
			id: projectId,
			workspaceId,
			ownerId: userId,
			name: "API Inbox",
		});
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
	});
	return { userId, workspaceId, projectId, email, password };
}

async function assertAxeClean(page: import("playwright").Page, label: string) {
	await page.evaluate(axe.source);
	const violations = await page.evaluate(async () => {
		const runner = (globalThis as unknown as { axe: typeof axe }).axe;
		const result = await runner.run(document, {
			runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
		});
		return result.violations.map((violation) => {
			const targets = violation.nodes
				.flatMap((node) => node.target.map((target) => String(target)))
				.slice(0, 4)
				.join("|");
			return `${violation.id}[${targets}]`;
		});
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
		// Landing Employee Hub may already have performed a real provider probe.
		// Both states are truthful; the verifier must not depend on request timing.
		await card.getByText(/^(Připraveno k testu|V pořádku)$/).waitFor();
		await emailCard.getByText("Připraveno k testu", { exact: true }).waitFor();
		await attachmentCard.getByText("Vestavěná služba.", { exact: true }).waitFor();
		const developer = page.locator(".w-developer");
		await developer.getByRole("heading", { name: "API a webhooky", exact: true }).waitFor();
		await developer.getByRole("button", { name: "Nový API klíč", exact: true }).click();
		await developer.getByLabel("Název napojení", { exact: true }).fill("UI reporting bridge");
		await developer.getByLabel("API Inbox", { exact: true }).check();
		await developer.getByRole("button", { name: "Vytvořit klíč", exact: true }).click();
		const apiSecret = developer.getByRole("status").filter({ hasText: "API token" });
		await apiSecret.waitFor();
		const bearer = await apiSecret.locator("code").innerText();
		if (!bearer.startsWith("wtn_live_")) throw new Error("developer_ui_api_token_contract");
		await apiSecret.getByRole("button", { name: "Mám bezpečně uloženo", exact: true }).click();
		await apiSecret.waitFor({ state: "hidden" });
		await developer.getByText("UI reporting bridge", { exact: true }).waitFor();

		await developer.getByRole("button", { name: "Nový webhook", exact: true }).click();
		await developer.getByLabel("Název napojení", { exact: true }).fill("UI delivery hook");
		await developer
			.getByLabel("HTTPS adresa příjemce", { exact: true })
			.fill("https://hooks.example.net/watson");
		await developer.getByLabel("API Inbox", { exact: true }).check();
		await developer.getByRole("button", { name: "Vytvořit webhook", exact: true }).click();
		const webhookSecret = developer.getByRole("status").filter({ hasText: "Webhook signing secret" });
		await webhookSecret.waitFor();
		if (!(await webhookSecret.locator("code").innerText()).startsWith("whsec_")) {
			throw new Error("developer_ui_webhook_secret_contract");
		}
		await webhookSecret.getByRole("button", { name: "Mám bezpečně uloženo", exact: true }).click();
		await developer.getByText("UI delivery hook", { exact: true }).waitFor();
		await developer.getByRole("button", { name: "Pozastavit", exact: true }).click();
		await developer.getByText("Pozastaven", { exact: true }).waitFor();
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await developer.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-developer-api-desktop.png` });
		}
		const manageMailAccounts = page.getByRole("button", { name: "Spravovat účty", exact: true });
		await manageMailAccounts.click();
		const mailDialog = page.getByRole("dialog", { name: "Osobní e-mailové účty", exact: true });
		await mailDialog.getByText("Zatím tu není žádný osobní účet.", { exact: true }).waitFor();
		await mailDialog.getByText("Gmail / Google Workspace", { exact: true }).waitFor();
		await mailDialog.getByText("Microsoft 365", { exact: true }).waitFor();
		await mailDialog.getByText("IMAP + SMTP", { exact: true }).waitFor();
		if ((await mailDialog.locator('input[type="password"]').count()) !== 0) {
			throw new Error("mail_accounts_ui_password_field_exposed");
		}
		const googleConnect = mailDialog.getByRole("button", { name: "Pokračovat", exact: true });
		if (await googleConnect.isDisabled()) throw new Error("mail_accounts_ui_google_not_configured");
		if ((await mailDialog.getByText("Připravujeme", { exact: true }).count()) !== 1) {
			throw new Error("mail_accounts_ui_unavailable_adapters_not_explicit");
		}
		const imapConnect = mailDialog.getByRole("button", { name: "Nastavit", exact: true });
		if ((await imapConnect.count()) !== 1 || (await imapConnect.isDisabled())) {
			throw new Error("mail_accounts_ui_imap_smtp_not_available");
		}
		await assertAxeClean(page, `${browserName}_mail_accounts_desktop`);
		await mailDialog.getByRole("button", { name: "Zavřít", exact: true }).click();
		await mailDialog.waitFor({ state: "hidden" });
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
		await developer.getByText("UI reporting bridge", { exact: true }).waitFor();
		if ((await page.getByText(bearer, { exact: true }).count()) !== 0) {
			throw new Error("developer_ui_api_token_persisted");
		}

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
		const developerButton = developer.getByRole("button", { name: "Nový API klíč", exact: true });
		await developerButton.scrollIntoViewIfNeeded();
		const developerButtonBox = await developerButton.boundingBox();
		if (!developerButtonBox || developerButtonBox.height < 44) {
			throw new Error(`developer_ui_mobile_target:${developerButtonBox?.height}`);
		}
		if (SCREENSHOT_DIR) {
			await developer.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-developer-api-390.png` });
		}
		await manageMailAccounts.click();
		await mailDialog.waitFor();
		const dialogBox = await mailDialog.boundingBox();
		if (!dialogBox || dialogBox.x < 0 || dialogBox.x + dialogBox.width > 390) {
			throw new Error(`mail_accounts_ui_mobile_dialog_clipped:${JSON.stringify(dialogBox)}`);
		}
		const mobileConnectBox = await mailDialog
			.getByRole("button", { name: "Pokračovat", exact: true })
			.boundingBox();
		if (!mobileConnectBox || mobileConnectBox.height < 44) {
			throw new Error(`mail_accounts_ui_mobile_target:${mobileConnectBox?.height}`);
		}
		const dialogOverflow = await mailDialog.evaluate(
			(node) => node.scrollWidth > node.clientWidth + 1,
		);
		if (dialogOverflow) throw new Error("mail_accounts_ui_mobile_overflow");
		await assertAxeClean(page, `${browserName}_mail_accounts_mobile`);
		if (SCREENSHOT_DIR) {
			await mailDialog.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-mail-accounts-390.png`,
			});
		}
		await mailDialog.getByRole("button", { name: "Zavřít", exact: true }).click();
		await mailDialog.waitFor({ state: "hidden" });
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
		console.log(`  ✓ ${browserName}: providery, osobní mail, lifecycle, mobile reflow a axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nIntegration Center UI checks passed.");
process.exit(0);
