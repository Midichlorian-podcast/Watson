/** F8b browser audit: PWA manifest, share ingress and existing Quick Capture integration. */
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
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, chromium, type Page, webkit } from "playwright";

const WEB = process.env.PWA_CAPTURE_WEB ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.PWA_CAPTURE_SCREENSHOT_DIR;
const BROWSERS = (process.env.PWA_CAPTURE_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

type Fixture = {
	userId: string;
	workspaceId: string;
	projectId: string;
	email: string;
	password: string;
};

async function provision(browserName: string): Promise<Fixture> {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `pwa-capture-${browserName}-${stamp}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `PWA Capture ${browserName}`,
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
			name: `PWA ${browserName}`,
			ownerId: userId,
			isPersonal: true,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
		await tx.insert(projects).values({ id: projectId, workspaceId, name: "Inbox", ownerId: userId });
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
	});
	return { userId, workspaceId, projectId, email, password };
}

async function cleanup(fixture: Fixture) {
	await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
	await db.delete(users).where(eq(users.id, fixture.userId));
}

async function signIn(page: Page, fixture: Fixture, runtimeErrors: string[]) {
	await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
	await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
	await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
	await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
	await page.waitForSelector("main", { timeout: 30_000 });
	try {
		// Produkční build záměrně nevystavuje databázový debug handle. Veřejný,
		// uživatelsky pravdivý trust state je správný release signál.
		await page.getByRole("status", { name: "Synchronizováno", exact: true }).first().waitFor({
			timeout: 30_000,
		});
	} catch (error) {
		const trustState = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1_000);
		throw new Error(
			`pwa_capture_initial_sync:${runtimeErrors.join(" | ") || "no runtime error"}:${trustState}`,
			{ cause: error },
		);
	}
}

async function eventuallySaved(name: string, description: string, projectId: string) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const rows = (await db.execute(sql`
			SELECT project_id, name, description
			FROM tasks WHERE name = ${name} LIMIT 1
		`)) as Array<{ project_id: string; name: string; description: string | null }>;
		const row = rows[0];
		if (row?.project_id === projectId && row.description === description) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`pwa_capture_task_not_synced:${name}`);
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
	if (violations.length) throw new Error(`pwa_capture_axe_${label}:${violations.join(",")}`);
}

async function screenshot(page: Page, browserName: string, label: string) {
	if (!SCREENSHOT_DIR) return;
	await mkdir(SCREENSHOT_DIR, { recursive: true });
	await page.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-${label}.png`, fullPage: true });
}

async function verifyManifest(page: Page) {
	const response = await page.request.get(`${WEB}/manifest.webmanifest`);
	if (!response.ok()) throw new Error(`pwa_manifest_http_${response.status()}`);
	const manifest = (await response.json()) as {
		id?: string;
		display?: string;
		icons?: Array<{ sizes?: string; purpose?: string }>;
		shortcuts?: Array<{ url?: string }>;
		share_target?: { action?: string; method?: string; params?: Record<string, string> };
	};
	if (manifest.id !== "/" || manifest.display !== "standalone") throw new Error("pwa_manifest_identity");
	if (!manifest.icons?.some((icon) => icon.sizes === "192x192")) throw new Error("pwa_manifest_192");
	if (!manifest.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")) {
		throw new Error("pwa_manifest_maskable");
	}
	if (!manifest.shortcuts?.some((shortcut) => shortcut.url === "/zachytit")) {
		throw new Error("pwa_manifest_capture_shortcut");
	}
	if (
		manifest.share_target?.action !== "/zachytit" ||
		manifest.share_target.method !== "GET" ||
		manifest.share_target.params?.url !== "url"
	) {
		throw new Error("pwa_manifest_share_target");
	}
}

async function verifyBrowser(browser: Browser, browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	const context = await browser.newContext({
		locale: "cs-CZ",
		reducedMotion: "reduce",
		viewport: { width: 1280, height: 900 },
	});
	const page = await context.newPage();
	const runtimeErrors: string[] = [];
	page.on("pageerror", (error) => runtimeErrors.push(error.message));
	page.on("console", (message) => {
		const location = message.location();
		const externalFont =
			location.url.startsWith("https://fonts.googleapis.com/") ||
			location.url.startsWith("https://fonts.gstatic.com/") ||
			message.text().includes("fonts.googleapis.com") ||
			message.text().includes("fonts.gstatic.com");
		if (message.type() === "error" && !message.text().includes("favicon") && !externalFont) {
			runtimeErrors.push(`${message.text()}${location.url ? ` @ ${location.url}` : ""}`);
		}
	});
	try {
		await verifyManifest(page);
		await signIn(page, fixture, runtimeErrors);
		const taskName = `Audit sdílené stránky ${browserName}`;
		const selectedText = "Porovnat informační architekturu s Todoistem.";
		const sourceUrl = "https://example.com/review?q=watson";
		const captureUrl = new URL("/zachytit", WEB);
		captureUrl.searchParams.set("title", taskName);
		captureUrl.searchParams.set("text", selectedText);
		captureUrl.searchParams.set("url", sourceUrl);
		await page.goto(captureUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.waitForURL((url) => url.pathname === "/" && url.search === "");
		const dialog = page.getByRole("dialog", { name: "Rychlé zachycení", exact: true });
		await dialog.waitFor();
		const title = dialog.getByPlaceholder(/Co je potřeba udělat/);
		if ((await title.inputValue()) !== taskName) throw new Error("pwa_capture_title_prefill");
		const contextText = (await dialog.locator("[data-capture-context]").innerText()).replace(/\s+/g, " ");
		if (!contextText.includes(selectedText) || !contextText.includes(sourceUrl)) {
			throw new Error("pwa_capture_context_prefill");
		}
		if (page.url().includes(taskName) || page.url().includes("example.com")) {
			throw new Error("pwa_capture_query_not_removed");
		}
		await assertAxeClean(page, `${browserName}_capture`);
		await screenshot(page, browserName, "capture-1280");
		await dialog.getByRole("button", { name: "Přidat úkol", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await eventuallySaved(taskName, `${selectedText}\n\n${sourceUrl}`, fixture.projectId);

		const rejectedUrl = new URL("/zachytit", WEB);
		rejectedUrl.searchParams.set("title", "Bezpečný úkol");
		rejectedUrl.searchParams.set("url", "javascript:alert(1)");
		await page.goto(rejectedUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.waitForURL((url) => url.pathname === "/" && url.search === "");
		const safeDialog = page.getByRole("dialog", { name: "Rychlé zachycení", exact: true });
		await safeDialog.waitFor();
		if ((await safeDialog.locator("[data-capture-context]").count()) !== 0) {
			throw new Error("pwa_capture_unsafe_context_rendered");
		}
		await safeDialog.getByRole("button", { name: "Zrušit", exact: true }).click();

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${WEB}/nastaveni?sekce=vzhled`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		const pwaHeading = page.getByRole("heading", { name: "Watson jako aplikace", exact: true });
		await pwaHeading.waitFor();
		await pwaHeading.scrollIntoViewIfNeeded();
		await page.getByRole("button", { name: "Kopírovat bookmarklet", exact: true }).waitFor();
		const testButton = page.getByRole("button", { name: "Vyzkoušet zachycení", exact: true });
		await testButton.evaluate((element) => element.scrollIntoView({ block: "center" }));
		const box = await testButton.boundingBox();
		if (!box || box.height < 44) throw new Error(`pwa_capture_mobile_target_${browserName}`);
		const mobileNavBox = await page.locator("[data-mobile-primary]").boundingBox();
		if (mobileNavBox && box.y + box.height > mobileNavBox.y) {
			throw new Error(`pwa_capture_mobile_target_occluded_${browserName}`);
		}
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		);
		if (overflow) throw new Error(`pwa_capture_mobile_overflow_${browserName}`);
		await assertAxeClean(page, `${browserName}_settings_390`);
		await screenshot(page, browserName, "pwa-settings-390");
		if (runtimeErrors.length) throw new Error(`pwa_capture_runtime:${runtimeErrors.join(" | ")}`);

		await page.evaluate(async () => {
			if (!("serviceWorker" in navigator)) throw new Error("service_worker_unavailable");
			await navigator.serviceWorker.ready;
		});
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
			timeout: 15_000,
		});
		runtimeErrors.length = 0;
		// První kontrolovaný online reload proběhne už pod SW a naplní runtime cache
		// volitelného Nastavení.
		await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("heading", { name: "Watson jako aplikace", exact: true }).waitFor();
		if (runtimeErrors.length) throw new Error(`pwa_capture_runtime_cache:${runtimeErrors.join(" | ")}`);
		const cacheAudit = await page.evaluate(async () => {
			const precache = await (await caches.open("watson-precache-v2")).keys();
			const runtime = await (await caches.open("watson-runtime-assets-v1")).keys();
			return {
				captureIngress: precache.some((request) => request.url.includes("/CaptureIngress-")),
				settingsRuntime: runtime.some((request) => request.url.includes("/Nastaveni-")),
			};
		});
		if (!cacheAudit.captureIngress || !cacheAudit.settingsRuntime) {
			throw new Error(`pwa_capture_cache_audit:${JSON.stringify(cacheAudit)}`);
		}
		await context.setOffline(true);
		await page.evaluate((title) => {
			const next = new URL("/zachytit", window.location.origin);
			next.searchParams.set("title", title);
			window.history.pushState(null, "", next);
			window.dispatchEvent(new PopStateEvent("popstate"));
		}, `Offline zachycení ${browserName}`);
		await page.waitForURL((url) => url.pathname === "/" && url.search === "");
		const offlineDialog = page.getByRole("dialog", { name: "Rychlé zachycení", exact: true });
		await offlineDialog.waitFor();
		if ((await offlineDialog.getByPlaceholder(/Co je potřeba udělat/).inputValue()) !== `Offline zachycení ${browserName}`) {
			throw new Error(`pwa_capture_offline_prefill_${browserName}`);
		}
		await assertAxeClean(page, `${browserName}_offline_capture`);
		await screenshot(page, browserName, "capture-offline-390");
		await context.setOffline(false);
		console.log(
			`  ✓ ${browserName}: manifest, share ingress, sanitization, persisted task, runtime cache, offline capture, 390 px and axe`,
		);
	} finally {
		await context.close();
		await cleanup(fixture);
	}
}

for (const browserName of BROWSERS) {
	let browser: Browser | undefined;
	try {
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		await verifyBrowser(browser, browserName);
	} finally {
		await browser?.close();
	}
}

console.log("PWA capture UI: Chromium/WebKit production paths passed.");
process.exit(0);
