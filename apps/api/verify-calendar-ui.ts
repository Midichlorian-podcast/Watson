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
}

async function weekHeaderDays(page: Page) {
	return page.locator("[data-calendar-day-header]").evaluateAll((elements) =>
		elements.map((element) => ({
			date: (element as HTMLElement).dataset.calendarDayHeader ?? "",
			kind: (element as HTMLElement).dataset.calendarDayKind ?? "",
		})),
	);
}

async function waitForWeekStart(page: Page, expected: string) {
	await page.waitForFunction(
		(date) =>
			document.querySelector<HTMLElement>("[data-calendar-day-header]")?.dataset
				.calendarDayHeader === date,
		expected,
		{ timeout: 1_000 },
	);
}

async function waitForUrlState(page: Page, range: string, date: string) {
	await page.waitForURL(
		(url) => url.searchParams.get("rozsah") === range && url.searchParams.get("datum") === date,
		{ timeout: 2_000 },
	);
}

async function swipe(page: Page, deltaX: number) {
	await page.locator('[data-testid="calendar-root"]').hover();
	await page.mouse.wheel(deltaX, 0);
}

async function assertSevenDayWindow(page: Page, expectedStart: string, label: string) {
	const days = await weekHeaderDays(page);
	assert.equal(days.length, 7, `${label}: week must render exactly seven days`);
	assert.equal(days[0]?.date, expectedStart, `${label}: wrong rolling-window anchor`);
	assert.equal(
		new Set(days.map((day) => day.date)).size,
		7,
		`${label}: week contains duplicate dates`,
	);
	assert.equal(
		days.filter((day) => day.kind === "monday").length,
		1,
		`${label}: Monday boundary is missing`,
	);
	assert.equal(
		days.filter((day) => day.kind === "weekend").length,
		2,
		`${label}: weekend treatment is missing`,
	);
	const presentation = await page.locator("[data-calendar-day-header]").evaluateAll((elements) => {
		const monday = elements.find(
			(element) => (element as HTMLElement).dataset.calendarDayKind === "monday",
		);
		const weekend = elements.find(
			(element) => (element as HTMLElement).dataset.calendarDayKind === "weekend",
		);
		const weekday = elements.find(
			(element) => (element as HTMLElement).dataset.calendarDayKind === "weekday",
		);
		return {
			mondayShadow: monday ? getComputedStyle(monday).boxShadow : "none",
			weekendBackground: weekend ? getComputedStyle(weekend).backgroundColor : "",
			weekdayBackground: weekday ? getComputedStyle(weekday).backgroundColor : "",
		};
	});
	assert.notEqual(presentation.mondayShadow, "none", `${label}: Monday is not bounded visually`);
	assert.notEqual(
		presentation.weekendBackground,
		presentation.weekdayBackground,
		`${label}: weekend is not visually quieter`,
	);
}

async function assertDocumentContained(page: Page, label: string) {
	const metrics = await page.evaluate(() => ({
		documentLeft: document.documentElement.scrollLeft,
		bodyLeft: document.body.scrollLeft,
		overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	}));
	assert.equal(metrics.documentLeft, 0, `${label}: document moved horizontally`);
	assert.equal(metrics.bodyLeft, 0, `${label}: body moved horizontally`);
	assert.equal(metrics.overflows, false, `${label}: calendar escaped into document overflow`);
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
		await page.goto(`${WEB}/nadchazejici?zobrazeni=calendar&rozsah=week&datum=2026-07-13`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await waitForCalendar(page);

		await page.getByRole("button", { name: "Mřížka", exact: true }).click();
		await assertSevenDayWindow(page, "2026-07-13", `${name}:grid:900`);
		const wheelStarted = performance.now();
		await swipe(page, 256);
		await swipe(page, 256);
		await waitForWeekStart(page, "2026-07-29");
		const wheelToPaintMs = Math.round(performance.now() - wheelStarted);
		assert.ok(wheelToPaintMs < 500, `${name}: wheel paint took ${wheelToPaintMs}ms`);
		await waitForUrlState(page, "week", "2026-07-29");
		await assertSevenDayWindow(page, "2026-07-29", `${name}:grid:rolling`);
		await swipe(page, -32);
		await waitForWeekStart(page, "2026-07-28");
		await waitForUrlState(page, "week", "2026-07-28");
		await assertDocumentContained(page, `${name}:grid:900`);

		await page.setViewportSize({ width: 390, height: 844 });
		await assertSevenDayWindow(page, "2026-07-28", `${name}:grid:390`);
		await assertDocumentContained(page, `${name}:grid:390`);

		await page.setViewportSize({ width: 900, height: 820 });
		await page.getByRole("button", { name: "Sloupce", exact: true }).click();
		await assertSevenDayWindow(page, "2026-07-28", `${name}:columns:900`);
		await swipe(page, 32);
		await waitForWeekStart(page, "2026-07-29");
		await waitForUrlState(page, "week", "2026-07-29");

		await page.locator('[data-calendar-range="day"]').click();
		await waitForUrlState(page, "day", "2026-07-29");
		await swipe(page, 64);
		await page.locator('[data-calendar-day="2026-07-31"]').first().waitFor({ timeout: 1_000 });
		await waitForUrlState(page, "day", "2026-07-31");
		await assertDocumentContained(page, `${name}:day`);

		await page.locator('[data-calendar-range="month"]').click();
		await waitForUrlState(page, "month", "2026-07-31");
		await swipe(page, 32);
		await page.locator('[data-calendar-date="2026-08-01"]').waitFor({ timeout: 1_000 });
		await waitForUrlState(page, "month", "2026-08-01");
		assert.equal(
			await page.locator('[data-calendar-day-kind="monday"]').count() > 0,
			true,
			`${name}: month is missing Monday boundaries`,
		);
		assert.equal(
			await page.locator('[data-calendar-day-kind="weekend"]').count() > 0,
			true,
			`${name}: month is missing weekend treatment`,
		);
		await assertDocumentContained(page, `${name}:month`);

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
		await waitForUrlState(page, "month", "2026-09-01");
		assert.deepEqual(runtimeErrors, [], `${name}: runtime errors`);
		await context.close();
		return { browser: name, clickToPaintMs, wheelToPaintMs };
	} finally {
		await browser.close();
	}
}

const cookies = await authenticatedCookies();
const results = [];
for (const browser of BROWSERS) results.push(await runBrowser(browser, cookies));
console.log(JSON.stringify({ calendarUi: "ok", results }));
process.exit(0);
