/** F5 browser proof: real OAuth -> encrypted sync -> owner-only personal inbox UI. */
import "./src/env";
import { mkdir } from "node:fs/promises";
import {
	accounts,
	and,
	eq,
	getDb,
	mailAccounts,
	mailOutboundMessages,
	mailSyncStates,
	mailTaskLinks,
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
import { scanMailOutbound } from "./src/mailOutbound";
import { scanMailSync } from "./src/mailSync";

const WEB = process.env.PERSONAL_MAIL_UI_WEB ?? "http://localhost:5173";
const STUB = process.env.MAIL_GOOGLE_API_BASE_URL ?? "http://127.0.0.1:8793";
const SCREENSHOT_DIR = process.env.PERSONAL_MAIL_UI_SCREENSHOT_DIR;
const BROWSERS = (process.env.PERSONAL_MAIL_UI_BROWSERS ?? "chromium,webkit")
	.split(",")
	.filter((name): name is "chromium" | "webkit" => name === "chromium" || name === "webkit");
const db = getDb();

async function provision(browserName: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const email = `personal-mail-ui-${browserName}-${suffix}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Personal Mail UI ${browserName}`,
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
			name: `Personal Mail UI ${browserName}`,
			ownerId: userId,
			isPersonal: true,
		});
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
		await tx.insert(projects).values({
			id: projectId,
			workspaceId,
			name: "Osobní schránka",
			ownerId: userId,
		});
		await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
	});
	return { userId, workspaceId, projectId, email, password };
}

async function resetMailbox(email: string) {
	const response = await fetch(`${STUB}/test/mailbox`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, action: "reset", count: 3 }),
	});
	if (!response.ok) throw new Error(`personal_mail_ui_provider_reset:${response.status}`);
}

async function drain(accountId: string) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		await scanMailSync();
		const state = (
			await db
				.select()
				.from(mailSyncStates)
				.where(eq(mailSyncStates.accountId, accountId))
				.limit(1)
		)[0];
		if (state?.status === "idle") return;
		if (state?.status === "dead" || state?.status === "reauth_required") {
			throw new Error(`personal_mail_ui_sync_${state.status}:${state.lastErrorCode}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("personal_mail_ui_sync_timeout");
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
	if (violations.length > 0) throw new Error(`personal_mail_ui_axe_${label}:${violations.join(",")}`);
}

async function assertNoOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	if (overflow) throw new Error(`personal_mail_ui_overflow_${label}`);
}

async function openPersonalInbox(page: Page, email: string) {
	const row = page.getByTitle(`${email} — owner-only osobní pošta`, { exact: true });
	await row.waitFor({ timeout: 30_000 });
	await row.locator("button").click();
	await page.locator("[data-personal-mail]").waitFor();
}

async function run(browserName: "chromium" | "webkit") {
	const fixture = await provision(browserName);
	let browser: Browser | undefined;
	try {
		await resetMailbox(fixture.email);
		browser = await (browserName === "chromium" ? chromium : webkit).launch({ headless: true });
		const context = await browser.newContext({
			locale: "cs-CZ",
			reducedMotion: "reduce",
			viewport: { width: 1280, height: 800 },
		});
		const page = await context.newPage();
		const runtimeErrors: string[] = [];
		let expectedDetailFailure = false;
		let expectedOutboundFailure = false;
		page.on("pageerror", (error) => runtimeErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() !== "error") return;
			if ((expectedDetailFailure || expectedOutboundFailure) && message.text().includes("503")) {
				if (expectedOutboundFailure) expectedOutboundFailure = false;
				else expectedDetailFailure = false;
				return;
			}
			runtimeErrors.push(message.text());
		});

		await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByLabel("E-mail", { exact: true }).fill(fixture.email);
		await page.getByLabel("Heslo", { exact: true }).fill(fixture.password);
		await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
		await page.waitForSelector("main", { timeout: 30_000 });
		await page.goto(`${WEB}/nastaveni?sekce=integrace`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.getByRole("button", { name: "Spravovat účty", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Osobní e-mailové účty", exact: true });

		// Obecný účet nesmí vzniknout ani zůstat ve formuláři dřív, než server
		// potvrdí IMAP i SMTP. UI proof používá izolovaný ACK; kryptografii,
		// SSRF a pořadí obou ověření kryje verify-mail-imap-smtp.ts.
		await dialog.getByRole("button", { name: "Nastavit", exact: true }).click();
		await dialog.getByLabel("Název účtu (volitelný)", { exact: true }).fill("Obecná schránka");
		await dialog.getByLabel("E-mailová adresa", { exact: true }).fill("general@example.test");
		await dialog.getByLabel("Přihlašovací jméno", { exact: true }).fill("general@example.test");
		await dialog.getByLabel("Heslo nebo heslo aplikace", { exact: true }).fill("temporary-app-password");
		await dialog.getByRole("group", { name: "Příjem — IMAP", exact: true }).getByLabel("Server", { exact: true }).fill("imap.example.test");
		await dialog.getByRole("group", { name: "Odesílání — SMTP", exact: true }).getByLabel("Server", { exact: true }).fill("smtp.example.test");
		let imapPayloadPassword: string | null = null;
		await page.route(/\/api\/mail\/accounts\/imap-smtp$/, async (route) => {
			const payload = route.request().postDataJSON() as { password?: string };
			imapPayloadPassword = payload.password ?? null;
			await route.fulfill({
				status: 201,
				contentType: "application/json",
				body: JSON.stringify({ account: {
					id: crypto.randomUUID(), provider: "imap_smtp", emailAddress: "general@example.test",
					displayName: "Obecná schránka", status: "connected", grantedScopes: ["imap", "smtp"],
					capabilities: ["imap_sync", "smtp_send", "unified_inbox"], lastSuccessAt: new Date().toISOString(),
					lastErrorCode: null, revokedAt: null, version: 1,
				} }),
			});
		});
		await dialog.getByRole("button", { name: "Ověřit a připojit", exact: true }).click();
		await dialog.getByText("IMAP + SMTP · Účet připravený", { exact: false }).waitFor();
		if (imapPayloadPassword !== "temporary-app-password") throw new Error("personal_mail_ui_imap_payload_missing");
		imapPayloadPassword = null;
		await page.unroute(/\/api\/mail\/accounts\/imap-smtp$/);
		await dialog.getByRole("button", { name: "Nastavit", exact: true }).click();
		if ((await dialog.getByLabel("Heslo nebo heslo aplikace", { exact: true }).inputValue()) !== "") {
			throw new Error("personal_mail_ui_imap_password_not_cleared");
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(page, `${browserName}_imap_form_mobile`);
		await assertAxeClean(page, `${browserName}_imap_form_mobile`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await dialog.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-imap-form-390.png` });
		}
		await dialog.getByRole("button", { name: "Zrušit", exact: true }).click();
		await page.setViewportSize({ width: 1280, height: 800 });
		await dialog.getByRole("button", { name: "Pokračovat", exact: true }).click();
		await page.waitForURL(/\/mail(?:\?|$)/, { timeout: 30_000 });
		await page.waitForFunction(
			() => {
				const url = new URL(location.href);
				return !url.searchParams.has("mailConnection") && !url.searchParams.has("code");
			},
			undefined,
			{ timeout: 10_000 },
		);

		const account = (
			await db
				.select()
				.from(mailAccounts)
				.where(eq(mailAccounts.ownerUserId, fixture.userId))
				.limit(1)
		)[0];
		if (!account) throw new Error("personal_mail_ui_account_missing");
		await drain(account.id);
		await page.reload({ waitUntil: "domcontentloaded" });
		await openPersonalInbox(page, fixture.email);

		const workspace = page.locator("[data-personal-mail]");
		await workspace.getByText("3 zpráv · 1 nepřečtených", { exact: false }).waitFor();
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).waitFor();
		if ((await workspace.getByText(/Text zprávy \d/).count()) !== 0) {
			throw new Error("personal_mail_ui_body_leaked_in_summary");
		}

		// Primární CTA shellu se v mailovém kontextu přepne z úkolu na e-mail
		// a v osobní složce musí otevřít skutečný osobní composer, ne týmové demo.
		await page.locator("aside").getByRole("button", { name: "Napsat e-mail", exact: true }).click();
		let composer = page.getByRole("dialog", { name: "Nová osobní zpráva", exact: true });
		await composer.waitFor();
		if ((await page.getByRole("dialog", { name: "Nová zpráva", exact: true }).count()) !== 0) {
			throw new Error("personal_mail_ui_sidebar_opened_team_demo");
		}
		await composer.getByRole("button", { name: "Zrušit", exact: true }).click();

		// Watson smí návrh mailu označit jako provedený jen tehdy, když skutečně
		// otevře osobní composer s přesným obsahem. Přenos je jednorázový a nejde
		// přes URL; route stub izoluje UI kontrakt od externího AI providera.
		await page.route(/\/api\/watson\/command$/, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					ok: true,
					actions: [{
						type: "draft_email",
						label: "Návrh e-mailu: „Audit Watsona“",
						params: {
							to: "watson-draft@example.test",
							subject: `Audit Watsona ${browserName}`,
							body: "Tento text musí skončit v osobním composeru.",
						},
					}],
					note: null,
				}),
			});
		});
		await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.getByTitle("Watson", { exact: true }).click();
		const watson = page.getByRole("dialog", { name: "Watson", exact: true });
		await watson.getByPlaceholder(/Řekni Watsonovi/).fill("Připrav auditní e-mail");
		page.once("dialog", (consent) => void consent.accept());
		await watson.getByRole("button", { name: "Zeptat se", exact: true }).click();
		await watson.getByText("Návrh e-mailu: „Audit Watsona“", { exact: true }).waitFor();
		await watson.getByRole("button", { name: "Provést 1", exact: true }).click();
		await page.waitForURL(/\/mail(?:\?|$)/, { timeout: 30_000 });
		composer = page.getByRole("dialog", { name: "Nová osobní zpráva", exact: true });
		await composer.waitFor({ timeout: 30_000 });
		if (
			(await composer.getByLabel("Komu", { exact: true }).inputValue()) !==
			"watson-draft@example.test" ||
			(await composer.getByLabel("Předmět", { exact: true }).inputValue()) !==
				`Audit Watsona ${browserName}` ||
			(await composer.locator("textarea").first().inputValue()) !==
				"Tento text musí skončit v osobním composeru."
		) {
			throw new Error("personal_mail_ui_watson_draft_prefill_missing");
		}
		await composer.getByRole("button", { name: "Zrušit", exact: true }).click();
		await page.unroute(/\/api\/watson\/command$/);

		// Pokročilé owner-only hledání + uložený Watson pohled. Klávesa / musí
		// mířit do mailového hledání, ne do demo seedů ani do celé aplikace.
		await page.keyboard.press("/");
		const mailSearch = workspace.locator("[data-personal-search]");
		if (!(await mailSearch.evaluate((element) => element === document.activeElement))) {
			throw new Error("personal_mail_ui_keyboard_search_focus_missing");
		}
		await mailSearch.fill("from:sender-2 is:unread");
		await workspace.getByText("Synchronizovaná zpráva 2", { exact: true }).waitFor();
		await workspace.getByText("1 výsledků", { exact: false }).waitFor();
		if ((await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).count()) !== 0) {
			throw new Error("personal_mail_ui_search_not_filtered");
		}
		await workspace.getByTitle("Uložit tento pohled", { exact: true }).click();
		await workspace.getByLabel("Název pohledu", { exact: true }).fill(`Moje filtry ${browserName}`);
		await workspace.getByRole("button", { name: "Uložit", exact: true }).click();
		await workspace.getByRole("button", { name: `Moje filtry ${browserName}`, exact: true }).waitFor();
		await mailSearch.fill("");
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).waitFor();
		await workspace.getByRole("button", { name: "Analytika schránky", exact: true }).click();
		await workspace.getByText("nejde o skóre lidí", { exact: false }).waitFor();
		await assertAxeClean(page, `${browserName}_advanced_search_views_analytics`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await workspace.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-personal-advanced-tools.png` });
		}

		await workspace.getByRole("button", { name: "Napsat", exact: true }).click();
		composer = page.getByRole("dialog", { name: "Nová osobní zpráva", exact: true });
		await composer.getByLabel("Komu", { exact: true }).fill("undo-ui@example.test");
		await composer.getByLabel("Předmět", { exact: true }).fill(`UI Undo ${browserName}`);
		await composer.getByLabel("Zpráva", { exact: true }).fill("Podklady najdeš v příloze.");
		await composer.getByText("Nezapomněl/a jsi přílohu?", { exact: true }).waitFor();
		await composer.getByRole("checkbox", { name: "Rozumím, odeslat tuto zprávu bez přílohy", exact: true }).check();
		await assertAxeClean(page, `${browserName}_composer_attachment_warning`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await composer.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-personal-composer.png` });
		}
		const outboundRoute = /\/api\/mail\/accounts\/[^/]+\/outbound$/;
		await page.route(outboundRoute, async (route) => {
			await route.fetch();
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: '{"error":"mail_outbound_unavailable"}',
			});
		});
		expectedOutboundFailure = true;
		await composer.getByRole("button", { name: "Odeslat", exact: true }).click();
		await composer.getByText("Obsah zůstává v tomto okně.", { exact: false }).waitFor();
		await page.unroute(outboundRoute);
		await composer.getByRole("button", { name: "Odeslat", exact: true }).click();
		await composer.waitFor({ state: "hidden" });
		await workspace.getByText(`UI Undo ${browserName}`, { exact: true }).waitFor();
		const queuedAfterLostResponse = await db
			.select()
			.from(mailOutboundMessages)
			.where(eq(mailOutboundMessages.accountId, account.id));
		if (queuedAfterLostResponse.length !== 1) {
			throw new Error(`personal_mail_ui_retry_duplicated:${JSON.stringify(queuedAfterLostResponse)}`);
		}
		await workspace.getByRole("button", { name: "Vrátit odeslání", exact: true }).click();
		await workspace.getByText("Odeslání vráceno", { exact: true }).waitFor();
		const undone = (
			await db
				.select()
				.from(mailOutboundMessages)
				.where(
					and(
						eq(mailOutboundMessages.accountId, account.id),
						eq(mailOutboundMessages.status, "cancelled"),
					),
				)
		)[0];
		if (!undone || undone.ownerUserId !== fixture.userId) {
			throw new Error(`personal_mail_ui_undo_missing:${JSON.stringify(undone)}`);
		}

		await workspace.getByRole("button", { name: "Napsat", exact: true }).click();
		composer = page.getByRole("dialog", { name: "Nová osobní zpráva", exact: true });
		await composer.getByLabel("Komu", { exact: true }).fill("recipient-ui@example.test");
		await composer.getByLabel("Předmět", { exact: true }).fill(`UI Send ${browserName}`);
		await composer.getByLabel("Zpráva", { exact: true }).fill("Skutečný odchozí text z Watsonu.");
		await composer.getByRole("button", { name: "Odeslat", exact: true }).click();
		await composer.waitFor({ state: "hidden" });
		await workspace.getByText(`UI Send ${browserName}`, { exact: true }).waitFor();
		const queued = (
			await db
				.select()
				.from(mailOutboundMessages)
				.where(
					and(
						eq(mailOutboundMessages.accountId, account.id),
						eq(mailOutboundMessages.status, "queued"),
					),
				)
		)[0];
		if (!queued) throw new Error("personal_mail_ui_send_queue_missing");
		await scanMailOutbound(new Date(Date.now() + 60_000));
		await workspace.getByText("Google přijal zprávu", { exact: true }).waitFor({ timeout: 10_000 });
		await workspace.getByRole("button", { name: "Pohlídat odpověď", exact: true }).click();
		const followupInput = workspace.getByLabel("Pokud nikdo neodpoví do", { exact: true });
		await followupInput.fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16));
		await workspace.getByRole("button", { name: "Nastavit", exact: true }).click();
		await workspace.locator('[data-personal-outbound-status="accepted"]').getByText("Follow-up", { exact: false }).waitFor();
		if (SCREENSHOT_DIR) {
			await workspace.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-personal-outbound-status.png` });
		}
		const accepted = (
			await db
				.select()
				.from(mailOutboundMessages)
				.where(eq(mailOutboundMessages.id, queued.id))
				.limit(1)
		)[0];
		if (accepted?.status !== "accepted" || accepted.attempts !== 1) {
			throw new Error(`personal_mail_ui_send_not_accepted:${JSON.stringify(accepted)}`);
		}
		const sentResponse = await fetch(`${STUB}/test/sent?email=${encodeURIComponent(fixture.email)}`);
		const sentBody = (await sentResponse.json()) as { messages: Array<{ messageId: string; raw: string }> };
		const sentMessage = sentBody.messages.find(
			(message) => message.messageId === `watson-${queued.id}@watson.invalid`,
		);
		if (!sentMessage?.raw.includes("To: recipient-ui@example.test")) {
			throw new Error(`personal_mail_ui_provider_send_missing:${JSON.stringify(sentBody)}`);
		}
		await assertAxeClean(page, `${browserName}_outbound_status`);

		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).click();
		await workspace.getByText("Text zprávy 3. Token sem nikdy nepatří.", { exact: true }).waitFor();
		await workspace.getByText("Surové HTML, tracking pixely a vzdálené obrázky se nespouštějí.", { exact: false }).waitFor();
		await workspace.getByText("Provider ověřil identitu domény", { exact: false }).waitFor();
		await workspace.getByRole("button", { name: "Osoba a firma", exact: true }).click();
		const personDialog = page.getByRole("dialog", { name: "sender-3", exact: true });
		await personDialog.getByText("sender-3@example.test", { exact: true }).waitFor();
		await personDialog.getByText("Zprávy v synchronizaci", { exact: true }).waitFor();
		await assertAxeClean(page, `${browserName}_person_card`);
		await personDialog.getByRole("button", { name: "Zavřít", exact: true }).click();
			await workspace.getByRole("button", { name: "Odpovědět", exact: true }).click();
			composer = page.getByRole("dialog", { name: "Odpověď na zprávu", exact: true });
			if (await composer.locator("select").isEnabled()) {
				throw new Error("personal_mail_ui_reply_account_switch_exposed");
			}
			if ((await composer.getByLabel("Komu", { exact: true }).inputValue()) !== "sender-3@example.test") {
				throw new Error("personal_mail_ui_reply_recipient_missing");
			}
			if ((await composer.getByLabel("Předmět", { exact: true }).inputValue()) !== "Re: Synchronizovaná zpráva 3") {
				throw new Error("personal_mail_ui_reply_subject_missing");
			}
			const replyBody = composer.locator("textarea");
			await replyBody.fill("Odpověď z detailu zprávy.");
			const enableAi = composer.getByRole("checkbox", { name: /Povolit AI návrhy pro mou osobní poštu/ });
			await enableAi.check();
			await composer.getByRole("button", { name: "Povolit AI návrhy", exact: true }).click();
			await composer.getByRole("button", { name: "Navrhnout odpověď", exact: true }).waitFor();
			const replyAiRoute = /\/api\/mail\/accounts\/[^/]+\/messages\/[^/]+\/reply-suggestion$/;
			let replyAiRequest: Record<string, unknown> | null = null;
			await page.route(replyAiRoute, async (route) => {
				replyAiRequest = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						suggestion: "Děkuji za zprávu. Termín potvrzuji.",
						mock: true,
						provider: null,
					}),
				});
			});
			await composer.getByLabel("Volitelné zadání stylu", { exact: true }).fill("stručně a přátelsky");
			await composer.getByRole("checkbox", { name: /Souhlasím s tím, že se pro tento návrh/ }).check();
			await composer.getByRole("button", { name: "Navrhnout odpověď", exact: true }).click();
			await composer.getByText("Děkuji za zprávu. Termín potvrzuji.", { exact: true }).waitFor();
			if (
				replyAiRequest?.vendorConsent !== true ||
				replyAiRequest.instruction !== "stručně a přátelsky" ||
				Object.keys(replyAiRequest).some((key) => !["vendorConsent", "instruction"].includes(key))
			) {
				throw new Error(`personal_mail_ui_ai_request_overexposed:${JSON.stringify(replyAiRequest)}`);
			}
			if ((await replyBody.inputValue()) !== "Odpověď z detailu zprávy.") {
				throw new Error("personal_mail_ui_ai_suggestion_overwrote_draft");
			}
			await assertAxeClean(page, `${browserName}_threaded_reply_ai_suggestion`);
			if (SCREENSHOT_DIR) {
				await mkdir(SCREENSHOT_DIR, { recursive: true });
				await composer.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-threaded-reply-ai.png` });
			}
			await page.setViewportSize({ width: 390, height: 844 });
			await assertNoOverflow(page, `${browserName}_threaded_reply_ai_mobile`);
			await assertAxeClean(page, `${browserName}_threaded_reply_ai_mobile`);
			if (SCREENSHOT_DIR) {
				await composer.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-threaded-reply-ai-mobile.png` });
			}
			await page.setViewportSize({ width: 1_280, height: 800 });
			await composer.getByRole("button", { name: "Nahradit rozepsaný text návrhem", exact: true }).click();
			if ((await replyBody.inputValue()) !== "Děkuji za zprávu. Termín potvrzuji.") {
				throw new Error("personal_mail_ui_ai_suggestion_not_applied");
			}
			await page.unroute(replyAiRoute);
			await composer.getByRole("button", { name: "Odeslat", exact: true }).click();
			await composer.waitFor({ state: "hidden" });
			const replyQueued = (
				await db
					.select()
					.from(mailOutboundMessages)
					.where(
						and(
							eq(mailOutboundMessages.accountId, account.id),
							eq(mailOutboundMessages.status, "queued"),
						),
					)
			)[0];
			if (!replyQueued) throw new Error("personal_mail_ui_reply_queue_missing");
			await scanMailOutbound(new Date(Date.now() + 60_000));
			const replySentResponse = await fetch(`${STUB}/test/sent?email=${encodeURIComponent(fixture.email)}`);
			const replySentBody = (await replySentResponse.json()) as { messages: Array<{ messageId: string; threadId: string; raw: string }> };
			const replySent = replySentBody.messages.find(
				(message) => message.messageId === `watson-${replyQueued.id}@watson.invalid`,
			);
			if (replySent?.threadId !== "thread-002" || !/^In-Reply-To: <message-3@example\.test>$/m.test(replySent.raw) || !/^References: <message-3@example\.test>$/m.test(replySent.raw)) {
				throw new Error(`personal_mail_ui_reply_thread_missing:${JSON.stringify(replySent)}`);
			}
			await assertNoOverflow(page, `${browserName}_desktop`);
		await assertAxeClean(page, `${browserName}_desktop`);

		await workspace.getByRole("button", { name: "Vytvořit úkol", exact: true }).click();
		const taskDialog = page.getByRole("dialog", { name: "Udělat z mailu úkol", exact: true });
		await taskDialog.getByText("Celé tělo ani přílohy se nepřenášejí automaticky.", { exact: false }).waitFor();
		await taskDialog.getByRole("button", { name: "P2", exact: true }).click();
		await assertAxeClean(page, `${browserName}_execution_dialog`);
		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await taskDialog.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-execution-dialog.png` });
		}
		await taskDialog.getByRole("button", { name: "Vytvořit úkol", exact: true }).click();
		await taskDialog.waitFor({ state: "hidden" });
		await workspace.getByText("P2 · Synchronizovaná zpráva 3", { exact: true }).waitFor();
		const linkedTask = (
			await db
				.select()
				.from(tasks)
				.where(eq(tasks.projectId, fixture.projectId))
				.limit(1)
		)[0];
		if (!linkedTask?.mailTh?.startsWith(`personal:${account.id}:`)) {
			throw new Error(`personal_mail_ui_execution_task_missing:${JSON.stringify(linkedTask)}`);
		}
		const link = (
			await db
				.select()
				.from(mailTaskLinks)
				.where(eq(mailTaskLinks.sourceTaskId, linkedTask.id))
				.limit(1)
		)[0];
		if (!link || link.ownerUserId !== fixture.userId) {
			throw new Error(`personal_mail_ui_execution_link_missing:${JSON.stringify(link)}`);
		}

		expectedDetailFailure = true;
		await page.route(/\/api\/mail\/accounts\/[^/]+\/messages\/[^/?]+$/, async (route) => {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"mail_message_unavailable"}' });
		});
		await workspace.getByText("Synchronizovaná zpráva 2", { exact: true }).click();
		await workspace.getByText("Detail zprávy se nepodařilo bezpečně načíst.", { exact: true }).waitFor();
		await page.unroute(/\/api\/mail\/accounts\/[^/]+\/messages\/[^/?]+$/);
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).click();
		await workspace.getByText("Text zprávy 3. Token sem nikdy nepatří.", { exact: true }).waitFor();
		await page.goto(
			`${WEB}/mail?mailAccount=${encodeURIComponent(account.id)}&mailMessage=${encodeURIComponent(link.sourceMessageId)}`,
			{ waitUntil: "domcontentloaded" },
		);
		await page.locator("[data-personal-mail]").getByText("Text zprávy 3. Token sem nikdy nepatří.", { exact: true }).waitFor();

		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoOverflow(page, `${browserName}_mobile_detail`);
		const back = workspace.getByRole("button", { name: "← Zpět na zprávy", exact: true });
		const backBox = await back.boundingBox();
		if (!backBox || backBox.height < 44) throw new Error(`personal_mail_ui_mobile_back:${backBox?.height}`);
		await assertAxeClean(page, `${browserName}_mobile_detail`);
		await back.click();
		await workspace.getByText("Synchronizovaná zpráva 3", { exact: true }).waitFor();
		await assertNoOverflow(page, `${browserName}_mobile_list`);
		await assertAxeClean(page, `${browserName}_mobile_list`);

		if (SCREENSHOT_DIR) {
			await mkdir(SCREENSHOT_DIR, { recursive: true });
			await workspace.screenshot({ path: `${SCREENSHOT_DIR}/${browserName}-personal-inbox-390.png` });
		}
		const unexpectedRuntime = runtimeErrors.filter(
			(error) => browserName !== "webkit" || !error.includes("due to access control checks"),
		);
		if (unexpectedRuntime.length > 0) {
			throw new Error(`personal_mail_ui_runtime:${unexpectedRuntime.join(" | ")}`);
		}
		console.log(`  ✓ ${browserName}: OAuth, encrypted sync/send, Undo, attachment warning, lazy detail, mobile reflow and axe`);
	} finally {
		await browser?.close();
		await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
		await db.delete(users).where(eq(users.id, fixture.userId));
	}
}

for (const browserName of BROWSERS) await run(browserName);
console.log("\nPersonal Mail UI checks passed.");
process.exit(0);
