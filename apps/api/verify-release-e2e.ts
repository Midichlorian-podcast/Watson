/**
 * F0 / R-01 — kritický browser release průchod přes skutečné UI a PowerSync.
 *
 * Předpoklady: běžící API, Vite web, PostgreSQL a PowerSync. Každý engine dostane
 * izolovaný účet/workspace/projekt; heslo ani cookie se nelogují a cleanup běží i
 * po selhání. Scénář záměrně používá naplněnou offline CRUD frontu.
 */
import "./src/env";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const SCREENSHOT_DIR = process.env.WATSON_RELEASE_SCREENSHOT_DIR;
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
	offlineTrustState: boolean;
	trustStateMobileReflow: boolean;
	serverWriteHeldOffline: boolean;
	reconnectUpload: boolean;
	editRoundTrip: boolean;
	moveRoundTrip: boolean;
	rejectionCaptured: boolean;
	syncProblemTrustState: boolean;
	rejectionDiscarded: boolean;
	retryResolved: boolean;
	addDialogA11y: boolean;
	taskDetailA11y: boolean;
	twoFactorEnrollment: boolean;
	twoFactorRecoveryRotation: boolean;
	meetingPlanTranscriptCommit: boolean;
	meetingDecisionLog: boolean;
	meetingReviewA11y: boolean;
	backupEncryptedDownload: boolean;
	backupDryRun: boolean;
	backupRestoreApply: boolean;
};

type TwoFactorState = {
	two_factor_enabled: boolean;
	verified: boolean;
	backup_codes: string | null;
};

type MeetingState = {
	id: string;
	hub_task_id: string;
	status: string;
	transcript: string | null;
	extraction: unknown;
	hub_description: string | null;
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

async function assertNoHorizontalOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`release_horizontal_overflow_${label}`);
}

async function captureEvidence(page: Page, browserName: BrowserName, label: string) {
	if (!SCREENSHOT_DIR) return;
	await mkdir(SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
	await page.screenshot({
		path: `${SCREENSHOT_DIR}/${browserName}-${label}.png`,
		fullPage: true,
	});
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

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(value: string) {
	let bits = "";
	for (const char of value.replace(/=+$/g, "").toUpperCase()) {
		const index = BASE32.indexOf(char);
		if (index < 0) throw new Error("release_totp_secret_invalid");
		bits += index.toString(2).padStart(5, "0");
	}
	const bytes: number[] = [];
	for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
		bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
	}
	return Buffer.from(bytes);
}

function totp(secret: string) {
	const counter = Math.floor(Date.now() / 30_000);
	const input = Buffer.alloc(8);
	input.writeBigUInt64BE(BigInt(counter));
	const digest = createHmac("sha1", decodeBase32(secret)).update(input).digest();
	const offset = (digest.at(-1) ?? 0) & 0x0f;
	const binary =
		(((digest[offset] ?? 0) & 0x7f) << 24) |
		(((digest[offset + 1] ?? 0) & 0xff) << 16) |
		(((digest[offset + 2] ?? 0) & 0xff) << 8) |
		((digest[offset + 3] ?? 0) & 0xff);
	return String(binary % 1_000_000).padStart(6, "0");
}

async function twoFactorState(userId: string): Promise<TwoFactorState | null> {
	const rows = (await db.execute(sql`
		SELECT u.two_factor_enabled, tf.verified, tf.backup_codes
		FROM users u LEFT JOIN two_factors tf ON tf.user_id = u.id
		WHERE u.id = ${userId}::uuid LIMIT 1
	`)) as TwoFactorState[];
	return rows[0] ?? null;
}

async function serverMeetingByTitle(title: string): Promise<MeetingState | null> {
	const rows = (await db.execute(sql`
		SELECT m.id, m.hub_task_id, m.status, m.transcript, m.extraction,
		       hub.description AS hub_description
		FROM meetings m
		JOIN tasks hub ON hub.id = m.hub_task_id
		WHERE m.title = ${title} LIMIT 1
	`)) as MeetingState[];
	return rows[0] ?? null;
}

async function meetingActionCount(meetingId: string, name: string) {
	const rows = (await db.execute(sql`
		SELECT count(*)::int AS count FROM tasks
		WHERE meeting_id = ${meetingId} AND name = ${name}
	`)) as { count: number }[];
	return Number(rows[0]?.count ?? 0);
}

async function restoreAuditCount(userId: string) {
	const rows = (await db.execute(sql`
		SELECT count(*)::int AS count FROM audit_events
		WHERE actor_user_id = ${userId}::uuid AND entity = 'backup' AND action = 'restore'
	`)) as { count: number }[];
	return Number(rows[0]?.count ?? 0);
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

async function verifyTwoFactor(page: Page, fixture: Fixture) {
	await navigate(page, "/nastaveni");
	const password = page.getByLabel("Aktuální heslo (pokud ho účet používá)", {
		exact: true,
	});
	await password.fill(fixture.password);
	await page.getByRole("button", { name: "Nastavit 2FA", exact: true }).click();
	const uriNode = page.locator("code").filter({ hasText: "otpauth://" }).first();
	await uriNode.waitFor();
	const uri = (await uriNode.textContent())?.trim();
	if (!uri) throw new Error("release_totp_uri_missing");
	const secret = new URL(uri).searchParams.get("secret");
	if (!secret) throw new Error("release_totp_secret_missing");
	await page.getByLabel("Kódy mám uložené mimo toto zařízení", { exact: true }).check();
	const remainingMs = 30_000 - (Date.now() % 30_000);
	if (remainingMs < 3_000) await page.waitForTimeout(remainingMs + 250);
	await page.getByLabel("Šestimístný kód", { exact: true }).fill(totp(secret));
	await page.getByRole("button", { name: "Ověřit a zapnout", exact: true }).click();
	await page.getByText("Zapnuto", { exact: true }).waitFor();
	const enrolled = await eventually(
		"two_factor_enrolled",
		() => twoFactorState(fixture.userId),
		(value) => Boolean(value?.two_factor_enabled && value.verified && value.backup_codes),
	);
	if (!enrolled?.backup_codes) throw new Error("release_two_factor_state_missing");
	const originalBackupCodes = enrolled.backup_codes;

	await password.fill(fixture.password);
	await page.getByRole("button", { name: "Vygenerovat nové kódy", exact: true }).click();
	await page.getByText("Nové jednorázové kódy", { exact: true }).waitFor();
	const rotated = await eventually(
		"two_factor_recovery_rotated",
		() => twoFactorState(fixture.userId),
		(value) => Boolean(value?.backup_codes && value.backup_codes !== originalBackupCodes),
	);
	if (!rotated?.backup_codes) throw new Error("release_two_factor_rotation_missing");
	await page.getByLabel("Kódy mám uložené mimo toto zařízení", { exact: true }).check();
	await page.getByRole("button", { name: "Hotovo", exact: true }).click();
}

async function verifyMeeting(page: Page, fixture: Fixture, browserName: BrowserName) {
	const meetingTitle = `Release porada ${browserName} ${crypto.randomUUID().slice(0, 8)}`;
	const actionTitle = `Release připraví podklady ${crypto.randomUUID().slice(0, 6)} p2`;
	const decisionTitle = "Rozhodnutí: schválili jsme variantu B.";
	const transcript = `- ${actionTitle}\n- ${decisionTitle}`;
	const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
	const policyStatus = await page.evaluate(
		async ({ api, workspaceId }) => {
			const response = await fetch(`${api}/api/ai/policies`, {
				method: "PUT",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					workspaceId,
					capability: "meeting_extract",
					level: "suggest",
					vendorConsent: true,
					dailyLimit: 10,
				}),
			});
			return response.status;
		},
		{ api: API, workspaceId: fixture.workspaceId },
	);
	if (policyStatus !== 200) throw new Error(`release_ai_policy_${policyStatus}`);

	await navigate(page, "/meets");
	await page.getByRole("button", { name: "+ Naplánovat meet", exact: true }).click();
	await page.getByLabel("Název porady", { exact: true }).fill(meetingTitle);
	await page.getByLabel("Datum porady", { exact: true }).fill(tomorrow);
	await page.getByRole("button", { name: `Release ${browserName} (ty)`, exact: true }).waitFor();
	await assertAxeClean(page, "meeting_plan");
	await page.getByRole("button", { name: "Naplánovat meet", exact: true }).click();
	const planned = await eventually(
		"meeting_planned",
		() => serverMeetingByTitle(meetingTitle),
		(value) => value?.status === "scheduled",
	);
	if (!planned) throw new Error("release_meeting_plan_missing");

	const meetingRow = page.getByRole("button").filter({ hasText: meetingTitle });
	await meetingRow.waitFor();
	await meetingRow.click();
	await page.getByText(meetingTitle, { exact: true }).first().waitFor();
	await page.getByRole("button", { name: "Vložit zápis", exact: true }).click();
	await page.getByLabel("Přepis porady", { exact: true }).fill(transcript);
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "Vytáhnout akční body →", exact: true }).click();
	const actionInput = page.getByLabel("Název akčního bodu", { exact: true });
	await actionInput.waitFor({ timeout: 120_000 });
	const reviewedActionTitle = await actionInput.inputValue();
	if (!/podklad/i.test(reviewedActionTitle)) {
		throw new Error("release_meeting_action_review_mismatch");
	}
	await page
		.getByText("Rozhodnutí — uloží se k poradě", { exact: true })
		.waitFor({ timeout: 120_000 });
	await assertAxeClean(page, "meeting_review");
	await page.getByRole("button", { name: /Založit \d+ akční/ }).click();
	await page.getByText(/Porada je zpracovaná/).waitFor();
	const committed = await eventually(
		"meeting_committed",
		() => serverMeetingByTitle(meetingTitle),
		(value) => value?.status === "committed",
	);
	if (!committed) throw new Error("release_meeting_commit_missing");
	if (committed.transcript !== transcript) throw new Error("release_meeting_transcript_mismatch");
	if (!committed.hub_description?.includes("Rozhodnutí z porady")) {
		throw new Error("release_meeting_decision_log_missing");
	}
	if ((await meetingActionCount(committed.id, reviewedActionTitle)) < 1) {
		throw new Error("release_meeting_action_missing");
	}
	return committed.id;
}

async function verifyBackupRestore(page: Page, fixture: Fixture) {
	await navigate(page, "/nastaveni");
	const passphrase = `Release-backup-${crypto.randomUUID()}`;
	await page.getByLabel("Heslo exportu a obnovy", { exact: true }).fill(passphrase);
	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 30_000 }),
		page.getByRole("button", { name: "Stáhnout export", exact: true }).click(),
	]);
	const downloadPath = await download.path();
	if (!downloadPath) throw new Error("release_backup_download_missing");
	const encrypted = JSON.parse(await readFile(downloadPath, "utf8")) as {
		kind?: string;
		ciphertext?: string;
		tables?: unknown;
	};
	if (
		encrypted.kind !== "encrypted-server-export" ||
		typeof encrypted.ciphertext !== "string" ||
		encrypted.ciphertext.length < 100 ||
		encrypted.tables !== undefined
	) {
		throw new Error("release_backup_not_encrypted");
	}

	await page
		.getByLabel("Vybrat JSON export pro obnovu", { exact: true })
		.setInputFiles(downloadPath);
	await page.getByText(/Vybráno:/).waitFor();
	await page.getByRole("button", { name: "Zkontrolovat bez změn", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "Dry-run:" }).waitFor();
	const auditBefore = await restoreAuditCount(fixture.userId);
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "Obnovit chybějící data", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "Obnova:" }).waitFor();
	await eventually(
		"backup_restore_audit",
		() => restoreAuditCount(fixture.userId),
		(value) => value === auditBefore + 1,
	);
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
		await captureEvidence(page, browserName, "synced-1280");
		const taskName = `Release offline ${browserName} ${crypto.randomUUID().slice(0, 8)}`;
		const editedName = `${taskName} upraveno`;
		await page.getByRole("button", { name: "Přidat úkol", exact: true }).first().click();
		const addDialog = page.getByRole("dialog", { name: "Přidat úkol" });
		await addDialog.waitFor({ state: "visible" });
		await addDialog.getByRole("button", { name: "Inbox", exact: true }).waitFor();
		await assertAxeClean(page, "add_dialog");
		await context.setOffline(true);
		await page.setViewportSize({ width: 390, height: 844 });
		await page
			.locator('[data-trust-notice="offline_cached"]')
			.waitFor({ state: "visible", timeout: 10_000 });
		await assertNoHorizontalOverflow(page, "offline_trust_state_390");
		await assertAxeClean(page, "offline_trust_state");
		await captureEvidence(page, browserName, "offline-390");
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
		await page
			.locator(
				'[data-trust-notice="offline_cached"], [data-trust-notice="connecting_cached"], [data-trust-notice="sync_error_cached"]',
			)
			.waitFor({ state: "hidden", timeout: 30_000 });
		await page.setViewportSize({ width: 1280, height: 720 });
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
		await page
			.locator('[data-trust-notice="sync_problems"]')
			.waitFor({ state: "visible", timeout: 5_000 });
		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoHorizontalOverflow(page, "sync_problem_trust_state_390");
		await assertAxeClean(page, "sync_problem_trust_state");
		await captureEvidence(page, browserName, "sync-problem-390");
		await page.setViewportSize({ width: 1280, height: 720 });
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

		await verifyTwoFactor(page, fixture);
		await verifyMeeting(page, fixture, browserName);
		await verifyBackupRestore(page, fixture);

		await context.close();
		return {
			browser: browserName,
			signIn: true,
			initialSync: true,
			offlineLocalCreate: true,
			offlineTrustState: true,
			trustStateMobileReflow: true,
			serverWriteHeldOffline: true,
			reconnectUpload: true,
			editRoundTrip: true,
			moveRoundTrip: true,
			rejectionCaptured: true,
			syncProblemTrustState: true,
			rejectionDiscarded: true,
			retryResolved: true,
			addDialogA11y: true,
			taskDetailA11y: true,
			twoFactorEnrollment: true,
			twoFactorRecoveryRotation: true,
			meetingPlanTranscriptCommit: true,
			meetingDecisionLog: true,
			meetingReviewA11y: true,
			backupEncryptedDownload: true,
			backupDryRun: true,
			backupRestoreApply: true,
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
		`Release E2E: ${results.length}/${BROWSERS.length} browserů, task/offline recovery + 2FA + meeting commit + backup/restore prošly.`,
	);
	console.log(`Artifact: ${ARTIFACT}`);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
