/** F6 browser audit Radaru: vysvětlení, filtry, decision deep-link, mobil a WCAG. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	assignments,
	availabilityBlocks,
	decisions,
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

const WEB = process.env.RADAR_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.RADAR_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.RADAR_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

function day(offset: number) {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
}

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const assigneeId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const decisionId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `radar-ui-${browserName}-${stamp}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	const start = new Date(Date.now() + 2 * 60 * 60_000);
	await db.transaction(async (tx) => {
		await tx.insert(users).values([
			{ id: userId, name: `Radar UI ${browserName}`, email, emailVerified: true },
			{
				id: assigneeId,
				name: "Řešitel Radaru",
				email: `radar-ui-assignee-${browserName}-${stamp}@watson.test`,
				emailVerified: true,
			},
		]);
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name: `Radar UI ${browserName}`,
			ownerId: userId,
			isPersonal: false,
		});
		await tx.insert(memberships).values([
			{ workspaceId, userId, role: "admin" },
			{ workspaceId, userId: assigneeId, role: "member" },
		]);
		await tx.insert(projects).values({
			id: projectId,
			workspaceId,
			ownerId: userId,
			name: "Projekt Radar UI",
		});
		await tx.insert(projectMembers).values([
			{ projectId, userId, role: "manager" },
			{ projectId, userId: assigneeId, role: "editor" },
		]);
		await tx.insert(tasks).values({
			id: taskId,
			projectId,
			name: "Kritické předání z Radaru",
			deadline: day(-1),
			startDate: start,
			startTimezone: "UTC",
			durationMin: 90,
			priority: 1,
			createdBy: userId,
		});
		await tx.insert(assignments).values({ taskId, projectId, userId: assigneeId });
		await tx.insert(availabilityBlocks).values({
			workspaceId,
			userId: assigneeId,
			kind: "absence",
			startsAt: new Date(start.getTime() - 30 * 60_000),
			endsAt: new Date(start.getTime() + 2 * 60 * 60_000),
			timezone: "UTC",
			visibility: "private",
			label: "Soukromý důvod se nesmí ukázat",
			createdBy: assigneeId,
		});
		await tx.insert(decisions).values({
			id: decisionId,
			workspaceId,
			projectId,
			sourceType: "manual",
			sourceKey: "manual",
			title: "Rozhodnutí čekající na revizi",
			reviewAt: new Date(Date.now() - 60 * 60_000),
			createdBy: userId,
		});
	});
	return { userId, assigneeId, workspaceId, decisionId, email, password };
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
	if (violations.length) throw new Error(`radar_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`radar_ui_overflow_${label}`);
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
			if (message.type() === "error" && !message.text().includes("503")) {
				runtimeErrors.push(message.text());
			}
		});

		await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
		await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
		await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.goto(`${WEB}/velin`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("heading", { name: "Watson Radar", exact: true }).waitFor();
		await page.getByText("Kritické předání z Radaru", { exact: true }).waitFor();
		await page.getByText("Rozhodnutí čekající na revizi", { exact: true }).waitFor();
		if ((await page.getByText("Soukromý důvod se nesmí ukázat").count()) > 0) {
			throw new Error("radar_ui_private_availability_label_leaked");
		}
		await assertAxeClean(page, `${browserName}_desktop`);

		await page.getByText("Kritické předání z Radaru", { exact: true }).click();
		await page.getByText("Pevný termín je po splatnosti.", { exact: true }).waitFor();
		await page.getByText(/ověřený fakt/).first().waitFor();
		await page.getByRole("button", { name: "Otevřít úkol", exact: true }).waitFor();

		await page.getByText("Rozhodnutí čekající na revizi", { exact: true }).click();
		await page.getByRole("button", { name: "Otevřít rozhodnutí", exact: true }).click();
		await page.getByRole("heading", { name: "Decision Log", exact: true }).waitFor();
		const focused = page.locator(`#decision-${fixture.decisionId}`);
		await focused.waitFor();
		if (!(await focused.getAttribute("class"))?.includes("ring-brass")) {
			throw new Error("radar_ui_decision_deep_link_not_focused");
		}

		await page.goto(`${WEB}/velin`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("heading", { name: "Watson Radar", exact: true }).waitFor();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByText("Kritické předání z Radaru", { exact: true }).click();
		await assertNoOverflow(page, `${browserName}_390`);
		const openBox = await page.getByRole("button", { name: "Otevřít úkol", exact: true }).boundingBox();
		if (!openBox || openBox.height < 44) throw new Error(`radar_ui_mobile_target:${openBox?.height}`);
		await assertAxeClean(page, `${browserName}_390`);
		const criticalFilter = page.getByRole("button", { name: /Kritické/ });
		const filterBox = await criticalFilter.boundingBox();
		if (!filterBox || filterBox.height < 44) {
			throw new Error(`radar_ui_mobile_filter_target:${filterBox?.height}`);
		}
		await criticalFilter.click();
		if ((await page.getByText("Rozhodnutí čekající na revizi", { exact: true }).count()) !== 0) {
			throw new Error("radar_ui_severity_filter_failed");
		}
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-radar-390.png`,
				fullPage: true,
			});
		}
		if (runtimeErrors.length) throw new Error(`radar_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(`  ✓ ${browserName}: explanation, filters, deep-link, 390 px and axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.assigneeId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nExplainable Radar UI checks passed.");
process.exit(0);
