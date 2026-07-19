/**
 * Safari/WebKit regression audit for Upcoming calendar responsiveness and trackpad scrolling.
 * Requires the local API and web app to be running.
 */
import "./src/env";
import assert from "node:assert/strict";
import { getDb, sql } from "@watson/db";
import { chromium, type Page, webkit } from "playwright";

const API = process.env.CALENDAR_UI_API ?? "http://localhost:8787";
const WEB = process.env.CALENDAR_UI_WEB ?? "http://localhost:5173";
const EMAIL = process.env.CALENDAR_UI_EMAIL ?? "demo@watson.test";
const BROWSERS = (process.env.CALENDAR_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");

function parseCookieLines(headers: Headers) {
	const raw =
		headers.getSetCookie?.() ??
		(headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
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
	assert.equal(requested.ok, true, `calendar_magic_link_http_${requested.status}`);
	const rows = (await getDb().execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as {
		identifier: string;
	}[];
	const token = rows[0]?.identifier;
	assert.ok(token, "calendar_magic_link_token_missing");
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(`${WEB}/`)}`,
		{ redirect: "manual" },
	);
	const cookies = parseCookieLines(verified.headers);
	assert.equal(verified.status, 302, `calendar_magic_link_verify_${verified.status}`);
	assert.ok(cookies.length > 0, "calendar_session_cookie_missing");
	return cookies;
}

async function waitForCalendar(page: Page) {
	await page.locator('[data-testid="calendar-root"]').waitFor({ timeout: 30_000 });
	await page.getByRole("status", { name: "Synchronizováno", exact: true }).first().waitFor({
		timeout: 30_000,
	});
	await page.locator("[data-calendar-horizontal-scroll]").waitFor({ timeout: 10_000 });
}

async function assertHorizontalTrackpad(page: Page, label: string) {
	const surface = page.locator("[data-calendar-horizontal-scroll]").first();
	const before = await surface.evaluate((element) => {
		const html = document.documentElement;
		element.scrollLeft = 0;
		return {
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			documentLeft: html.scrollLeft,
			url: location.href,
		};
	});
	assert.ok(
		before.scrollWidth > before.clientWidth + 100,
		`${label}: calendar surface is not horizontally scrollable (${before.clientWidth}/${before.scrollWidth})`,
	);
	await surface.hover();
	await page.mouse.wheel(520, 0);
	await page.waitForTimeout(180);
	const after = await surface.evaluate((element) => ({
		scrollLeft: element.scrollLeft,
		documentLeft: document.documentElement.scrollLeft,
		bodyLeft: document.body.scrollLeft,
		url: location.href,
	}));
	assert.ok(after.scrollLeft > 40, `${label}: horizontal trackpad gesture did not move days`);
	assert.equal(after.documentLeft, 0, `${label}: document moved horizontally`);
	assert.equal(after.bodyLeft, 0, `${label}: body moved horizontally`);
	assert.equal(after.url, before.url, `${label}: week scroll unexpectedly changed calendar date`);
}

async function runBrowser(
	name: "chromium" | "webkit",
	cookies: Awaited<ReturnType<typeof authenticatedCookies>>,
) {
	const launcher = name === "webkit" ? webkit : chromium;
	const browser = await launcher.launch({ headless: true });
	try {
		const context = await browser.newContext({
			locale: "cs-CZ",
			reducedMotion: "reduce",
			viewport: { width: 900, height: 820 },
		});
		await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: API })));
		const page = await context.newPage();
		const runtimeErrors: string[] = [];
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") runtimeErrors.push(message.text());
		});
		await page.goto(`${WEB}/nadchazejici?zobrazeni=calendar&rozsah=week&datum=2026-07-11`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await waitForCalendar(page);

		await page.getByRole("button", { name: "Mřížka", exact: true }).click();
		await assertHorizontalTrackpad(page, `${name}:grid:900`);
		await page.setViewportSize({ width: 390, height: 844 });
		await assertHorizontalTrackpad(page, `${name}:grid:390`);
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			),
			false,
			`${name}: calendar escaped into document overflow`,
		);

		await page.setViewportSize({ width: 900, height: 820 });
		await page.getByRole("button", { name: "Sloupce", exact: true }).click();
		await assertHorizontalTrackpad(page, `${name}:columns:900`);

		const label = page.locator('[data-testid="calendar-range-label"]');
		const beforeLabel = await label.textContent();
		const clickStarted = performance.now();
		await page.getByRole("button", { name: "Další", exact: true }).click();
		await page.waitForFunction(
			(previous) =>
				document.querySelector('[data-testid="calendar-range-label"]')?.textContent !== previous,
			beforeLabel,
			{ timeout: 1_000 },
		);
		const clickToPaintMs = Math.round(performance.now() - clickStarted);
		assert.ok(clickToPaintMs < 500, `${name}: navigation paint took ${clickToPaintMs}ms`);
		await page.waitForURL(/datum=2026-07-18/, { timeout: 2_000 });
		assert.deepEqual(runtimeErrors, [], `${name}: runtime errors`);
		await context.close();
		return { browser: name, clickToPaintMs };
	} finally {
		await browser.close();
	}
}

const cookies = await authenticatedCookies();
const results = [];
for (const browser of BROWSERS) results.push(await runBrowser(browser, cookies));
console.log(JSON.stringify({ calendarUi: "ok", results }));
process.exit(0);
