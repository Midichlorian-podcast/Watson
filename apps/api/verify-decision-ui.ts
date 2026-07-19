/** F6 browser audit Decision Logu: přesné retry, revize, historie, deep-link, a11y a 390 px. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	and,
	decisions,
	eq,
	getDb,
	meetings,
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

const WEB = process.env.DECISION_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.DECISION_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.DECISION_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const meetingId = crypto.randomUUID();
	const hubTaskId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `decision-ui-${browserName}-${stamp}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx
			.insert(users)
			.values({ id: userId, name: `Decision UI ${browserName}`, email, emailVerified: true });
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name: `Decision UI ${browserName}`,
			ownerId: userId,
			isPersonal: false,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
		await tx
			.insert(projects)
			.values({ id: projectId, workspaceId, ownerId: userId, name: "Projekt rozhodnutí" });
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
		await tx.insert(tasks).values([
			{ id: taskId, projectId, name: "Navazující úkol", createdBy: userId },
			{
				id: hubTaskId,
				projectId,
				name: "Porada Decision UI",
				kind: "meeting",
				meetingId,
				createdBy: userId,
			},
		]);
		await tx.insert(meetings).values({
			id: meetingId,
			workspaceId,
			title: "Porada Decision UI",
			status: "committed",
			hubTaskId,
			createdBy: userId,
		});
		await tx.insert(decisions).values({
			id: crypto.randomUUID(),
			workspaceId,
			projectId,
			sourceType: "meeting",
			sourceObjectId: meetingId,
			sourceKey: "seed",
			title: "Rozhodnutí z porady",
			rationale: "Ověření hlubokého odkazu.",
			createdBy: userId,
		});
	});
	return { userId, workspaceId, projectId, taskId, email, password };
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
	if (violations.length) throw new Error(`decision_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`decision_ui_overflow_${label}`);
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
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && !message.text().includes("503"))
				runtimeErrors.push(message.text());
		});

		await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
		await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
		await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.goto(`${WEB}/meets`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("button", { name: "Rozhodnutí", exact: true }).click();
		await page.getByRole("heading", { name: "Decision Log", exact: true }).waitFor();
		await page.getByText("Rozhodnutí z porady", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_list`);

		await page.getByRole("button", { name: "+ Nové rozhodnutí", exact: true }).click();
		let dialog = page.getByRole("dialog", { name: "Nové rozhodnutí", exact: true });
		await dialog.getByLabel("Co jsme rozhodli?").fill("Použijeme variantu Orion");
		await dialog
			.getByLabel("Proč toto rozhodnutí platí? (volitelně)")
			.fill("Nejlepší poměr rizika a ceny.");
		await dialog.getByLabel("Zkontrolovat znovu").fill("2026-09-01");
		await dialog.getByLabel("Související úkoly", { exact: true }).fill("Navazující");
		await dialog.getByRole("checkbox", { name: "Navazující úkol", exact: true }).check();
		await assertAxeClean(page, `${browserName}_create_dialog`);

		const createRoute = /\/api\/decisions$/;
		await page.route(createRoute, async (route) => {
			if (route.request().method() !== "POST") {
				await route.continue();
				return;
			}
			const request = route.request();
			const headers = await request.allHeaders();
			const cookies = await context.cookies(request.url());
			headers.cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
			const accepted = await fetch(request.url(), {
				method: "POST",
				headers,
				body: request.postData(),
			});
			if (!accepted.ok) throw new Error(`decision_ui_intercept_upstream:${accepted.status}`);
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: '{"error":"decision_unavailable"}',
			});
		});
		await dialog.getByRole("button", { name: "Zapsat rozhodnutí", exact: true }).click();
		await page.getByText("Rozhodnutí se nepodařilo uložit.", { exact: true }).waitFor();
		await dialog.waitFor();
		await page.unroute(createRoute);
		await dialog.getByRole("button", { name: "Zapsat rozhodnutí", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await page.getByText("Použijeme variantu Orion", { exact: true }).waitFor();
		const created = await db
			.select()
			.from(decisions)
			.where(
				and(
					eq(decisions.workspaceId, fixture.workspaceId),
					eq(decisions.title, "Použijeme variantu Orion"),
				),
			);
		if (created.length !== 1) throw new Error(`decision_ui_retry_duplicate:${created.length}`);

		let card = page.getByRole("article").filter({ hasText: "Použijeme variantu Orion" });
		await card.getByRole("button", { name: /Navazující úkol/ }).waitFor();
		await card.getByRole("button", { name: "Revidovat", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Revize rozhodnutí", exact: true });
		await dialog
			.getByLabel("Proč toto rozhodnutí platí? (volitelně)")
			.fill("Potvrzeno bezpečnostním auditem.");
		await dialog.getByRole("button", { name: "Uložit revizi", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await card.getByText("Potvrzeno bezpečnostním auditem.", { exact: true }).waitFor();

		await card.getByRole("button", { name: "Nahradit…", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Nahradit rozhodnutí", exact: true });
		await dialog.getByLabel("Co jsme rozhodli?").fill("Použijeme variantu Vega");
		await dialog.getByRole("button", { name: "Nahradit", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await page.getByText("Použijeme variantu Vega", { exact: true }).waitFor();
		if ((await page.getByText("Použijeme variantu Orion", { exact: true }).count()) !== 0) {
			throw new Error("decision_ui_superseded_visible_in_active_filter");
		}
		await page.getByLabel("Filtrovat podle stavu").selectOption("");
		await page.getByText("Použijeme variantu Orion", { exact: true }).waitFor();
		await page.getByText("Nahrazeno", { exact: true }).waitFor();

		const meetingCard = page.getByRole("article").filter({ hasText: "Rozhodnutí z porady" });
		await meetingCard.getByRole("button", { name: "Otevřít poradu", exact: true }).click();
		await page.getByText("Porada Decision UI", { exact: true }).first().waitFor();
		await page.getByRole("button", { name: "← Meets", exact: true }).click();
		await page.getByRole("heading", { name: "Decision Log", exact: true }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(page, `${browserName}_390_list`);
		await page.getByLabel("Filtrovat podle stavu").selectOption("active");
		card = page.getByRole("article").filter({ hasText: "Použijeme variantu Vega" });
		await card.getByRole("button", { name: "Revidovat", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Revize rozhodnutí", exact: true });
		const dialogBox = await dialog.boundingBox();
		if (!dialogBox || dialogBox.x < 0 || dialogBox.x + dialogBox.width > 390 || dialogBox.y < 0) {
			throw new Error(`decision_ui_mobile_dialog_clipped:${JSON.stringify(dialogBox)}`);
		}
		const saveBox = await dialog
			.getByRole("button", { name: "Uložit revizi", exact: true })
			.boundingBox();
		if (!saveBox || saveBox.height < 44)
			throw new Error(`decision_ui_mobile_target:${saveBox?.height}`);
		await assertAxeClean(page, `${browserName}_390_dialog`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await dialog.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-decision-review-390.png` });
		}
		await dialog.getByRole("button", { name: "Zrušit", exact: true }).click();
		await assertNoOverflow(page, `${browserName}_390_after_dialog`);
		await assertAxeClean(page, `${browserName}_390_list`);
		if (SCREENSHOT_DIR)
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-decision-log-390.png`,
				fullPage: true,
			});
		if (runtimeErrors.length) throw new Error(`decision_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(`  ✓ ${browserName}: retry, revize, historie, deep-link, 390 px a axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nDecision Log UI checks passed.");
process.exit(0);
