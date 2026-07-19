/** F8a browser audit: role-aware entry points, guided navigation and responsive surfaces. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	users,
	workspaces,
} from "@watson/db";
import axe from "axe-core";
import { hashPassword } from "better-auth/crypto";
import { type Browser, type BrowserContext, chromium, type Page, webkit } from "playwright";

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
	personalWorkspaceId: string;
	projectName: string;
	personalProjectName: string;
	email: string;
	password: string;
};

async function provision(browserName: string, role: "admin" | "member"): Promise<Fixture> {
	const userId = crypto.randomUUID();
	const ownerId = role === "admin" ? userId : crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const personalWorkspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const personalProjectId = crypto.randomUUID();
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const projectName = `Projekt ${role} ${browserName}`;
	const personalProjectName = `Osobní projekt ${role} ${browserName}`;
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
		await tx.insert(workspaces).values({
			id: personalWorkspaceId,
			name: `Osobní ${browserName}`,
			ownerId: userId,
			isPersonal: true,
		});
		if (ownerId !== userId) {
			await tx.insert(memberships).values({ workspaceId, userId: ownerId, role: "admin" });
		}
		await tx.insert(memberships).values({ workspaceId, userId, role });
		await tx.insert(memberships).values({
			workspaceId: personalWorkspaceId,
			userId,
			role: "admin",
		});
		await tx.insert(projects).values([
			{ id: projectId, workspaceId, ownerId: userId, name: projectName },
			{
				id: personalProjectId,
				workspaceId: personalWorkspaceId,
				ownerId: userId,
				name: personalProjectName,
			},
		]);
		await tx.insert(projectMembers).values([
			{ projectId, userId, role: role === "admin" ? "manager" : "editor" },
			{ projectId: personalProjectId, userId, role: "manager" },
		]);
	});
	return {
		userId,
		ownerId,
		workspaceId,
		personalWorkspaceId,
		projectName,
		personalProjectName,
		email,
		password,
	};
}

async function cleanup(fixture: Fixture) {
	await db.delete(workspaces).where(eq(workspaces.id, fixture.personalWorkspaceId));
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
	const responsePromise = page.waitForResponse(
		(response) => response.url().includes("/api/auth/sign-in/email"),
		{ timeout: 30_000 },
	);
	await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
	const response = await responsePromise;
	if (!response.ok()) {
		throw new Error(
			`ia_ui_sign_in_http_${response.status()}:${(await response.text()).slice(0, 500)}`,
		);
	}
	try {
		await page.waitForSelector("main", { timeout: 30_000 });
	} catch {
		const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500);
		throw new Error(`ia_ui_sign_in_or_boot:${page.url()}:${body}`);
	}
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

async function openWindowSurface(
	context: BrowserContext,
	href: string,
	shell: "focus" | "wallboard",
	browserName: string,
) {
	const page = await context.newPage();
	const runtimeErrors: string[] = [];
	page.on("pageerror", (error) => runtimeErrors.push(error.message));
	const response = await page.goto(`${WEB}${href}`, {
		waitUntil: "domcontentloaded",
		timeout: 30_000,
	});
	if (response && !response.ok()) {
		throw new Error(`ia_ui_window_http_${browserName}_${response.status()}:${href}`);
	}
	try {
		await page.locator(`[data-window-chrome="${shell}"]`).waitFor({ timeout: 30_000 });
	} catch {
		const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800);
		throw new Error(
			`ia_ui_window_chrome_${browserName}:${page.url()}:${body}:${runtimeErrors.join(" | ")}`,
		);
	}
	// Hlavička je eager, obrazovka lazy. Nezavírat okno, dokud WebKit nedotáhne
	// modul a API bootstrap; přerušený import jinak vypadá jako runtime chyba aplikace.
	await page.waitForLoadState("networkidle", { timeout: 30_000 });
	if ((await page.locator("aside").count()) !== 0) {
		throw new Error(`ia_ui_window_global_sidebar_${browserName}:${href}`);
	}
	if ((await page.locator("main").count()) !== 1) {
		throw new Error(`ia_ui_window_main_${browserName}:${href}`);
	}
	return { page, runtimeErrors };
}

async function verifyMultiWindowSurfaces(
	context: BrowserContext,
	mainPage: Page,
	fixture: Fixture,
	browserName: "chromium" | "webkit",
	runtimeErrors: string[],
) {
	// Plný shell drží týmový prostor. Focus okno dostane jiný `?prostor=`, ale
	// nesmí jej zapsat do sdílené globální preference ostatních oken.
	await mainPage.evaluate(
		(workspaceId) => localStorage.setItem("watson.activeWs", workspaceId),
		fixture.workspaceId,
	);
	const supportsConcurrentWindows = await mainPage.evaluate(() => {
		const maybeSafari = window as Window & { safari?: unknown };
		return (
			typeof SharedWorker !== "undefined" &&
			!/(Android|iPhone|iPod|iPad)/i.test(navigator.userAgent) &&
			!maybeSafari.safari
		);
	});
	if (!supportsConcurrentWindows) {
		const runtimeErrorStart = runtimeErrors.length;
		// WebKit/mobile mají stejný fail-safe jako runtime: žádná druhá instance
		// lokální DB. Reálný affordance přepne stávající okno do focus shellu.
		await mainPage.getByRole("button", { name: "Otevřít ve fokusovém okně", exact: true }).click();
		await mainPage.waitForURL(
			(url) => url.pathname === "/prehled" && url.searchParams.get("shell") === "focus",
		);
		await mainPage.locator('[data-window-chrome="focus"]').waitFor({ timeout: 30_000 });
		if ((await mainPage.locator("aside").count()) !== 0) {
			throw new Error(`ia_ui_window_fallback_sidebar_${browserName}`);
		}
		await mainPage.getByRole("heading", { name: "Přehled", exact: true }).waitFor();
		const persistedWorkspace = await mainPage.evaluate(() =>
			localStorage.getItem("watson.activeWs"),
		);
		if (persistedWorkspace !== fixture.workspaceId) {
			throw new Error(`ia_ui_window_fallback_workspace_leak_${browserName}:${persistedWorkspace}`);
		}
		await mainPage.getByRole("button", { name: "Zavřít okno", exact: true }).click();
		await mainPage.waitForURL(
			(url) => url.pathname === "/prehled" && !url.searchParams.has("shell"),
		);
		await mainPage.getByRole("heading", { name: "Přehled", exact: true }).waitFor();
		await mainPage
			.getByRole("button", { name: "Otevřít jako velkoplošný přehled", exact: true })
			.click();
		await mainPage.waitForURL(
			(url) => url.pathname === "/prehled" && url.searchParams.get("shell") === "wallboard",
		);
		await mainPage.locator('[data-window-chrome="wallboard"]').waitFor({ timeout: 30_000 });
		if ((await mainPage.locator("aside").count()) !== 0) {
			throw new Error(`ia_ui_window_fallback_wallboard_sidebar_${browserName}`);
		}
		await mainPage.getByRole("heading", { name: "Přehled", exact: true }).waitFor();
		await mainPage.getByRole("button", { name: "Otevřít ve Watsonu", exact: true }).click();
		await mainPage.waitForURL(
			(url) => url.pathname === "/prehled" && !url.searchParams.has("shell"),
		);
		await mainPage.getByRole("heading", { name: "Přehled", exact: true }).waitFor();
		await mainPage.waitForLoadState("networkidle", { timeout: 30_000 });
		if (await mainPage.getByText("Něco se pokazilo", { exact: true }).count()) {
			throw new Error(`ia_ui_window_fallback_screen_${browserName}`);
		}
		const navigationNoise = runtimeErrors.slice(runtimeErrorStart);
		const unexpected = navigationNoise.filter(
			(error) =>
				!error.includes("Importing a module script failed") &&
				!error.includes("due to access control checks"),
		);
		if (unexpected.length) {
			throw new Error(`ia_ui_window_fallback_runtime_${browserName}:${unexpected.join(" | ")}`);
		}
		// WebKit může při location.assign nahlásit přerušený fetch starého shellu.
		// Aktuální focus, wallboard i návrat jsme ověřili až po vykreslení a networkidle.
		runtimeErrors.splice(runtimeErrorStart);
		return;
	}
	const upcoming = await openWindowSurface(
		context,
		`/nadchazejici?shell=focus&prostor=${fixture.personalWorkspaceId}&zobrazeni=calendar&rozsah=week&datum=2026-07-20`,
		"focus",
		browserName,
	);
	try {
		await upcoming.page.getByRole("button", { name: "Nástěnka", exact: true }).first().click();
		try {
			await upcoming.page.waitForURL((url) => {
				return (
					url.pathname === "/nadchazejici" &&
					url.searchParams.get("shell") === "focus" &&
					url.searchParams.get("prostor") === fixture.personalWorkspaceId &&
					url.searchParams.get("zobrazeni") === "board" &&
					url.searchParams.get("rozsah") === "week" &&
					url.searchParams.get("datum") === "2026-07-20"
				);
			});
		} catch {
			throw new Error(`ia_ui_window_url_state_${browserName}:${upcoming.page.url()}`);
		}
		const persistedWorkspace = await mainPage.evaluate(() =>
			localStorage.getItem("watson.activeWs"),
		);
		if (persistedWorkspace !== fixture.workspaceId) {
			throw new Error(`ia_ui_window_workspace_leak_${browserName}:${persistedWorkspace}`);
		}

		// Motiv je naopak vědomě sdílená preference a musí se propsat i do focus
		// shellu, který nemá běžný Header.
		const beforeTheme = await upcoming.page.locator("html").getAttribute("data-w-theme");
		await mainPage.getByRole("button", { name: "Přepnout motiv", exact: true }).click();
		await upcoming.page.waitForFunction(
			(previous) => document.documentElement.getAttribute("data-w-theme") !== previous,
			beforeTheme,
		);
		await mainPage.getByRole("button", { name: "Přepnout motiv", exact: true }).click();
		await upcoming.page.waitForFunction(
			(previous) => document.documentElement.getAttribute("data-w-theme") === previous,
			beforeTheme,
		);
		if (upcoming.runtimeErrors.length) {
			throw new Error(
				`ia_ui_window_runtime_${browserName}_upcoming:${upcoming.runtimeErrors.join(" | ")}`,
			);
		}
	} finally {
		await upcoming.page.close();
	}

	const surfaces: Array<{ href: string; shell: "focus" | "wallboard" }> = [
		{
			href: `/mail?shell=focus&prostor=${fixture.personalWorkspaceId}`,
			shell: "focus",
		},
		{
			href: `/ukoly?shell=focus&prostor=${fixture.workspaceId}&zobrazeni=list`,
			shell: "focus",
		},
		{
			href: `/seznamy?shell=focus&prostor=${fixture.workspaceId}`,
			shell: "focus",
		},
		{
			href: `/prehled?shell=focus&prostor=${fixture.workspaceId}&vstup=tym&rozlozeni=feed`,
			shell: "focus",
		},
		{
			href: `/prehled?shell=wallboard&prostor=${fixture.workspaceId}&vstup=provoz&firma=${fixture.workspaceId}&rozlozeni=grid`,
			shell: "wallboard",
		},
		{
			href: `/velin?shell=focus&prostor=${fixture.workspaceId}&firma=${fixture.workspaceId}`,
			shell: "focus",
		},
		{
			href: `/velin?shell=wallboard&prostor=${fixture.workspaceId}&firma=${fixture.workspaceId}`,
			shell: "wallboard",
		},
	];
	for (const surface of surfaces) {
		const opened = await openWindowSurface(context, surface.href, surface.shell, browserName);
		try {
			if (opened.runtimeErrors.length) {
				throw new Error(
					`ia_ui_window_runtime_${browserName}:${surface.href}:${opened.runtimeErrors.join(" | ")}`,
				);
			}
		} finally {
			await opened.page.close();
		}
	}
}

async function verifyCalendarNavigation(
	page: Page,
	browserName: "chromium" | "webkit",
	runtimeErrors: string[],
) {
	const runtimeErrorStart = runtimeErrors.length;
	const waitForState = async (range: "day" | "week" | "month", date: string) => {
		try {
			await page.waitForURL(
				(url) =>
					url.pathname === "/nadchazejici" &&
					url.searchParams.get("zobrazeni") === "calendar" &&
					url.searchParams.get("rozsah") === range &&
					url.searchParams.get("datum") === date,
				{ timeout: 10_000 },
			);
		} catch {
			throw new Error(
				`ia_ui_calendar_navigation_${browserName}_${range}_${date}:${page.url()}`,
			);
		}
	};

	await page.goto(
		`${WEB}/nadchazejici?zobrazeni=calendar&rozsah=week&datum=2026-07-13`,
		{ waitUntil: "domcontentloaded", timeout: 30_000 },
	);
	const calendar = page.getByTestId("calendar-root");
	await calendar.waitFor({ timeout: 30_000 });
	const horizontalContainment = await page.evaluate(() => {
		const html = getComputedStyle(document.documentElement);
		const body = getComputedStyle(document.body);
		const root = document.querySelector<HTMLElement>("#root");
		const calendarRoot = document.querySelector<HTMLElement>('[data-testid="calendar-root"]');
		return {
			htmlOverscroll: html.overscrollBehaviorX,
			bodyOverscroll: body.overscrollBehaviorX,
			rootOverscroll: root ? getComputedStyle(root).overscrollBehaviorX : "missing",
			calendarOverscroll: calendarRoot
				? getComputedStyle(calendarRoot).overscrollBehaviorX
				: "missing",
			htmlOverflow: html.overflowX,
			bodyOverflow: body.overflowX,
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		};
	});
	if (
		horizontalContainment.htmlOverscroll !== "none" ||
		horizontalContainment.bodyOverscroll !== "none" ||
		horizontalContainment.rootOverscroll !== "none" ||
		horizontalContainment.calendarOverscroll !== "none" ||
		!(["clip", "hidden"] as string[]).includes(horizontalContainment.htmlOverflow) ||
		!(["clip", "hidden"] as string[]).includes(horizontalContainment.bodyOverflow) ||
		horizontalContainment.scrollWidth > horizontalContainment.clientWidth
	) {
		throw new Error(
			`ia_ui_horizontal_gesture_not_contained_${browserName}:${JSON.stringify(horizontalContainment)}`,
		);
	}

	await calendar.getByRole("button", { name: "Další", exact: true }).click();
	await waitForState("week", "2026-07-20");

	const day = calendar.locator('[data-calendar-range="day"]');
	await day.click();
	await waitForState("day", "2026-07-20");
	if ((await day.getAttribute("aria-pressed")) !== "true") {
		throw new Error(`ia_ui_calendar_day_not_selected_${browserName}`);
	}

	await page.keyboard.press("ArrowRight");
	await waitForState("day", "2026-07-21");

	// Dvě prahové jednotky horizontálního gesta (2 × 32 px) posunou den o dva.
	await calendar.dispatchEvent("wheel", { deltaX: 64, deltaY: 0 });
	await waitForState("day", "2026-07-23");
	await calendar.dispatchEvent("wheel", { deltaX: -32, deltaY: 0 });
	await waitForState("day", "2026-07-22");
	if ((await page.evaluate(() => window.scrollX)) !== 0) {
		throw new Error(`ia_ui_calendar_moved_viewport_${browserName}`);
	}

	const month = calendar.locator('[data-calendar-range="month"]');
	await month.click();
	await waitForState("month", "2026-07-22");
	await calendar.getByRole("button", { name: "Další", exact: true }).click();
	await waitForState("month", "2026-08-01");
	// WebKit jinak může přenést zrušený bootstrap request do dalšího page.goto
	// jako falešný CORS pageerror, přestože cílový stav už je správně vykreslený.
	// PowerSync přitom může držet síťovou komunikaci otevřenou, takže zde nelze
	// použít `networkidle`. Cílové URL i stav ovládání jsou ověřené výše.
	await page.waitForTimeout(750);
	const navigationNoise = runtimeErrors.slice(runtimeErrorStart);
	const unexpected = navigationNoise.filter(
		(error) =>
			browserName !== "webkit" ||
			(!error.includes("Importing a module script failed") &&
				!error.includes("due to access control checks")),
	);
	if (unexpected.length) {
		throw new Error(`ia_ui_calendar_runtime_${browserName}:${unexpected.join(" | ")}`);
	}
	// WebKit při rychlé klientské replace navigaci občas nahlásí zrušený fetch
	// starého URL jako CORS/import chybu. Všechny cílové stavy byly výše ověřeny.
	runtimeErrors.splice(runtimeErrorStart);

	console.log(
		`  ✓ ${browserName}: calendar navigation stays inside the surface without viewport drift`,
	);
}

async function verifyMailCommunicationHierarchy(
	page: Page,
	browserName: "chromium" | "webkit",
) {
	await page.goto(`${WEB}/mail`, { waitUntil: "domcontentloaded", timeout: 30_000 });
	const thread = page.locator("[data-threadpane]");
	await thread.waitFor({ timeout: 30_000 });
	const primaryReply = thread.locator("[data-mail-primary-reply]");
	const composer = thread.locator("[data-mail-reply-composer]");
	const editor = composer.locator("[data-rte]");
	const suggestion = composer.locator("[data-mail-ai-suggestion]");
	const preview = suggestion.locator("[data-mail-ai-preview]");
	await primaryReply.waitFor();
	await editor.waitFor();
	await preview.waitFor();
	const swipeRows = page.locator('[data-swipe-surface="mail"]');
	const swipeRowCount = await swipeRows.count();
	if (swipeRowCount < 1) throw new Error(`ia_ui_mail_swipe_surface_missing_${browserName}`);
	const swipeRow = page.locator('[data-tid="opjak"]');
	await swipeRow.waitFor();
	if ((await swipeRow.evaluate((element) => getComputedStyle(element).overscrollBehaviorX)) !== "none") {
		throw new Error(`ia_ui_mail_swipe_not_contained_${browserName}`);
	}
	const defaultSwipe = await swipeRow.evaluate((element) => ({
		r1: element.getAttribute("data-swipe-r1"),
		r2: element.getAttribute("data-swipe-r2"),
		l1: element.getAttribute("data-swipe-l1"),
		l2: element.getAttribute("data-swipe-l2"),
	}));
	if (
		defaultSwipe.r1 !== "read" ||
		defaultSwipe.r2 !== "pin" ||
		defaultSwipe.l1 !== "archive" ||
		defaultSwipe.l2 !== "snooze"
	) {
		throw new Error(`ia_ui_mail_swipe_defaults_${browserName}:${JSON.stringify(defaultSwipe)}`);
	}

	// V testu zpřístupníme haptiku i WebKitu. Produkce ji volá progresivně:
	// platforma bez Vibration API zachová stejnou vizuální prahovou odezvu.
	await page.evaluate(`
		window.__watsonSwipeBuzz = [];
		Object.defineProperty(navigator, "vibrate", {
			configurable: true,
			value: function (pattern) {
				window.__watsonSwipeBuzz.push(Array.isArray(pattern) ? (pattern[0] || 0) : pattern);
				return true;
			}
		});
	`);

	const unreadBeforeVertical = await swipeRow.getAttribute("data-unread");
	await swipeRow.dispatchEvent("wheel", { deltaX: 0, deltaY: 80 });
	await page.waitForTimeout(240);
	if ((await swipeRow.getAttribute("data-unread")) !== unreadBeforeVertical) {
		throw new Error(`ia_ui_mail_vertical_wheel_triggered_swipe_${browserName}`);
	}

	// Přirozený swipe doprava přichází z trackpadu jako záporné deltaX.
	// Krátký práh přepne read/unread až po usazení gesta.
	await swipeRow.dispatchEvent("wheel", { deltaX: -120, deltaY: 0 });
	if ((await swipeRow.locator("[data-swu]").getAttribute("data-mag")) !== "r1") {
		throw new Error(`ia_ui_mail_short_swipe_preview_${browserName}`);
	}
	await page.waitForTimeout(240);
	if ((await swipeRow.getAttribute("data-unread")) === unreadBeforeVertical) {
		throw new Error(`ia_ui_mail_short_swipe_action_${browserName}`);
	}

	// Velký práh je samostatný stav a spouští se až po skončení gesta.
	await swipeRow.dispatchEvent("wheel", { deltaX: -270, deltaY: 0 });
	if ((await swipeRow.locator("[data-swu]").getAttribute("data-mag")) !== "r2") {
		throw new Error(`ia_ui_mail_long_swipe_preview_${browserName}`);
	}
	await page.waitForTimeout(240);
	if ((await swipeRow.getAttribute("data-pinned")) !== "true") {
		throw new Error(`ia_ui_mail_long_swipe_action_${browserName}`);
	}
	const buzz = await page.evaluate(
		() => (window as typeof window & { __watsonSwipeBuzz?: number[] }).__watsonSwipeBuzz ?? [],
	);
	if (!buzz.includes(7) || !buzz.includes(14)) {
		throw new Error(`ia_ui_mail_swipe_haptics_${browserName}:${buzz.join(",")}`);
	}
	if ((await page.evaluate(() => window.scrollX)) !== 0) {
		throw new Error(`ia_ui_mail_swipe_moved_viewport_${browserName}`);
	}

	// Každý ze čtyř slotů musí být samostatně nastavitelný a přetrvat reload.
	await page.goto(`${WEB}/nastaveni?sekce=integrace`, {
		waitUntil: "domcontentloaded",
		timeout: 30_000,
	});
	const swipeSettings = page.locator("[data-mail-swipe-settings]");
	await swipeSettings.waitFor();
	const configured = { r1: "pin", r2: "set_aside", l1: "assign", l2: "read" } as const;
	for (const [slot, action] of Object.entries(configured)) {
		await swipeSettings.locator(`[data-mail-swipe-slot="${slot}"] select`).selectOption(action);
	}
	await page.reload({ waitUntil: "domcontentloaded" });
	await swipeSettings.waitFor();
	for (const [slot, action] of Object.entries(configured)) {
		if (
			(await swipeSettings.locator(`[data-mail-swipe-slot="${slot}"] select`).inputValue()) !== action
		) {
			throw new Error(`ia_ui_mail_swipe_setting_not_persisted_${browserName}:${slot}`);
		}
	}
	await page.setViewportSize({ width: 390, height: 844 });
	const mobileSwipeLayout = await swipeSettings.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		selectWidths: [...element.querySelectorAll("select")].map((select) => select.getBoundingClientRect().width),
	}));
	if (
		mobileSwipeLayout.scrollWidth > mobileSwipeLayout.clientWidth + 1 ||
		mobileSwipeLayout.selectWidths.some((width) => width < 220 || width > mobileSwipeLayout.clientWidth)
	) {
		throw new Error(`ia_ui_mail_swipe_settings_mobile_${browserName}:${JSON.stringify(mobileSwipeLayout)}`);
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`${WEB}/mail`, { waitUntil: "domcontentloaded", timeout: 30_000 });
	await thread.waitFor();
	const configuredRow = page.locator('[data-tid="opjak"]');
	await configuredRow.waitFor();
	for (const [slot, action] of Object.entries(configured)) {
		if ((await configuredRow.getAttribute(`data-swipe-${slot}`)) !== action) {
			throw new Error(`ia_ui_mail_swipe_setting_not_live_${browserName}:${slot}`);
		}
	}
	await page.goto(`${WEB}/nastaveni?sekce=integrace`, {
		waitUntil: "domcontentloaded",
		timeout: 30_000,
	});
	await swipeSettings.waitFor();
	await swipeSettings.getByRole("button", { name: "Obnovit výchozí mapování", exact: true }).click();
	await page.goto(`${WEB}/mail`, { waitUntil: "domcontentloaded", timeout: 30_000 });
	await thread.waitFor();

	const suggestionBox = await suggestion.boundingBox();
	if (!suggestionBox || suggestionBox.height > 130) {
		throw new Error(`ia_ui_mail_ai_not_compact_${browserName}:${suggestionBox?.height ?? "missing"}`);
	}
	const previewText = (await preview.innerText()).trim();
	if (!previewText || previewText.length > 190 || previewText.includes("S pozdravem")) {
		throw new Error(`ia_ui_mail_ai_preview_not_one_sentence_${browserName}:${previewText}`);
	}
	const tasks = thread.locator("[data-mail-context-tasks]");
	if ((await tasks.count()) > 0 && (await tasks.getAttribute("open")) !== null) {
		throw new Error(`ia_ui_mail_tasks_not_collapsed_${browserName}`);
	}
	await primaryReply.click();
	await page.waitForFunction(() => document.activeElement?.matches("[data-rte]"), undefined, {
		timeout: 5_000,
	});

	const more = thread.getByRole("button", { name: "Další akce s e-mailem", exact: true });
	await more.click();
	const workflow = thread.locator("[data-mail-workflow-menu]");
	await workflow.getByText(/Předat/).waitFor();
	await workflow.getByText("Vytvořit navázaný úkol", { exact: true }).waitFor();
	await more.click();

	const sidebar = page.locator("aside");
	const compose = sidebar.getByRole("button", { name: "Napsat e-mail", exact: true });
	await compose.click();
	const newMessage = page.getByRole("dialog", { name: "Nová zpráva", exact: true });
	await newMessage.waitFor();
	await newMessage.getByRole("button", { name: "Zavřít novou zprávu", exact: true }).click();
	await assertAxeClean(page, `${browserName}_mail_communication_hierarchy`);
	await screenshot(page, browserName, "ia-mail-communication-hierarchy");
	console.log(
		`  ✓ ${browserName}: mail hierarchy and four configurable contained swipe states work`,
	);
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
		for (const name of ["Přehled", "Mail", "Úkoly", "Nadcházející"]) {
			await sidebar.getByRole("link", { name: new RegExp(`^${name}`) }).waitFor();
		}
		await sidebar
			.getByRole("button", { name: new RegExp(`^${fixture.personalProjectName}`) })
			.waitFor();
		const availabilityButton = page.getByRole("button", {
			name: "Nerušit a dostupnost",
			exact: true,
		});
		await availabilityButton.waitFor();
		await availabilityButton.click();
		const availabilityDialog = page.getByRole("dialog", { name: "Rychlé Nerušit" });
		await availabilityDialog.waitFor();
		const availabilityOnTop = await availabilityDialog.evaluate((dialog) => {
			const rect = dialog.getBoundingClientRect();
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + Math.min(rect.height / 2, 20);
			const topmost = document.elementFromPoint(centerX, centerY);
			return (
				rect.left >= 0 &&
				rect.right <= window.innerWidth &&
				rect.top >= 0 &&
				rect.bottom <= window.innerHeight &&
				!!topmost &&
				dialog.contains(topmost)
			);
		});
		if (!availabilityOnTop) throw new Error(`ia_ui_availability_behind_page_${browserName}`);
		await page.keyboard.press("Escape");
		const overviewEntries = main.getByRole("navigation", { name: "Moje vstupy", exact: true });
		await overviewEntries.getByRole("button", { name: "Tým", exact: true }).waitFor();
		await overviewEntries.getByRole("button", { name: "Provoz", exact: true }).waitFor();
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

		await overviewEntries.getByRole("button", { name: "Tým", exact: true }).click();
		await page.waitForURL(/\/prehled\?vstup=tym/);
		await page.getByRole("heading", { name: "Tým", exact: true }).waitFor();
		await main.getByText("Komunikace pro mě", { exact: true }).waitFor();
		if ((await main.getByText("Dnes", { exact: true }).count()) !== 0) {
			throw new Error(`ia_ui_team_contains_personal_today_${browserName}`);
		}

		await page.locator("main").getByRole("button", { name: "Provoz", exact: true }).click();
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

		// Zámeček je per modul, ukládá právě otevřený pohled a nový pohled umí
		// jedním kliknutím nahradit starý default. Úkoly a Nadcházející se neovlivňují.
		await page.goto(`${WEB}/ukoly`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("button", { name: "Nástěnka", exact: true }).click();
		const lock = page.getByRole("button", {
			name: "Nastavit toto zobrazení jako výchozí pro tento modul",
			exact: true,
		});
		await lock.click();
		if ((await lock.getAttribute("aria-pressed")) !== "true")
			throw new Error(`ia_ui_task_default_not_locked_${browserName}`);

		await page.goto(`${WEB}/nadchazejici`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		const upcomingList = page.getByRole("button", { name: "Seznam", exact: true });
		if ((await upcomingList.getAttribute("aria-pressed")) !== "true")
			throw new Error(`ia_ui_view_leaked_tasks_to_upcoming_${browserName}`);
		await page.getByRole("button", { name: "Kalendář", exact: true }).click();
		await lock.click();

		await page.goto(`${WEB}/ukoly`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		const taskBoard = page.getByRole("button", { name: "Nástěnka", exact: true });
		if ((await taskBoard.getAttribute("aria-pressed")) !== "true")
			throw new Error(`ia_ui_task_default_not_restored_${browserName}`);
		await page.getByRole("button", { name: "Seznam", exact: true }).click();
		if ((await lock.getAttribute("aria-pressed")) !== "false")
			throw new Error(`ia_ui_lock_claims_unsaved_view_${browserName}`);
		await lock.click();
		const storedAfterReplace = await page.evaluate(() => ({
			tasks: localStorage.getItem("watson.defaultView.v2.tasks"),
			upcoming: localStorage.getItem("watson.defaultView.v2.upcoming"),
		}));
		if (storedAfterReplace.tasks !== "list" || storedAfterReplace.upcoming !== "calendar")
			throw new Error(`ia_ui_default_replace_or_isolation_${browserName}`);
		await lock.click();
		const storedAfterUnlock = await page.evaluate(() => ({
			tasks: localStorage.getItem("watson.defaultView.v2.tasks"),
			upcoming: localStorage.getItem("watson.defaultView.v2.upcoming"),
		}));
		if (storedAfterUnlock.tasks !== null || storedAfterUnlock.upcoming !== "calendar")
			throw new Error(`ia_ui_unlock_cross_surface_${browserName}`);
		await page.reload({ waitUntil: "domcontentloaded" });
		if (
			(await page
				.getByRole("button", { name: "Seznam", exact: true })
				.getAttribute("aria-pressed")) !== "true"
		)
			throw new Error(`ia_ui_unlocked_task_reload_${browserName}`);
		await page.goto(`${WEB}/nadchazejici`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		if (
			(await page
				.getByRole("button", { name: "Kalendář", exact: true })
				.getAttribute("aria-pressed")) !== "true"
		)
			throw new Error(`ia_ui_upcoming_default_reload_${browserName}`);
		await verifyCalendarNavigation(page, browserName, runtimeErrors);
		await verifyMailCommunicationHierarchy(page, browserName);

		await page.goto(`${WEB}/projekty`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("button", { name: "Přidat projekt do Mých záložek", exact: true }).click();
		await sidebar.getByRole("button", { name: fixture.projectName, exact: true }).waitFor();

		await page.goto(`${WEB}/ukoly`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		const savedViewsButton = page.getByRole("button", { name: "Pohledy", exact: true });
		try {
			await savedViewsButton.click({ timeout: 30_000 });
		} catch {
			const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800);
			throw new Error(`ia_ui_saved_views_button_missing:${page.url()}:${body}`);
		}
		const savedViewName = `Moje kontrola ${browserName}`;
		await page.getByPlaceholder("Název pohledu", { exact: true }).fill(savedViewName);
		await page.getByRole("button", { name: "Uložit", exact: true }).click();
		await page.waitForURL(/\/ukoly\?pohled=/);
		const savedViewsPopover = page.locator("[data-saved-views]");
		if ((await savedViewsPopover.count()) === 0) await savedViewsButton.click();
		await savedViewsPopover.getByText(savedViewName, { exact: true }).waitFor();
		await savedViewsPopover
			.getByRole("button", { name: "Přidat pohled do Mých záložek", exact: true })
			.click();
		await sidebar.getByRole("button", { name: savedViewName, exact: true }).click();
		await page.waitForURL(/\/ukoly\?pohled=/);

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
		for (const name of ["Meets", "Projekty", "Nastavení"]) {
			const box = await sheet.getByRole("link", { name, exact: true }).boundingBox();
			if (!box || box.height < 44) throw new Error(`ia_ui_mobile_target_${browserName}_${name}`);
		}
		await assertNoOverflow(page, `${browserName}_more_390`);
		await assertAxeClean(page, `${browserName}_more_390`);
		await screenshot(page, browserName, "ia-operations-390");
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`${WEB}/prehled`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByRole("heading", { name: "Přehled", exact: true }).waitFor();
		await verifyMultiWindowSurfaces(context, page, fixture, browserName, runtimeErrors);
		if (runtimeErrors.length) throw new Error(`ia_ui_runtime:${runtimeErrors.join(" | ")}`);
		console.log(
			`  ✓ ${browserName}: simplified nav, isolated view defaults, team/operations, 390 px and axe`,
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
		if (
			(await page.locator("aside").getByRole("link", { name: "Provoz", exact: true }).count()) !== 0
		) {
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
