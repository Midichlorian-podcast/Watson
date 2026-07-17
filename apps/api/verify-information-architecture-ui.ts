/** F8a browser audit: role-aware entry points, guided navigation and responsive surfaces. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import { accounts, eq, getDb, memberships, users, workspaces } from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const WEB = process.env.IA_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.IA_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.IA_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

type Fixture = {
	userId: string;
	ownerId: string;
	workspaceId: string;
	email: string;
	password: string;
};

async function provision(browserName: string, role: "admin" | "member"): Promise<Fixture> {
	const userId = crypto.randomUUID();
	const ownerId = role === "admin" ? userId : crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `ia-ui-${browserName}-${role}-${stamp}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `IA ${role} ${browserName}`,
			email,
			emailVerified: true,
		});
		if (ownerId !== userId) {
			await tx.insert(users).values({
				id: ownerId,
				name: `IA owner ${browserName}`,
				email: `ia-owner-${stamp}@watson.test`,
				emailVerified: true,
			});
		}
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name: `IA ${role} ${browserName}`,
			ownerId,
			isPersonal: false,
		});
		if (ownerId !== userId) {
			await tx.insert(memberships).values({ workspaceId, userId: ownerId, role: "admin" });
		}
		await tx.insert(memberships).values({ workspaceId, userId, role });
	});
	return { userId, ownerId, workspaceId, email, password };
}

async function cleanup(fixture: Fixture) {
	await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
	await db.delete(users).where(eq(users.id, fixture.userId));
	if (fixture.ownerId !== fixture.userId) {
		await db.delete(users).where(eq(users.id, fixture.ownerId));
	}
}

async function provisionMemberOnlyWorkspace(userId: string, browserName: string) {
	const ownerId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const name = `Member-only ${browserName}`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: ownerId,
			name: `Secondary owner ${browserName}`,
			email: `ia-secondary-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@watson.test`,
			emailVerified: true,
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name,
			ownerId,
			isPersonal: false,
		});
		await tx.insert(memberships).values([
			{ workspaceId, userId: ownerId, role: "admin" },
			{ workspaceId, userId, role: "member" },
		]);
	});
	return { ownerId, workspaceId, name };
}

async function signIn(page: Page, fixture: Fixture) {
	await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
	await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
	await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
	await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
	await page.waitForSelector("main", { timeout: 30_000 });
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
	if (violations.length) throw new Error(`ia_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`ia_ui_overflow_${label}`);
}

async function screenshot(page: Page, browserName: string, label: string) {
	if (!SCREENSHOT_DIR) return;
	await mkdir(SCREENSHOT_DIR, { recursive: true });
	await page.screenshot({
		path: `${SCREENSHOT_DIR}/${browserName}-${label}.png`,
		fullPage: true,
	});
}

async function verifyAdmin(browser: Browser, browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName, "admin");
	const memberOnly = await provisionMemberOnlyWorkspace(fixture.userId, browserName);
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
	try {
		await signIn(page, fixture);
		await page.goto(`${WEB}/prehled`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("heading", { name: "Přehled", exact: true }).waitFor();
		const main = page.locator("main");
		await main.getByRole("button", { name: memberOnly.name, exact: true }).waitFor();
		const sidebar = page.locator("aside");
		await sidebar.getByRole("link", { name: "Můj den", exact: true }).waitFor();
		await sidebar.getByRole("link", { name: "Tým", exact: true }).waitFor();
		await sidebar.getByRole("link", { name: "Provoz", exact: true }).waitFor();
		if ((await sidebar.getByRole("link", { name: "Meets", exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_guided_tools_visible_${browserName}`);
		}
		await sidebar.getByRole("button", { name: "Všechny nástroje", exact: true }).click();
		await sidebar.getByRole("link", { name: "Meets", exact: true }).waitFor();
		const listsLink = sidebar.getByRole("link", { name: /^Seznamy/ });
		const listsCount = await listsLink.count();
		if (listsCount < 1) throw new Error(`ia_ui_lists_not_reachable_${browserName}_${listsCount}`);
		await listsLink.first().scrollIntoViewIfNeeded();
		await listsLink.first().waitFor();
		await screenshot(page, browserName, "ia-guided-expanded");

		await sidebar.getByRole("link", { name: "Tým", exact: true }).click();
		await page.waitForURL(/\/prehled\?vstup=tym/);
		await page.getByRole("heading", { name: "Tým", exact: true }).waitFor();
		await main.getByText("Komunikace pro mě", { exact: true }).waitFor();
		if ((await main.getByText("Dnes", { exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_team_contains_personal_today_${browserName}`);
		}

		await page
			.locator("main")
			.getByRole("button", { name: "Provoz", exact: true })
			.click();
		await page.waitForURL(/\/prehled\?vstup=provoz/);
		await page.getByRole("heading", { name: "Provoz", exact: true }).waitFor();
		await page.getByRole("button", { name: "Otevřít Velín", exact: true }).waitFor();
		if ((await main.getByRole("button", { name: memberOnly.name, exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_operations_cross_role_workspace_${browserName}`);
		}
		if ((await main.getByText("Komunikace pro mě", { exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_operations_contains_personal_communication_${browserName}`);
		}
		await assertAxeClean(page, `${browserName}_operations`);

		await page.goto(`${WEB}/nastaveni?sekce=vzhled`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.getByRole("heading", { name: "Vzhled", exact: true }).waitFor();
		await page.getByRole("button", { name: "Pokročilá", exact: true }).click();
		await sidebar.getByRole("link", { name: "Meets", exact: true }).waitFor();
		await page.reload({ waitUntil: "domcontentloaded" });
		await sidebar.getByRole("link", { name: "Meets", exact: true }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${WEB}/prehled?vstup=provoz`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.getByRole("heading", { name: "Provoz", exact: true }).waitFor();
		await assertNoOverflow(page, `${browserName}_operations_390`);
		await page.getByRole("button", { name: "Více", exact: true }).click();
		const sheet = page.getByRole("dialog", { name: "Další sekce" });
		await sheet.waitFor();
		for (const name of ["Můj den", "Tým", "Provoz"]) {
			const box = await sheet.getByRole("link", { name, exact: true }).boundingBox();
			if (!box || box.height < 44) throw new Error(`ia_ui_mobile_target_${browserName}_${name}`);
		}
		await assertNoOverflow(page, `${browserName}_more_390`);
		await assertAxeClean(page, `${browserName}_more_390`);
		await screenshot(page, browserName, "ia-operations-390");
		if (runtimeErrors.length) throw new Error(`ia_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(
			`  ✓ ${browserName}: guided/advanced nav, team/operations surfaces, persistence, 390 px and axe`,
		);
	} finally {
		await context.close();
		await db.delete(workspaces).where(eq(workspaces.id, memberOnly.workspaceId));
		await db.delete(users).where(eq(users.id, memberOnly.ownerId));
		await cleanup(fixture);
	}
}

async function verifyMember(browser: Browser, browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName, "member");
	const context = await browser.newContext({
		locale: "cs-CZ",
		reducedMotion: "reduce",
		viewport: { width: 1280, height: 900 },
	});
	const page = await context.newPage();
	try {
		await signIn(page, fixture);
		await page.goto(`${WEB}/prehled?vstup=provoz`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.waitForURL(/\/prehled\?vstup=tym/);
		await page.getByRole("heading", { name: "Tým", exact: true }).waitFor();
		if ((await page.locator("aside").getByRole("link", { name: "Provoz", exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_member_operations_sidebar_${browserName}`);
		}
		const mainEntries = page
			.locator("main")
			.getByRole("navigation", { name: "Moje vstupy", exact: true });
		if ((await mainEntries.getByRole("button", { name: "Provoz", exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_member_operations_surface_${browserName}`);
		}
		await assertAxeClean(page, `${browserName}_member_team`);
		console.log(`  ✓ ${browserName}: member is safely routed to the team surface`);
	} finally {
		await context.close();
		await cleanup(fixture);
	}
}

for (const browserName of BROWSERS) {
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		await verifyAdmin(browser, browserName);
		await verifyMember(browser, browserName);
	} finally {
		await browser?.close();
	}
}
console.log("\nInformation architecture UI checks passed.");
process.exit(0);
