/** F5 browser proof: real OAuth -> encrypted sync -> owner-only personal inbox UI. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	eq,
	getDb,
	mailAccounts,
	mailSyncStates,
	memberships,
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { scanMailSync } from "./src/mailSync";

const WEB = process.env.PERSONAL_MAIL_UI_WEB ?? "http://localhost:5173";
const STUB = process.env.MAIL_GOOGLE_API_BASE_URL ?? "http://127.0.0.1:8793";
const SCREENSHOT_DIR = process.env.PERSONAL_MAIL_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.PERSONAL_MAIL_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `personal-mail-ui-${browserName}-${suffix}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Personal Mail UI ${browserName}`,
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
			name: `Personal Mail UI ${browserName}`,
			ownerId: userId,
			isPersonal: true,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
	});
	return { userId, workspaceId, email, password };
}

async function resetMailbox(email: string) {
	const response = await fetch(`${STUB}/test/mailbox`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, action: "reset", count: 3 }),
	});
	if (!response.ok) throw new Error(`personal_mail_ui_provider_reset:${response.status}`);
}

async function drain(accountId: string) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		await scanMailSync();
		const state = (
			await db
				.select()
				.from(mailSyncStates)
				.where(eq(mailSyncStates.accountId, accountId))
				.limit(1)
		)[0];
		if (state?.status === "idle") return;
		if (state?.status === "dead" || state?.status === "reauth_required") {
			throw new Error(`personal_mail_ui_sync_${state.status}:${state.lastErrorCode}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("personal_mail_ui_sync_timeout");
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
	if (violations.length > 0) throw new Error(`personal_mail_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`personal_mail_ui_overflow_${label}`);
}

async function openPersonalInbox(page: Page, email: string) {
	const row = page.getByTitle(`${email} — owner-only osobní pošta`, { exact: true });
	await row.waitFor({ timeout: 30_000 });
	await row.locator("button").click();
	await page.locator("[data-personal-mail]").waitFor();
}

async function run(browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		await resetMailbox(fixture.email);
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const context = await browser.newContext({
			locale: "cs-CZ",
			reducedMotion: "reduce",
			viewport: { width: 1280, height: 800 },
		});
		const page = await context.newPage();
		const runtimeErrors: string[] = [];
		let expectedDetailFailure = false;
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() !== "error") return;
			if (expectedDetailFailure && message.text().includes("503")) {
				expectedDetailFailure = false;
				return;
			}
			runtimeErrors.push(message.text());
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
		await page.getByRole("button", { name: "Spravovat účty", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Osobní e-mailové účty", exact: true });
		await dialog.getByRole("button", { name: "Pokračovat", exact: true }).click();
		await page.waitForURL(/\/mail(?:\?|$)/, { timeout: 30_000 });

		const account = (
			await db
				.select()
				.from(mailAccounts)
				.where(eq(mailAccounts.ownerUserId, fixture.userId))
				.limit(1)
		)[0];
		if (!account) throw new Error("personal_mail_ui_account_missing");
		await drain(account.id);
		await page.reload({ waitUntil: "domcontentloaded" });
		await openPersonalInbox(page, fixture.email);

		const workspace = page.locator("[data-personal-mail]");
		await workspace.getByText("3 zpráv · 1 nepřečtených", { exact: false }).waitFor();
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).waitFor();
		if ((await workspace.getByText(/Text zprávy \d/).count()) !== 0) {
			throw new Error("personal_mail_ui_body_leaked_in_summary");
		}
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).click();
		await workspace.getByText("Text zprávy 3. Token sem nikdy nepatří.", { exact: true }).waitFor();
		await workspace.getByText("Surové HTML, tracking pixely a vzdálené obrázky se nespouštějí.", { exact: false }).waitFor();
		if ((await workspace.getByRole("button", { name: /Odpovědět|Přeposlat|Archivovat/ }).count()) !== 0) {
			throw new Error("personal_mail_ui_demo_action_exposed");
		}
		await assertNoOverflow(page, `${browserName}_desktop`);
		await assertAxeClean(page, `${browserName}_desktop`);

		expectedDetailFailure = true;
		await page.route(/\/api\/mail\/accounts\/[^/]+\/messages\/[^/?]+$/, async (route) => {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"mail_message_unavailable"}' });
		});
		await workspace.getByText("Synchronizovaná zpráva 2", { exact: true }).click();
		await workspace.getByText("Detail zprávy se nepodařilo bezpečně načíst.", { exact: true }).waitFor();
		await page.unroute(/\/api\/mail\/accounts\/[^/]+\/messages\/[^/?]+$/);
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).click();
		await workspace.getByText("Text zprávy 3. Token sem nikdy nepatří.", { exact: true }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(page, `${browserName}_mobile_detail`);
		const back = workspace.getByRole("button", { name: "← Zpět na zprávy", exact: true });
		const backBox = await back.boundingBox();
		if (!backBox || backBox.height < 44) throw new Error(`personal_mail_ui_mobile_back:${backBox?.height}`);
		await assertAxeClean(page, `${browserName}_mobile_detail`);
		await back.click();
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).waitFor();
		await assertNoOverflow(page, `${browserName}_mobile_list`);
		await assertAxeClean(page, `${browserName}_mobile_list`);

		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await workspace.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-personal-inbox-390.png` });
		}
		if (runtimeErrors.length > 0) {
			throw new Error(`personal_mail_ui_runtime:${runtimeErrors.join(" | ")}`);
		}
		console.log(`  ✓ ${browserName}: real OAuth, encrypted sync, lazy detail, failure state, mobile reflow and axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nPersonal Mail UI checks passed.");
process.exit(0);
