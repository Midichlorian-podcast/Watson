/** F7e browser audit: draft → publish → acknowledge, editor, mobile and WCAG. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import { accounts, eq, getDb, memberships, users, workspaces } from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const WEB = process.env.KNOWLEDGE_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.KNOWLEDGE_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.KNOWLEDGE_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `knowledge-ui-${browserName}-${stamp}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Knowledge UI ${browserName}`,
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
			name: `Knowledge UI ${browserName}`,
			ownerId: userId,
			isPersonal: false,
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
		return result.violations.map(
			(violation) => `${violation.id}:${violation.nodes[0]?.target.join("|")}`,
		);
	});
	if (violations.length) throw new Error(`knowledge_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`knowledge_ui_overflow_${label}`);
}

async function run(browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const context = await browser.newContext({
			locale: "cs-CZ",
			reducedMotion: "reduce",
			viewport: { width: 1280, height: 900 },
		});
		const page = await context.newPage();
		const runtimeErrors: string[] = [];
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && !message.text().includes("favicon")) {
				runtimeErrors.push(message.text());
			}
		});
		await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
		await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
		await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.goto(`${WEB}/znalosti?prostor=${fixture.workspaceId}`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.getByRole("heading", { name: "Znalosti a SOP", exact: true }).waitFor();
		await page.getByText("Nic tu zatím není", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_empty`);

		await page.getByRole("button", { name: "Nový obsah", exact: true }).click();
		const editor = page.getByRole("dialog", { name: "Nový koncept znalosti" });
		await editor.waitFor();
		await editor.getByLabel("Typ obsahu").selectOption("sop");
		await editor
			.getByLabel("Název", { exact: true })
			.fill("Bezpečné předání klientského projektu");
		await editor.getByLabel("Krátké vysvětlení").fill("Ověřený postup pro tým bez ztracených kroků.");
		await editor.getByLabel("Název sekce").fill("Zkontroluj podklady");
		await editor.getByLabel("Obsah sekce").fill("Ověř úplnost souborů a jasně označ jejich vlastníka.");
		await editor.getByRole("button", { name: "Přidat sekci", exact: true }).click();
		await editor.getByLabel("Název sekce").nth(1).fill("Potvrď převzetí");
		await editor.getByLabel("Obsah sekce").nth(1).fill("Vyžádej si výslovné potvrzení odpovědné osoby.");
		await editor.getByRole("checkbox", { name: /Vyžadovat potvrzení přečtení/ }).check();
		await assertAxeClean(page, `${browserName}_editor`);
		await editor.getByRole("button", { name: "Uložit koncept", exact: true }).click();
		await page.getByText("koncept r1", { exact: true }).waitFor({ timeout: 30_000 });
		await page.getByText("Koncept má nepublikované změny", { exact: true }).waitFor();
		await page.getByRole("heading", { name: "Zkontroluj podklady", exact: true }).waitFor();

		await page.getByRole("button", { name: "Publikovat", exact: true }).click();
		await page.getByLabel("Co se v této verzi změnilo?").fill("První schválená verze");
		await page.getByRole("button", { name: "Publikovat novou verzi", exact: true }).click();
		await page.getByText("Tým už vidí tuto verzi konceptu", { exact: true }).waitFor({
			timeout: 30_000,
		});
		await page.getByRole("button", { name: "Pro tým", exact: true }).click();
		await page.getByText("verze 1", { exact: true }).waitFor();
		await page.getByText("Potvrď tuto verzi", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Přečetl/a jsem a rozumím", exact: true }).click();
		await page.getByText("Tuto verzi máš potvrzenou", { exact: true }).waitFor({
			timeout: 30_000,
		});
		await assertAxeClean(page, `${browserName}_published`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-knowledge-published.png`,
				fullPage: true,
			});
		}

		await page.getByRole("button", { name: "Správa obsahu", exact: true }).click();
		await page.getByText("Potvrzení aktuální verze", { exact: true }).waitFor();
		await page.getByText("1", { exact: true }).last().waitFor();
		await page.getByText("Historie verzí (1)", { exact: true }).click();
		await page.getByText("První schválená verze", { exact: false }).waitFor();
		await page.getByPlaceholder("Hledat v názvu, štítcích i obsahu…").fill("Potvrď převzetí");
		await page.getByRole("button", { name: /Bezpečné předání klientského projektu/ }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(page, `${browserName}_390_detail`);
		const newButton = page.getByRole("button", { name: "Nový obsah", exact: true });
		const newButtonBox = await newButton.boundingBox();
		if (!newButtonBox || newButtonBox.height < 44) {
			throw new Error(`knowledge_ui_new_target_${browserName}:${newButtonBox?.height}`);
		}
		await newButton.click();
		await page.getByRole("dialog", { name: "Nový koncept znalosti" }).waitFor();
		await assertNoOverflow(page, `${browserName}_390_editor`);
		const saveBox = await page
			.getByRole("button", { name: "Uložit koncept", exact: true })
			.boundingBox();
		if (!saveBox || saveBox.height < 44) {
			throw new Error(`knowledge_ui_save_target_${browserName}:${saveBox?.height}`);
		}
		await assertAxeClean(page, `${browserName}_390_editor`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-knowledge-390.png`,
				fullPage: true,
			});
		}
		await page.getByRole("button", { name: "Zrušit", exact: true }).click();
		await page.getByRole("dialog", { name: "Nový koncept znalosti" }).waitFor({ state: "detached" });
		if (runtimeErrors.length) throw new Error(`knowledge_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(`  ✓ ${browserName}: draft, publish, acknowledge, search, history, 390 px and axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nEmployee Knowledge & SOP UI checks passed.");
process.exit(0);
