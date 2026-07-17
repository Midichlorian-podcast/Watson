/** Browser audit recurrence dialogu v Chromium/WebKitu včetně mobilního reflow a undo. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const WEB = process.env.RECURRENCE_UI_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.RECURRENCE_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.RECURRENCE_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");

const db = getDb();
type Fixture = {
	userId: string;
	workspaceId: string;
	projectId: string;
	taskId: string;
	email: string;
	password: string;
	sourceDate: string;
	targetDate: string;
};

const dateIso = (year: number, month: number, day: number) =>
	`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

async function provision(browserName: string): Promise<Fixture> {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const lastDay = new Date(year, month, 0).getDate();
	const sourceDay = Math.max(2, Math.min(now.getDate() + 1, lastDay - 3));
	const sourceDate = dateIso(year, month, sourceDay);
	const targetDate = dateIso(year, month, sourceDay + 2);
	const baseDate = dateIso(year, month, 1);
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `recurrence-ui-${browserName}-${suffix}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Recurrence UI ${browserName}`,
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
			name: `Recurrence UI ${browserName}`,
			ownerId: userId,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
		await tx.insert(projects).values({
			id: projectId,
			workspaceId,
			name: "Recurrence UI",
			ownerId: userId,
		});
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
		await tx.insert(tasks).values({
			id: taskId,
			projectId,
			name: `Opakovaný audit ${browserName}`,
			dueDate: new Date(`${baseDate}T00:00:00.000Z`),
			startDate: new Date(`${baseDate}T07:00:00.000Z`),
			startTimezone: "Europe/Prague",
			durationMin: 60,
			recurrence: "Denně",
			recurrenceRule: JSON.stringify({ kind: "daily", showAll: true }),
			createdBy: userId,
		});
	});
	return {
		userId,
		workspaceId,
		projectId,
		taskId,
		email,
		password,
		sourceDate,
		targetDate,
	};
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
	const deadline = Date.now() + 30_000;
	let value = await read();
	while (!accept(value) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		value = await read();
	}
	if (!accept(value)) throw new Error(`recurrence_ui_timeout:${JSON.stringify(value)}`);
	return value;
}

async function overrideState(taskId: string) {
	const rows = (await db.execute(sql`
		SELECT occ_date, override_due_date::text, override_start_date
		FROM task_occurrence_overrides WHERE task_id = ${taskId}::uuid LIMIT 1
	`)) as Array<{
		occ_date: string;
		override_due_date: string | null;
		override_start_date: Date | null;
	}>;
	return rows[0] ?? null;
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
	if (violations.length) throw new Error(`recurrence_ui_axe_${label}:${violations.join(",")}`);
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
		await page.waitForFunction(
			() =>
				Boolean(
					(window as unknown as { __watsonDb?: { currentStatus?: { hasSynced?: boolean } } })
						.__watsonDb?.currentStatus?.hasSynced,
				),
			{ timeout: 30_000 },
		);
		await page.goto(`${WEB}/nadchazejici`, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "Kalendář", exact: true }).click();
		await page.getByRole("button", { name: "Měsíc", exact: true }).click();
		const occurrenceId = `${fixture.taskId}@${fixture.sourceDate}`;
		const source = page.locator(`[data-calendar-task-id="${occurrenceId}"]`);
		const target = page.locator(`[data-calendar-date="${fixture.targetDate}"]`);
		await source.waitFor({ state: "visible", timeout: 30_000 });
		await target.waitFor({ state: "visible" });
		await page.evaluate(
			({ sourceId, targetDate }) => {
				const sourceNode = document.querySelector<HTMLElement>(
					`[data-calendar-task-id="${sourceId}"]`,
				);
				const targetNode = document.querySelector<HTMLElement>(
					`[data-calendar-date="${targetDate}"]`,
				);
				if (!sourceNode || !targetNode) throw new Error("recurrence_drag_nodes_missing");
				const transfer = new DataTransfer();
				transfer.setData("text/plain", sourceId);
				sourceNode.dispatchEvent(
					new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
				);
				targetNode.dispatchEvent(
					new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
				);
				targetNode.dispatchEvent(
					new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
				);
			},
			{ sourceId: occurrenceId, targetDate: fixture.targetDate },
		);
		const dialog = page.getByRole("dialog", { name: "Přesunout opakovaný výskyt?" });
		await dialog.waitFor({ state: "visible" });
		await dialog.getByText("Jen tento výskyt", { exact: true }).waitFor();
		await dialog.getByText("Před změnou", { exact: true }).waitFor();
		await dialog.getByText("Po změně", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_desktop`);
		for (let index = 0; index < 10; index += 1) await page.keyboard.press("Tab");
		if (!(await dialog.evaluate((node) => node.contains(document.activeElement)))) {
			throw new Error("recurrence_ui_focus_escaped");
		}
		await page.setViewportSize({ width: 390, height: 844 });
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		);
		if (overflow) throw new Error("recurrence_ui_mobile_overflow");
		await assertAxeClean(page, `${browserName}_mobile`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/${browserName}-recurrence-dialog-390.png`,
				fullPage: true,
			});
		}
		await dialog.getByRole("button", { name: "Přesunout výskyt", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await eventually(
			() => overrideState(fixture.taskId),
			(value) =>
				value?.occ_date === fixture.sourceDate &&
				value.override_due_date === fixture.targetDate,
		);
		await eventually(
			() =>
				page
					.locator(`[data-calendar-task-id="${occurrenceId}"]`)
					.evaluate(
						(node, targetDate) =>
							node.closest<HTMLElement>("[data-calendar-date]")?.dataset.calendarDate ===
							targetDate,
						fixture.targetDate,
					)
					.catch(() => false),
			(value) => value,
		);
		const undo = page.getByRole("button", { name: "Vrátit", exact: true });
		await undo.waitFor({ state: "visible" });
		await undo.click();
		await eventually(
			() => overrideState(fixture.taskId),
			(value) => value === null,
		);
		if (runtimeErrors.length > 0) {
			throw new Error(`recurrence_ui_runtime:${runtimeErrors.join(" | ")}`);
		}
		console.log(`  ✓ ${browserName}: dialog, mobile reflow, a11y, server save a undo`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nRecurrence UI checks passed.");
process.exit(0);
