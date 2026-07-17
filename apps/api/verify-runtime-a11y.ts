/**
 * F0 / R-01 — reprodukovatelný browser release audit.
 *
 * Předpoklady: běžící API, Vite web a migrovaná DB s testovacím účtem. Přihlášení
 * používá jednorázový Better Auth token přímo z DB; token ani cookie se nelogují.
 *
 * Lokálně například:
 *   WATSON_RUNTIME_BROWSERS=webkit pnpm --filter @watson/api verify:runtime-a11y
 */
import "./src/env";
import { writeFile } from "node:fs/promises";
import { getDb, sql } from "@watson/db";
import axe from "axe-core";
import {
	type Browser,
	type BrowserContext,
	type ConsoleMessage,
	chromium,
	type Page,
	webkit,
} from "playwright";

const API = process.env.WATSON_RUNTIME_API ?? "http://localhost:8787";
const WEB = process.env.WATSON_RUNTIME_WEB ?? "http://localhost:5173";
const EMAIL = process.env.WATSON_RUNTIME_EMAIL ?? "demo@watson.test";
const ARTIFACT = process.env.WATSON_RUNTIME_ARTIFACT ?? "/tmp/watson-runtime-a11y.json";
const ROUTES = [
	"/",
	"/prehled",
	"/hledat",
	"/schranka",
	"/mail",
	"/meets",
	"/ukoly",
	"/nadchazejici",
	"/projekty",
	"/prijem-prace",
	"/seznamy",
	"/cile",
	"/reporty",
	"/postupy",
	"/nastaveni",
] as const;
const WIDTHS = [390, 1440] as const;
const THEMES = ["light", "dark"] as const;
const SETTINGS_SECTIONS = [
	"profil",
	"tym",
	"zabezpeceni",
	"data",
	"integrace",
	"oznameni",
	"vzhled",
] as const;
const selectedRoutes = process.env.WATSON_RUNTIME_ROUTES
	? ROUTES.filter((route) => process.env.WATSON_RUNTIME_ROUTES?.split(",").includes(route))
	: ROUTES;
const selectedWidths = process.env.WATSON_RUNTIME_WIDTHS
	? WIDTHS.filter((width) => process.env.WATSON_RUNTIME_WIDTHS?.split(",").includes(String(width)))
	: WIDTHS;
const selectedThemes = process.env.WATSON_RUNTIME_THEMES
	? THEMES.filter((theme) => process.env.WATSON_RUNTIME_THEMES?.split(",").includes(theme))
	: THEMES;

if (selectedRoutes.length === 0) throw new Error("runtime_route_selection_empty");
if (selectedWidths.length === 0) throw new Error("runtime_width_selection_empty");
if (selectedThemes.length === 0) throw new Error("runtime_theme_selection_empty");

type BrowserName = "chromium" | "webkit";
type RuntimeEvent = { type: "console.error" | "pageerror" | "requestfailed"; text: string };
type Violation = {
	id: string;
	impact: string | null;
	nodes: number;
	targets: { target: string; summary: string }[];
};
type MatrixResult = {
	browser: BrowserName;
	theme: (typeof THEMES)[number];
	width: (typeof WIDTHS)[number];
	route: (typeof ROUTES)[number];
	overflow: boolean;
	hasMain: boolean;
	violations: Violation[];
	events: RuntimeEvent[];
};

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const sanitize = (value: string) => value.replace(uuidPattern, ":id").slice(0, 600);

function parseCookieLines(headers: Headers) {
	const raw = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
	return raw.flatMap((line) => {
		const pair = line.split(";", 1)[0];
		if (!pair) return [];
		const equals = pair.indexOf("=");
		if (equals < 1) return [];
		return [{ name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim() }];
	});
}

async function authenticatedCookies() {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: WEB },
		body: JSON.stringify({ email: EMAIL, callbackURL: `${WEB}/` }),
	});
	if (!requested.ok) throw new Error(`runtime_magic_link_http_${requested.status}`);
	const rows = (await getDb().execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const token = rows[0]?.identifier;
	if (!token) throw new Error("runtime_magic_link_token_missing");
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(`${WEB}/`)}`,
		{ redirect: "manual" },
	);
	const cookies = parseCookieLines(verified.headers);
	if (verified.status !== 302 || cookies.length === 0) {
		throw new Error(`runtime_magic_link_verify_${verified.status}`);
	}
	return cookies;
}

function watchRuntime(page: Page, events: RuntimeEvent[]) {
	page.on("pageerror", (error) => events.push({ type: "pageerror", text: sanitize(`${error.name}: ${error.message}`) }));
	page.on("console", (message: ConsoleMessage) => {
		if (message.type() === "error") events.push({ type: "console.error", text: sanitize(message.text()) });
	});
	page.on("requestfailed", (request) => {
		const error = request.failure()?.errorText ?? "failed";
		if (/cancelled|canceled|aborted/i.test(error)) return;
		let path = "request";
		try {
			path = new URL(request.url()).pathname;
		} catch {
			/* jen bezpečná obecná hodnota */
		}
		events.push({ type: "requestfailed", text: sanitize(`${request.method()} ${path}: ${error}`) });
	});
}

async function navigate(page: Page, route: string) {
	await page.evaluate((path) => {
		window.history.pushState({}, "", path);
		window.dispatchEvent(new PopStateEvent("popstate"));
	}, route);
	await page.waitForFunction(
		(path) => {
			const target = new URL(path, location.origin);
			return (
				location.pathname === target.pathname &&
				location.search === target.search &&
				location.hash === target.hash
			);
		},
		route,
		{ timeout: 5_000 },
	);
	await page.waitForSelector("main", { timeout: 15_000 });
	await page.waitForTimeout(700);
}

async function activateTheme(page: Page, theme: (typeof THEMES)[number]) {
	await page.evaluate((nextTheme) => localStorage.setItem("w-theme", nextTheme), theme);
	await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
	await page.waitForSelector("main", { timeout: 30_000 });
	await page.waitForFunction(
		() =>
			Boolean(
				(globalThis as unknown as { __watsonDb?: { currentStatus?: { hasSynced?: boolean } } })
					.__watsonDb?.currentStatus?.hasSynced,
			),
		{ timeout: 30_000 },
	);
	await page.waitForFunction(
		(nextTheme) =>
			(document.documentElement.getAttribute("data-w-theme") === "dark" ? "dark" : "light") ===
			nextTheme,
		theme,
		{ timeout: 5_000 },
	);
}

async function axeAudit(page: Page) {
	await page.evaluate(axe.source);
	return page.evaluate(async () => {
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
		return {
			overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			hasMain: Boolean(document.querySelector("main")),
			violations: result.violations.map((item) => ({
				id: item.id,
				impact: item.impact,
				nodes: item.nodes.length,
				targets: item.nodes.slice(0, 5).map((node) => ({
					target: node.target.join(" "),
					summary: (node.failureSummary ?? "").slice(0, 300),
				})),
			})),
		};
	});
}

async function keyboardAudit(page: Page) {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await activateTheme(page, "light");
	await navigate(page, "/");
	const taskCardLayering = await page.locator(".w-taskcard").first().evaluate((card) => {
		const openButton = card.querySelector<HTMLElement>("[data-task-open]");
		const title = card.querySelector<HTMLElement>("[data-task-title]");
		const check = card.querySelector<HTMLElement>(".w-taskcheck");
		if (!openButton || !title || !check) return false;
		const titleRect = title.getBoundingClientRect();
		const titleButton = document
			.elementFromPoint(titleRect.left + titleRect.width / 2, titleRect.top + titleRect.height / 2)
			?.closest("button");
		const checkRect = check.getBoundingClientRect();
		const checkButton = document
			.elementFromPoint(checkRect.left + checkRect.width / 2, checkRect.top + checkRect.height / 2)
			?.closest("button");
		return titleButton === openButton && checkButton === check;
	});
	if (!taskCardLayering) throw new Error("runtime_task_card_layering_failed");
	const opener = page.getByRole("button", { name: "Přidat úkol", exact: true }).first();
	await opener.evaluate((node) => {
		(node as HTMLElement).dataset.runtimeOpener = "true";
		(node as HTMLElement).focus();
	});
	await page.keyboard.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
	await dialog.waitFor({ state: "visible" });
	const focusTrail: boolean[] = [];
	for (let index = 0; index < 14; index += 1) {
		await page.keyboard.press("Tab");
		focusTrail.push(await dialog.evaluate((node) => node.contains(document.activeElement)));
	}
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	const focusRestored = await page.evaluate(
		() => (document.activeElement as HTMLElement | null)?.dataset.runtimeOpener === "true",
	);
	if (!focusTrail.every(Boolean) || !focusRestored) throw new Error("runtime_dialog_focus_failed");

	await navigate(page, "/mail");
	const mailButton = page.getByRole("button", { name: /^Otevřít vlákno / }).first();
	await mailButton.focus();
	const threadId = await mailButton.evaluate((node) => node.closest("[data-mrow]")?.getAttribute("data-tid"));
	await page.keyboard.press("Enter");
	await page.waitForTimeout(150);
	const selectedThread = await page.locator("[data-mrow][data-sel]").first().getAttribute("data-tid");
	if (!threadId || selectedThread !== threadId) throw new Error("runtime_mail_keyboard_open_failed");
	const separator = page.getByRole("separator", { name: "Šířka seznamu zpráv" });
	await separator.focus();
	const before = Number(await separator.getAttribute("aria-valuenow"));
	await page.keyboard.press("ArrowRight");
	await page.waitForTimeout(150);
	const after = Number(await separator.getAttribute("aria-valuenow"));
	if (!Number.isFinite(before) || after !== Math.min(620, before + 20)) {
		throw new Error(`runtime_mail_separator_failed_${before}_${after}`);
	}
	return {
		taskCardLayering,
		dialogTabStops: focusTrail.length,
		focusRestored,
		mailThreadKeyboard: true,
		separatorBefore: before,
		separatorAfter: after,
	};
}

async function reflowAudit(page: Page) {
	await page.setViewportSize({ width: 720, height: 900 });
	const results: { route: string; overflow: boolean; hasMain: boolean }[] = [];
	for (const route of ["/", "/mail", "/nastaveni"]) {
		await navigate(page, route);
		results.push(await page.evaluate(() => ({
			route: location.pathname,
			overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			hasMain: Boolean(document.querySelector("main")),
		})));
	}
	if (results.some((result) => result.overflow || !result.hasMain)) throw new Error("runtime_200_percent_reflow_failed");
	return results;
}

async function settingsSectionsAudit(page: Page, events: RuntimeEvent[]) {
	const results: {
		section: (typeof SETTINGS_SECTIONS)[number];
		width: 390 | 1440;
		urlSection: string | null;
		activeLink: boolean;
		heading: boolean;
		overflow: boolean;
		violations: Violation[];
		events: RuntimeEvent[];
	}[] = [];
	for (const width of [390, 1440] as const) {
		await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
		for (const section of SETTINGS_SECTIONS) {
			const eventStart = events.length;
			await navigate(page, `/nastaveni?sekce=${section}`);
			const result = await axeAudit(page);
			results.push({
				section,
				width,
				urlSection: await page.evaluate(() => new URL(location.href).searchParams.get("sekce")),
				activeLink: (await page.locator('.w-settings-nav [aria-current="page"]').count()) === 1,
				heading: (await page.locator(`#settings-section-${section}`).count()) === 1,
				overflow: result.overflow,
				violations: result.violations,
				events: events.slice(eventStart),
			});
		}
	}
	await page.evaluate(() => {
		window.history.pushState({}, "", "/nastaveni#posta-admin");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	await page.waitForFunction(
		() => new URL(location.href).searchParams.get("sekce") === "integrace",
		undefined,
		{ timeout: 5_000 },
	);
	if (
		results.some(
			(result) =>
				result.urlSection !== result.section ||
				!result.activeLink ||
				!result.heading ||
				result.overflow ||
				result.violations.length > 0 ||
				result.events.length > 0,
		)
	)
		throw new Error("runtime_settings_sections_failed");
	await page.setViewportSize({ width: 1440, height: 1000 });
	await navigate(page, "/nastaveni?sekce=tym");
	const roleTrigger = page.locator('[aria-haspopup="menu"]:not([disabled])').first();
	let roleMenuEscapeFocus: boolean | null = null;
	if ((await roleTrigger.count()) > 0) {
		await roleTrigger.focus();
		await page.keyboard.press("Enter");
		const roleMenu = page.getByRole("menu").first();
		await roleMenu.waitFor({ state: "visible", timeout: 5_000 });
		await page.keyboard.press("Escape");
		await roleMenu.waitFor({ state: "hidden", timeout: 5_000 });
		roleMenuEscapeFocus = await roleTrigger.evaluate((node) => node === document.activeElement);
		if (!roleMenuEscapeFocus) throw new Error("runtime_settings_role_menu_focus_failed");
	}
	return { results, legacyMailAdminLink: true, roleMenuEscapeFocus };
}

async function auditBrowser(
	browserName: BrowserName,
	launcher: typeof chromium | typeof webkit,
	cookies: Awaited<ReturnType<typeof authenticatedCookies>>,
) {
	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	try {
		browser = await launcher.launch({ headless: true });
		context = await browser.newContext({ locale: "cs-CZ", reducedMotion: "reduce" });
		await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: API })));
		const page = await context.newPage();
		const events: RuntimeEvent[] = [];
		watchRuntime(page, events);
		await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.waitForFunction(
			() =>
				Boolean(
					(globalThis as unknown as { __watsonDb?: { currentStatus?: { hasSynced?: boolean } } })
						.__watsonDb?.currentStatus?.hasSynced,
				),
			{ timeout: 30_000 },
		);
		await page.waitForTimeout(500);
		if (await page.getByLabel("E-mail").count()) throw new Error("runtime_authentication_failed");

		const matrix: MatrixResult[] = [];
		for (const theme of selectedThemes) {
			await activateTheme(page, theme);
			for (const width of selectedWidths) {
				await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
				for (const route of selectedRoutes) {
					const eventStart = events.length;
					await navigate(page, route);
					const result = await axeAudit(page);
					matrix.push({ browser: browserName, theme, width, route, ...result, events: events.slice(eventStart) });
				}
			}
		}
		const keyboard = await keyboardAudit(page);
		const reflow = await reflowAudit(page);
		const settings = await settingsSectionsAudit(page, events);
		return { browser: browserName, matrix, keyboard, reflow, settings };
	} finally {
		await context?.close().catch(() => undefined);
		await browser?.close().catch(() => undefined);
	}
}

async function main() {
	const selected = (process.env.WATSON_RUNTIME_BROWSERS ?? "chromium,webkit")
		.split(",")
		.map((value) => value.trim())
		.filter((value): value is BrowserName => value === "chromium" || value === "webkit");
	if (selected.length === 0) throw new Error("runtime_browser_selection_empty");
	const cookies = await authenticatedCookies();
	const audits = [];
	for (const browserName of selected) {
		audits.push(
			await auditBrowser(browserName, browserName === "chromium" ? chromium : webkit, cookies),
		);
	}
	const matrix = audits.flatMap((audit) => audit.matrix);
	const failures = {
		overflow: matrix.filter((item) => item.overflow),
		missingMain: matrix.filter((item) => !item.hasMain),
		violations: matrix.flatMap((item) => item.violations.map((violation) => ({ ...violation, browser: item.browser, theme: item.theme, width: item.width, route: item.route }))),
		runtimeErrors: matrix.filter((item) => item.events.length > 0),
		settings: audits.flatMap((audit) =>
			audit.settings.results.filter(
				(result) =>
					result.urlSection !== result.section ||
					!result.activeLink ||
					!result.heading ||
					result.overflow ||
					result.violations.length > 0 ||
					result.events.length > 0,
			),
		),
	};
	const report = {
		createdAt: new Date().toISOString(),
		browsers: selected,
		pages: matrix.length,
		reducedMotion: true,
		keyboard: audits.map((audit) => ({ browser: audit.browser, ...audit.keyboard })),
		reflow: audits.map((audit) => ({ browser: audit.browser, results: audit.reflow })),
		settings: audits.map((audit) => ({ browser: audit.browser, ...audit.settings })),
		failureCounts: Object.fromEntries(Object.entries(failures).map(([key, value]) => [key, value.length])),
		failures,
	};
	await writeFile(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	console.log(
		`Runtime a11y: ${report.pages} stránek, ${selected.join("+")}, axe ${failures.violations.length}, overflow ${failures.overflow.length}, runtime ${failures.runtimeErrors.length}.`,
	);
	console.log(`Artifact: ${ARTIFACT}`);
	process.exit(Object.values(report.failureCounts).some((count) => count > 0) ? 1 : 0);
}

await main();
