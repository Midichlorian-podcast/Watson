/**
 * F0 / R-01 — kritický browser release průchod přes skutečné UI a PowerSync.
 *
 * Předpoklady: běžící API, Vite web, PostgreSQL a PowerSync. Každý engine dostane
 * izolovaný účet/workspace/projekt; heslo ani cookie se nelogují a cleanup běží i
 * po selhání. Scénář záměrně používá naplněnou offline CRUD frontu.
 */
import "./src/env";
import { writeFile } from "node:fs/promises";
import {
	accounts,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const API = process.env.WATSON_RELEASE_API ?? "http://localhost:8787";
const WEB = process.env.WATSON_RELEASE_WEB ?? "http://localhost:5173";
const ARTIFACT =
	process.env.WATSON_RELEASE_ARTIFACT ?? "/tmp/watson-release-e2e.json";
const BROWSERS = (process.env.WATSON_RELEASE_BROWSERS ?? "chromium,webkit")
	.split(",")
	.map((value) => value.trim())
	.filter((value): value is BrowserName => value === "chromium" || value === "webkit");

if (BROWSERS.length === 0) throw new Error("release_browser_selection_empty");

type BrowserName = "chromium" | "webkit";
type Fixture = {
	userId: string;
	workspaceId: string;
	projectId: string;
	email: string;
	password: string;
};
type ServerTask = { id: string; project_id: string; name: string; due_date: string | null };
type BrowserResult = {
	browser: BrowserName;
	signIn: boolean;
	initialSync: boolean;
	offlineLocalCreate: boolean;
	serverWriteHeldOffline: boolean;
	reconnectUpload: boolean;
	editRoundTrip: boolean;
	moveRoundTrip: boolean;
	rejectionCaptured: boolean;
	rejectionDiscarded: boolean;
	retryResolved: boolean;
	addDialogA11y: boolean;
	taskDetailA11y: boolean;
};

const db = getDb();

async function eventually<T>(
	label: string,
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	timeoutMs = 45_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!accept(value) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		value = await read();
	}
	if (!accept(value)) throw new Error(`release_timeout_${label}`);
	return value;
}

async function provision(browserName: BrowserName): Promise<Fixture> {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const email = `release-${browserName}-${suffix}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	const passwordHash = await hashPassword(password);
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Release ${browserName}`,
			email,
			emailVerified: true,
		});
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: passwordHash,
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name: `Release ${browserName}`,
			ownerId: userId,
			isPersonal: true,
		});
		await tx.insert(memberships).values({ userId, workspaceId, role: "admin" });
		await tx.insert(projects).values({
			id: projectId,
			workspaceId,
			name: "Inbox",
			ownerId: userId,
		});
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
	});
	return { userId, workspaceId, projectId, email, password };
}

async function cleanup(fixture: Fixture) {
	await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
	await db.delete(users).where(eq(users.id, fixture.userId));
}

async function serverTaskByName(name: string): Promise<ServerTask | null> {
	const rows = (await db.execute(sql`
		SELECT id, project_id, name, due_date::text
		FROM tasks WHERE name = ${name} LIMIT 1
	`)) as ServerTask[];
	return rows[0] ?? null;
}

async function serverTaskById(id: string): Promise<ServerTask | null> {
	const rows = (await db.execute(sql`
		SELECT id, project_id, name, due_date::text
		FROM tasks WHERE id = ${id}::uuid LIMIT 1
	`)) as ServerTask[];
	return rows[0] ?? null;
}

async function serverTaskPrecondition(id: string): Promise<Record<string, unknown>> {
	const rows = (await db.execute(sql`
		SELECT project_id, section_id, parent_id, name, description, why_now, priority, color,
		       due_date, start_date, start_timezone, deadline, duration_min, days, sort_order,
		       recurrence, recurrence_rule, recurrence_basis, assignment_mode, status_id,
		       mail_th, mail_label, kind, meeting_id, completed_at
		FROM tasks WHERE id = ${id}::uuid LIMIT 1
	`)) as Record<string, unknown>[];
	const row = rows[0];
	if (!row) throw new Error("release_retry_task_missing");
	return row;
}

async function navigate(page: Page, route: string) {
	await page.evaluate((path) => {
		window.history.pushState({}, "", path);
		window.dispatchEvent(new PopStateEvent("popstate"));
	}, route);
	await page.waitForFunction((path) => location.pathname === path, route, { timeout: 5_000 });
	await page.waitForSelector("main", { timeout: 15_000 });
}

async function assertAxeClean(page: Page, label: string) {
	await page.waitForTimeout(20);
	await page.evaluate(axe.source);
	const violations = await page.evaluate(async () => {
		const runner = (globalThis as unknown as {
			axe: {
				run: (
					root: Document,
					options: Record<string, unknown>,
				) => Promise<{
					violations: {
						id: string;
						impact: string | null;
						nodes: { target: string[]; failureSummary?: string }[];
					}[];
				}>;
			};
		}).axe;
		const result = await runner.run(document, {
			runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
		});
		return result.violations.map(
			(violation) =>
				`${violation.id}:${violation.impact ?? "none"}:${violation.nodes
					.slice(0, 5)
					.map(
						(node) =>
							`${node.target.join(" ")}(${(node.failureSummary ?? "").replaceAll("\n", " ")})`,
					)
					.join("|")}`,
		);
	});
	if (violations.length > 0) throw new Error(`release_axe_${label}_${violations.join(",")}`);
}

async function localTaskByName(page: Page, name: string): Promise<ServerTask | null> {
	return page.evaluate(async (taskName) => {
		const local = (window as unknown as {
			__watsonDb?: {
				getAll: (
					query: string,
					params: unknown[],
				) => Promise<{ id: string; project_id: string; name: string; due_date: string | null }[]>;
			};
		}).__watsonDb;
		if (!local) return null;
		const rows = await local.getAll(
			"SELECT id, project_id, name, due_date FROM tasks WHERE name = ? LIMIT 1",
			[taskName],
		);
		return rows[0] ?? null;
	}, name);
}

async function localProblemCount(page: Page, status = "open") {
	return page.evaluate(async (problemStatus) => {
		const local = (window as unknown as {
			__watsonDb?: {
				getAll: (query: string, params: unknown[]) => Promise<{ count: number }[]>;
			};
		}).__watsonDb;
		if (!local) return -1;
		const rows = await local.getAll(
			"SELECT count(*) AS count FROM local_rejected_ops WHERE status = ?",
			[problemStatus],
		);
		return Number(rows[0]?.count ?? 0);
	}, status);
}

async function localProblemStatus(page: Page, id: string) {
	return page.evaluate(async (problemId) => {
		const local = (window as unknown as {
			__watsonDb?: {
				getAll: (
					query: string,
					params: unknown[],
				) => Promise<{ status: string; http_code: number | null; server_code: string | null }[]>;
			};
		}).__watsonDb;
		if (!local) return null;
		const rows = await local.getAll(
			"SELECT status, http_code, server_code FROM local_rejected_ops WHERE id = ? LIMIT 1",
			[problemId],
		);
		return rows[0] ?? null;
	}, id);
}

async function runBrowser(browserName: BrowserName): Promise<BrowserResult> {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const context = await browser.newContext({ locale: "cs-CZ", reducedMotion: "reduce" });
		const page = await context.newPage();
		page.on("console", (message) => {
			if (message.type() === "error") console.error(`[${browserName}:console] ${message.text()}`);
		});
		page.on("pageerror", (error) => console.error(`[${browserName}:pageerror] ${error.message}`));
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
		const taskName = `Release offline ${browserName} ${crypto.randomUUID().slice(0, 8)}`;
		const editedName = `${taskName} upraveno`;
		await page.getByRole("button", { name: "Přidat úkol", exact: true }).first().click();
		const addDialog = page.getByRole("dialog", { name: "Přidat úkol" });
		await addDialog.waitFor({ state: "visible" });
		await addDialog.getByRole("button", { name: "Inbox", exact: true }).waitFor();
		await assertAxeClean(page, "add_dialog");
		await context.setOffline(true);
		await addDialog.getByPlaceholder(/Název úkolu/).fill(`${taskName} zítra`);
		await addDialog.getByRole("button", { name: "Přidat úkol", exact: true }).click();

		const localTask = await eventually(
			"offline_local_create",
			() => localTaskByName(page, taskName),
			(value) => value !== null,
			5_000,
		);
		await addDialog.waitFor({ state: "hidden", timeout: 5_000 });
		if (!localTask || localTask.project_id !== fixture.projectId) {
			throw new Error("release_offline_local_scope_failed");
		}
		const held = (await serverTaskByName(taskName)) === null;
		if (!held) throw new Error("release_offline_write_reached_server");

		await context.setOffline(false);
		const uploaded = await eventually(
			"reconnect_upload",
			() => serverTaskById(localTask.id),
			(value) => value?.name === taskName && value.project_id === fixture.projectId,
		);
		if (!uploaded) throw new Error("release_reconnect_upload_failed");

		await navigate(page, "/ukoly");
		await page.getByRole("button", { name: taskName, exact: true }).click();
		const detail = page.getByRole("dialog");
		await detail.waitFor({ state: "visible" });
		await assertAxeClean(page, "task_detail");
		const title = detail.getByLabel("Název úkolu", { exact: true });
		await title.fill(editedName);
		await title.press("Tab");
		await eventually(
			"edit_roundtrip",
			() => serverTaskById(localTask.id),
			(value) => value?.name === editedName,
		);

		const movedDate = new Date();
		movedDate.setDate(movedDate.getDate() + 3);
		const movedIso = movedDate.toISOString().slice(0, 10);
		await detail.locator('input[type="date"]').first().fill(movedIso);
		await eventually(
			"move_roundtrip",
			() => serverTaskById(localTask.id),
			(value) => value?.due_date?.slice(0, 10) === movedIso,
		);
		await detail.getByRole("button", { name: "Zrušit", exact: true }).click();
		await detail.waitFor({ state: "hidden" });

		const invalidProjectId = crypto.randomUUID();
		await page.evaluate(
			async ({ taskId, badProjectId }) => {
				const local = (window as unknown as {
					__watsonDb: { execute: (query: string, params: unknown[]) => Promise<unknown> };
				}).__watsonDb;
				await local.execute("UPDATE tasks SET project_id = ? WHERE id = ?", [
					badProjectId,
					taskId,
				]);
			},
			{ taskId: localTask.id, badProjectId: invalidProjectId },
		);
		await eventually(
			"rejection_capture",
			() => localProblemCount(page),
			(value) => value === 1,
		);
		await navigate(page, "/nastaveni");
		await page.getByText("Problémy se synchronizací", { exact: false }).first().waitFor();
		page.once("dialog", (dialog) => dialog.accept());
		await page.getByRole("button", { name: "Zahodit", exact: true }).click();
		await eventually(
			"rejection_discard",
			() => localProblemCount(page),
			(value) => value === 0,
		);
		await page
			.getByRole("button", { name: "Zkusit znovu", exact: true })
			.waitFor({ state: "detached" });

		const retryId = crypto.randomUUID();
		const clientId = `release-${browserName}-${crypto.randomUUID().slice(0, 8)}`;
		const operationId = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
		const previous = await serverTaskPrecondition(localTask.id);
		const envelope = JSON.stringify({
			op: "PATCH",
			table: "tasks",
			id: localTask.id,
			data: { name: editedName },
			previous,
			clientId,
			operationId,
		});
		await page.evaluate(
			async ({ id, payload, rowId, localClientId, localOperationId }) => {
				const local = (window as unknown as {
					__watsonDb: { execute: (query: string, params: unknown[]) => Promise<unknown> };
				}).__watsonDb;
				const now = new Date().toISOString();
				await local.execute(
					`INSERT INTO local_rejected_ops
					 (id, created_at, last_attempt_at, attempt_count, client_id, operation_id,
					  table_name, op, row_id, payload, http_code, server_code, request_id, status)
					 VALUES (?, ?, ?, 1, ?, ?, 'tasks', 'PATCH', ?, ?, 409, 'test_retry', NULL, 'open')`,
					[id, now, now, localClientId, localOperationId, rowId, payload],
				);
			},
			{
				id: retryId,
				payload: envelope,
				rowId: localTask.id,
				localClientId: clientId,
				localOperationId: operationId,
			},
		);
		const retryRow = page
			.getByText("HTTP 409 · test_retry", { exact: true })
			.locator("xpath=ancestor::div[button][1]");
		await retryRow.waitFor();
		await retryRow.getByRole("button", { name: "Zkusit znovu", exact: true }).click();
		const retryStatus = await eventually(
			"retry_finished",
			() => localProblemStatus(page, retryId),
			(value) =>
				value?.status === "resolved" ||
				(value?.status === "open" && value.server_code !== "test_retry"),
			10_000,
		);
		if (retryStatus?.status !== "resolved") {
			throw new Error(
				`release_retry_failed_${retryStatus?.http_code ?? "network"}_${retryStatus?.server_code ?? "unknown"}`,
			);
		}
		const receipts = (await db.execute(sql`
			SELECT count(*)::int AS count FROM sync_write_receipts
			WHERE user_id = ${fixture.userId}::uuid
			  AND client_id = ${clientId}
			  AND operation_id = ${operationId}
		`)) as { count: number }[];
		if (Number(receipts[0]?.count ?? 0) !== 1) {
			throw new Error("release_retry_receipt_missing");
		}

		await context.close();
		return {
			browser: browserName,
			signIn: true,
			initialSync: true,
			offlineLocalCreate: true,
			serverWriteHeldOffline: true,
			reconnectUpload: true,
			editRoundTrip: true,
			moveRoundTrip: true,
			rejectionCaptured: true,
			rejectionDiscarded: true,
			retryResolved: true,
			addDialogA11y: true,
			taskDetailA11y: true,
		};
	} finally {
		await browser?.close().catch(() => undefined);
		await cleanup(fixture);
	}
}

async function main() {
	const health = await fetch(`${API}/health`);
	if (!health.ok) throw new Error(`release_api_health_${health.status}`);
	const results: BrowserResult[] = [];
	for (const browserName of BROWSERS) results.push(await runBrowser(browserName));
	const report = {
		createdAt: new Date().toISOString(),
		browsers: BROWSERS,
		results,
	};
	await writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	console.log(
		`Release E2E: ${results.length}/${BROWSERS.length} browserů, sign-in + offline/reconnect + edit/move + rejected-sync recovery prošly.`,
	);
	console.log(`Artifact: ${ARTIFACT}`);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
