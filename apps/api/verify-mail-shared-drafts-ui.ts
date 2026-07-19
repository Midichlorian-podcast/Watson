/** Browser proof: explicit draft share -> CAS edit -> approval -> exact owner send. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	eq,
	getDb,
	mailAccounts,
	mailOutboundMessages,
	memberships,
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { scanMailOutbound } from "./src/mailOutbound";

const WEB = process.env.PERSONAL_MAIL_UI_WEB ?? "http://localhost:5173";
const STUB = process.env.MAIL_GOOGLE_API_BASE_URL ?? "http://127.0.0.1:8793";
const SCREENSHOT_DIR = process.env.MAIL_SHARED_DRAFT_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.MAIL_SHARED_DRAFT_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function person(label: string, suffix: string) {
	const id = crypto.randomUUID();
	const email = `mail-shared-ui-${label}-${suffix}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	const name = `${label[0]?.toUpperCase()}${label.slice(1)} ${suffix.slice(-5)}`;
	await db.insert(users).values({ id, name, email, emailVerified: true });
	await db.insert(accounts).values({
		id: crypto.randomUUID(), userId: id, accountId: email, providerId: "credential",
		password: await hashPassword(password),
	});
	return { id, name, email, password };
}

async function provision(browserName: string) {
	const suffix = `${browserName}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
	const owner = await person("vlastnik", suffix);
	const editor = await person("editor", suffix);
	const approver = await person("schvalovatel", suffix);
	const personalWorkspaceId = crypto.randomUUID();
	const teamWorkspaceId = crypto.randomUUID();
	await db.transaction(async (tx) => {
		await tx.insert(workspaces).values([
			{ id: personalWorkspaceId, name: `Osobní ${browserName}`, ownerId: owner.id, isPersonal: true },
			{ id: teamWorkspaceId, name: `Odpovědi ${browserName}`, ownerId: owner.id, isPersonal: false },
		]);
		await tx.insert(memberships).values([
			{ workspaceId: personalWorkspaceId, userId: owner.id, role: "admin" },
			{ workspaceId: teamWorkspaceId, userId: owner.id, role: "admin" },
			{ workspaceId: teamWorkspaceId, userId: editor.id, role: "member" },
			{ workspaceId: teamWorkspaceId, userId: approver.id, role: "manager" },
		]);
	});
	return { owner, editor, approver, personalWorkspaceId, teamWorkspaceId };
}

async function login(page: Page, fixture: { email: string; password: string }) {
	await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
	await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
	await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
	await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
	await page.waitForSelector("main", { timeout: 30_000 });
}

async function openPersonalArea(page: Page) {
	await page.goto(`${WEB}/mail`, { waitUntil: "domcontentloaded", timeout: 30_000 });
	const row = page.locator('[title$="— owner-only osobní pošta"]');
	await row.waitFor({ timeout: 30_000 });
	await row.locator("button").click();
	await page.locator("[data-personal-mail]").waitFor();
}

async function connectOwner(page: Page) {
	await page.goto(`${WEB}/nastaveni?sekce=integrace`, { waitUntil: "domcontentloaded", timeout: 30_000 });
	await page.getByRole("button", { name: "Spravovat účty", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Osobní e-mailové účty", exact: true });
	await dialog.getByRole("button", { name: "Pokračovat", exact: true }).click();
	await page.waitForURL(/\/mail(?:\?|$)/, { timeout: 30_000 });
}

async function openSharedDrafts(page: Page) {
	await page.locator("[data-personal-shared-drafts]").click();
	const dialog = page.getByRole("dialog", { name: "Sdílené koncepty a schválení", exact: true });
	await dialog.waitFor();
	return dialog;
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
	if (violations.length > 0) throw new Error(`mail_shared_draft_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
	if (overflow) throw new Error(`mail_shared_draft_ui_overflow_${label}`);
}

async function run(browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const newPage = async () => {
			const context = await browser?.newContext({ locale: "cs-CZ", reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
			if (!context) throw new Error("mail_shared_draft_ui_context_missing");
			return context.newPage();
		};
		const ownerPage = await newPage();
		const runtimeErrors: string[] = [];
		ownerPage.on("pageerror", (error) => runtimeErrors.push(error.message));
		ownerPage.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
		await login(ownerPage, fixture.owner);
		await connectOwner(ownerPage);
		await openPersonalArea(ownerPage);
		let dialog = await openSharedDrafts(ownerPage);
		const newButton = dialog.getByRole("button", { name: "Nový koncept", exact: true });
		await newButton.waitFor();
		await newButton.click();
		await dialog.getByLabel("Komu", { exact: true }).fill("client@example.test");
		await dialog.getByLabel("Předmět", { exact: true }).fill(`Schválená odpověď ${browserName}`);
		await dialog.getByLabel("Text", { exact: true }).fill("První návrh vlastníka.");
		await dialog.getByRole("radio", { name: new RegExp(fixture.approver.name) }).check();
		await dialog.getByRole("checkbox", { name: new RegExp(fixture.editor.name) }).check();
		await dialog.getByRole("button", { name: "Vytvořit koncept", exact: true }).click();
		await dialog.getByText("Verze obsahu 1", { exact: false }).waitFor();
		await assertAxeClean(ownerPage, `${browserName}_owner_created`);
		await dialog.getByRole("button", { name: "Zavřít", exact: true }).click();

		const editorPage = await newPage();
		await login(editorPage, fixture.editor);
		await openPersonalArea(editorPage);
		dialog = await openSharedDrafts(editorPage);
		await dialog.getByRole("button", { name: new RegExp(`Schválená odpověď ${browserName}`) }).click();
		await dialog.getByText("Verze obsahu 1", { exact: false }).waitFor();
		const editorText = dialog.locator("textarea").last();
		await editorText.fill("Přesná verze připravená editorem.");
		await dialog.getByRole("button", { name: "Uložit změny", exact: true }).click();
		await dialog.getByText("Verze obsahu 2", { exact: false }).waitFor();
		await dialog.getByRole("button", { name: "Odeslat ke schválení", exact: true }).click();
		await dialog.getByText("Čeká na schválení", { exact: true }).first().waitFor();
		await assertAxeClean(editorPage, `${browserName}_editor_submitted`);
		await editorPage.context().close();

		const approverPage = await newPage();
		await login(approverPage, fixture.approver);
		await openPersonalArea(approverPage);
		dialog = await openSharedDrafts(approverPage);
		await dialog.getByRole("button", { name: new RegExp(`Schválená odpověď ${browserName}`) }).click();
		await dialog.getByRole("button", { name: "Schválit verzi 2", exact: true }).click();
		await dialog.getByText("Schváleno", { exact: true }).first().waitFor();
		if ((await dialog.getByRole("button", { name: /Schválit verzi/ }).count()) !== 0) {
			throw new Error("mail_shared_draft_ui_reapproval_exposed");
		}
		await assertAxeClean(approverPage, `${browserName}_approver_decided`);
		await approverPage.context().close();

		await openPersonalArea(ownerPage);
		dialog = await openSharedDrafts(ownerPage);
		await dialog.getByRole("button", { name: new RegExp(`Schválená odpověď ${browserName}`) }).click();
		await dialog.getByRole("button", { name: "Odeslat schválenou verzi", exact: true }).click();
		await dialog.getByText("ve skutečné odchozí frontě", { exact: false }).waitFor();
		await ownerPage.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(ownerPage, `${browserName}_mobile`);
		await assertAxeClean(ownerPage, `${browserName}_mobile`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await dialog.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-shared-draft-mobile.png` });
		}
		const account = (await db.select().from(mailAccounts).where(eq(mailAccounts.ownerUserId, fixture.owner.id)).limit(1))[0];
		if (!account) throw new Error("mail_shared_draft_ui_account_missing");
		const outbound = (await db.select().from(mailOutboundMessages).where(eq(mailOutboundMessages.accountId, account.id)).limit(1))[0];
		if (!outbound) throw new Error("mail_shared_draft_ui_outbound_missing");
		await scanMailOutbound(new Date(Date.now() + 20_000));
		const accepted = (await db.select().from(mailOutboundMessages).where(eq(mailOutboundMessages.id, outbound.id)).limit(1))[0];
		if (accepted?.status !== "accepted") throw new Error(`mail_shared_draft_ui_not_accepted:${accepted?.lastErrorCode}`);
		const sentResponse = await fetch(`${STUB}/test/sent?email=${encodeURIComponent(fixture.owner.email)}`);
		const sent = (await sentResponse.json()) as { messages: Array<{ raw: string }> };
		const exactBody = Buffer.from("Přesná verze připravená editorem.", "utf8").toString("base64");
		if (!sent.messages.some((message) => message.raw.includes(exactBody))) throw new Error("mail_shared_draft_ui_exact_body_missing");
		if (runtimeErrors.length > 0) throw new Error(`mail_shared_draft_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(`  ✓ ${browserName}: vlastník → editor → schvalovatel → přesné odeslání, axe a mobile reflow`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.teamWorkspaceId));
		await db.delete(workspaces).where(eq(workspaces.id, fixture.personalWorkspaceId));
		await db.delete(users).where(eq(users.id, fixture.owner.id));
		await db.delete(users).where(eq(users.id, fixture.editor.id));
		await db.delete(users).where(eq(users.id, fixture.approver.id));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nMail shared draft UI checks passed.");
process.exit(0);
