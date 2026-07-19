/**
 * Mail — shell obrazovky: 3-panelový layout (účty a složky / seznam / thread
 * workspace) dle prototypu data-mailroot + mobilní krok list↔thread (data-mstep),
 * mobilní spodní lišta (data-moonly, ř. 1784–1800), resize táhlo seznamu +
 * Full Screen čtení (rz, ř. 779–784 + 2624–2652), sbalený panel složek (sube)
 * a vlastní klávesnice mailu (prototyp kbd, ř. 2740–2769). Motiv se propisuje
 * z aplikace (kontrakt `vzhled`) přes data-wm-theme scope.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTheme } from "../layout/useTheme";
import "./mail.css";
import { storageGet, storageSet } from "../lib/storage";
import { showToast } from "../lib/toast";
import { openWatsonWindow } from "../lib/windowSurfaces";
import { CheatSheet } from "./CheatSheet";
import { MailDemoBanner } from "./DemoBanner";
import { DeniScreen } from "./DeniScreen";
import { MAIL_COMPOSE_EVENT } from "./events";
import { FloatComposer } from "./FloatComposer";
import { MailList, useListRows } from "./MailList";
import { MailSub } from "./MailSub";
import { MailThread } from "./MailThread";
import { NastaveniScreen } from "./NastaveniScreen";
import { NewMessage } from "./NewMessage";
import { PersonalMailWorkspace } from "./PersonalMailWorkspace";
import { PriruckaScreen } from "./PriruckaScreen";
import { useMail } from "./state";
import { usePersonalMail } from "./usePersonalMail";

/** Hledání = JEDNA globální paleta (⌘K). Mailová lupa/⌘F ji jen otevře. */
const openSearch = () => window.dispatchEvent(new Event("watson:open-palette"));

export function MailScreen() {
	const m = useMail();
	const personalMail = usePersonalMail(m.scr === "mail" && m.folder === "osobni");
	const navigate = useNavigate();
	const search = useSearch({ from: "/mail" });
	const { theme } = useTheme();
	const deepLinkedThread = useRef<string | null>(null);
	const deepLinkedPersonal = useRef<string | null>(null);
	const applyingThreadDeepLink = useRef(false);
	const handledConnection = useRef<string | null>(null);
	useEffect(() => {
		if (!search.mailConnection) return;
		const key = `${search.mailConnection}:${search.code ?? ""}`;
		if (handledConnection.current === key) return;
		handledConnection.current = key;
		if (search.mailConnection === "success") {
			showToast(
				"Google účet je připojený a bezpečný sync běží na pozadí. Skutečné zprávy najdeš v Osobní poště.",
			);
		} else {
			const messages: Record<string, string> = {
				mail_oauth_denied: "Google souhlas byl zrušen. Žádný účet ani credential nevznikl.",
				mail_oauth_state_invalid: "Ověření připojení vypršelo. Spusť připojení znovu.",
				mail_contract_rejected: "Google vrátil neúplné potvrzení. Účet nebyl uložen.",
				mail_scope_missing: "Google neudělil potřebné oprávnění. Účet nebyl uložen.",
				mail_oauth_rejected: "Google odmítl dokončit autorizaci. Spusť připojení znovu.",
				mail_identity_rejected: "Google nepotvrdil identitu schránky. Účet nebyl uložen.",
				mail_provider_timeout: "Google neodpověděl včas. Účet nebyl změněn; zkus to znovu.",
				mail_provider_unavailable: "Google je dočasně nedostupný. Účet nebyl změněn.",
				mail_rate_limited: "Google teď omezuje počet požadavků. Zkus připojení později.",
				mail_auth_session_missing: "Přihlášení vypršelo. Přihlas se a spusť připojení znovu.",
			};
			showToast(
				messages[search.code ?? ""] ?? "Připojení se nepodařilo bezpečně dokončit. Zkus to znovu.",
			);
		}
		void navigate({
			to: "/mail",
			search: (current) => ({
				...current,
				mailConnection: undefined,
				code: undefined,
			}),
			replace: true,
		});
	}, [navigate, search.mailConnection, search.code]);
	useEffect(() => {
		if (!search.mailAccount || !search.mailMessage) return;
		const key = `${search.mailAccount}:${search.mailMessage}`;
		if (
			deepLinkedPersonal.current === key ||
			!personalMail.accounts.some((account) => account.id === search.mailAccount)
		)
			return;
		deepLinkedPersonal.current = key;
		m.setScr("mail");
		m.setFolder("osobni");
		void personalMail.openMessageById(search.mailAccount, search.mailMessage);
	}, [
		search.mailAccount,
		search.mailMessage,
		personalMail.accounts,
		personalMail.openMessageById,
		m.setScr,
		m.setFolder,
	]);
	useEffect(() => {
		const id = search.vlakno;
		if (!id || deepLinkedThread.current === id || !m.threads.some((thread) => thread.id === id))
			return;
		deepLinkedThread.current = id;
		applyingThreadDeepLink.current = true;
		m.setScr("mail");
		m.openThread(id);
	}, [search.vlakno, m.threads, m.setScr, m.openThread]);
	useEffect(() => {
		const activeThread =
			m.scr === "mail" && m.folder !== "osobni" && m.mstep === "thread" ? m.sel : null;
		if (applyingThreadDeepLink.current) {
			if (activeThread === search.vlakno) applyingThreadDeepLink.current = false;
			return;
		}
		if (activeThread === (search.vlakno ?? null)) return;
		deepLinkedThread.current = activeThread;
		void navigate({
			to: "/mail",
			search: (current) => ({ ...current, vlakno: activeThread ?? undefined }),
			replace: true,
		});
	}, [m.folder, m.mstep, m.scr, m.sel, navigate, search.vlakno]);
	const openPersonalMessage = useCallback(
		(message: Parameters<typeof personalMail.openMessage>[0]) => {
			deepLinkedPersonal.current = `${message.accountId}:${message.id}`;
			void navigate({
				to: "/mail",
				search: (current) => ({
					...current,
					vlakno: undefined,
					mailAccount: message.accountId,
					mailMessage: message.id,
				}),
				replace: true,
			});
			return personalMail.openMessage(message);
		},
		[navigate, personalMail.openMessage],
	);
	const closePersonalMessage = useCallback(() => {
		personalMail.closeMessage();
		void navigate({
			to: "/mail",
			search: (current) => ({
				...current,
				mailAccount: undefined,
				mailMessage: undefined,
			}),
			replace: true,
		});
	}, [navigate, personalMail.closeMessage]);
	const [drawer, setDrawer] = useState(false);
	// overlaye: hledání (⌘K, /), Nová zpráva (C, Napsat), tahák zkratek (?)
	const [newOn, setNewOn] = useState(false);
	const [cheatOn, setCheatOn] = useState(false);
	// Full Screen čtení (lcol) + drag resize seznamu (prototyp rz, ř. 2624–2652)
	const [lcol, setLcol] = useState(false);
	const [dragging, setDragging] = useState(false);
	const lwRef = useRef<string | null>(null);
	const [listWidth, setListWidth] = useState(() => {
		const stored = Number.parseInt(storageGet("watson-mail.listW") ?? "", 10);
		if (Number.isFinite(stored)) return Math.max(300, Math.min(620, stored));
		return Math.round(Math.max(300, Math.min(392, window.innerWidth * 0.27)));
	});
	// sbalený panel složek na ikony (prototyp sube, ř. 347–350; persist)
	const [sube, setSube] = useState(() => {
		// bez uložené volby zůstává panel rozbalený (kontinuita modulu)
		return storageGet("watson-mail.sube") !== "0";
	});
	const toggleSube = useCallback(() => {
		setSube((v) => !v);
	}, []);
	useEffect(() => {
		storageSet("watson-mail.sube", sube ? "1" : "0");
	}, [sube]);
	const { order } = useListRows();
	const orderRef = useRef(order);
	orderRef.current = order;
	const mRef = useRef(m);
	mRef.current = m;

	/** Drag táhla — mění šířku [data-listpane] 300–620 px (prototyp rzDown). */
	const rzDown = useCallback(
		(e: ReactPointerEvent) => {
			if (lcol) return;
			e.preventDefault();
			const el = document.querySelector<HTMLElement>("[data-listpane]");
			const startW = el ? el.getBoundingClientRect().width : 340;
			const startX = e.clientX;
			setDragging(true);
			const mv = (ev: PointerEvent) => {
				const nw = Math.round(Math.max(300, Math.min(620, startW + (ev.clientX - startX))));
				lwRef.current = `${nw}px`;
				if (el) el.style.width = lwRef.current;
			};
			const up = () => {
				document.removeEventListener("pointermove", mv);
				document.removeEventListener("pointerup", up);
				setDragging(false);
				if (lwRef.current) {
					storageSet("watson-mail.listW", lwRef.current);
					setListWidth(Number.parseInt(lwRef.current, 10));
				}
			};
			document.addEventListener("pointermove", mv);
			document.addEventListener("pointerup", up);
		},
		[lcol],
	);
	/** Dvojklik táhla — reset šířky na výchozí (prototyp rzReset). */
	const rzReset = useCallback(() => {
		lwRef.current = null;
		const el = document.querySelector<HTMLElement>("[data-listpane]");
		if (el) el.style.width = "";
		setLcol(false);
		setListWidth(Math.round(Math.max(300, Math.min(392, window.innerWidth * 0.27))));
		storageSet("watson-mail.listW", "");
		showToast("Šířka seznamu vrácena na výchozí.");
	}, []);
	const rzKey = useCallback(
		(e: ReactKeyboardEvent<HTMLDivElement>) => {
			if (e.key === "Enter" || e.key === " " || e.key === "Home") {
				e.preventDefault();
				rzReset();
				return;
			}
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();
			const el = document.querySelector<HTMLElement>("[data-listpane]");
			const current = el?.getBoundingClientRect().width ?? 340;
			const next = Math.round(
				Math.max(300, Math.min(620, current + (e.key === "ArrowLeft" ? -20 : 20))),
			);
			lwRef.current = `${next}px`;
			if (el) el.style.width = lwRef.current;
			setListWidth(next);
			storageSet("watson-mail.listW", lwRef.current);
		},
		[rzReset],
	);

	// ⌘F ve vlákně dispatchuje 'watson-mail:search' → otevři globální paletu
	useEffect(() => {
		const h = () => openSearch();
		window.addEventListener("watson-mail:search", h);
		return () => window.removeEventListener("watson-mail:search", h);
	}, []);
	useEffect(() => {
		const compose = () => {
			if (mRef.current.folder !== "osobni") setNewOn(true);
		};
		window.addEventListener(MAIL_COMPOSE_EVENT, compose);
		return () => window.removeEventListener(MAIL_COMPOSE_EVENT, compose);
	}, []);

	// forward z vlákna (Přeposlat → m.newMsg): jakmile se objeví, otevři Novou zprávu
	const newMsgReq = m.newMsg;
	useEffect(() => {
		if (newMsgReq) setNewOn(true);
	}, [newMsgReq]);

	// klávesnice mailu — jen když je obrazovka aktivní (mount = aktivní route)
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
			const mail = mRef.current;
			// ⌘K řeší GLOBÁLNÍ paleta (koherence 2026-07-12) — mail už vlastní hledání nemá.
			if (e.key === "Escape") {
				// overlaye mají vlastní Esc (data-esc-layer) — tady jen nižší vrstvy
				if (document.querySelector("[data-esc-layer]")) return;
				// Esc z Dění/Administrace/Nastavení vrací na seznam
				if (mail.scr !== "mail") {
					mail.setScr("mail");
					return;
				}
				if (Object.keys(mail.selIds).length) {
					mail.clearSel();
					return;
				}
				if (mail.mstep === "thread") mail.closeThread();
				return;
			}
			// zkratky seznamu jen na obrazovce "mail"
			if (mail.scr !== "mail") return;
			// Skutečná osobní pošta má oddělený read-only model. Demo commandy ani
			// zkratky nad seed vlákny do něj nesmí omylem zasahovat.
			if (mail.folder === "osobni") return;
			if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
			// otevřený overlay = klávesy seznamu nereagují (kaskáda prototypu)
			if (document.querySelector("[data-esc-layer]")) return;
			const ids = orderRef.current;
			const cur = mail.sel ? ids.indexOf(mail.sel) : -1;
			const k = e.key.toLowerCase();
			switch (k) {
				// j/k = jen posun kurzoru (setSel) — otevře + označí přečteno až o/Enter.
				// Dřív každé projetí seznamu vlákno otevřelo a nevratně označilo
				// přečteným, na mobilu skočilo do vlákna (audit MED MailScreen.tsx:158).
				case "j": {
					e.preventDefault();
					const n = ids[Math.min(ids.length - 1, cur + 1)];
					if (n) mail.setSel(n);
					break;
				}
				case "k": {
					e.preventDefault();
					const n = ids[Math.max(0, cur - 1)];
					if (n) mail.setSel(n);
					break;
				}
				case "o":
				case "enter":
					if (mail.sel) mail.openThread(mail.sel);
					break;
				case "e":
					if (mail.sel) mail.rowAct(mail.sel, "arch");
					break;
				case "h":
					if (mail.sel) mail.rowAct(mail.sel, "done");
					break;
				case "d":
				case "p":
					if (mail.sel) mail.rowAct(mail.sel, "pin");
					break;
				case "m":
					if (mail.sel) mail.rowAct(mail.sel, "mute");
					break;
				case "s":
					if (mail.sel) mail.rowAct(mail.sel, "snooze");
					break;
				case "u":
					if (mail.sel) mail.rowAct(mail.sel, "unread");
					break;
				case "x":
					if (mail.sel) mail.toggleSel(mail.sel);
					break;
				case "c":
					e.preventDefault();
					setNewOn(true);
					break;
				case "/":
					e.preventDefault();
					openSearch();
					break;
				case "?":
					setCheatOn(true);
					break;
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, []);

	return (
		<div
			data-mailapp
			data-embedded="true"
			data-wm-theme={theme === "dark" ? "dark" : "light"}
			style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}
		>
			{/* CC-P0-08 — zůstává pro týmové schránky, dokud jejich sync/send není skutečný */}
			<MailDemoBanner />
			<div
				data-mailroot
				data-mstep={m.mstep}
				data-lcol={lcol ? "true" : "false"}
				data-sube={sube ? "true" : "false"}
				data-drag={dragging ? "true" : undefined}
				style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }}
			>
				<MailSub
					drawer={drawer}
					onCloseDrawer={() => setDrawer(false)}
					sube={sube}
					onToggleSube={toggleSube}
					onOpenWindow={() => openWatsonWindow(window.location.href, "focus")}
					personalSummary={{
						accounts: personalMail.accounts,
						unreadCount: personalMail.unreadCount,
						syncing: personalMail.accounts.some((account) => {
							const status = personalMail.runtime[account.id]?.sync?.status;
							return status === "pending" || status === "running";
						}),
					}}
				/>
				{/* vnitřní obrazovky nahrazují seznam+vlákno; panel složek zůstává */}
				{m.scr === "mail" ? (
					m.folder === "osobni" ? (
						<PersonalMailWorkspace
							model={{
								...personalMail,
								openMessage: openPersonalMessage,
								closeMessage: closePersonalMessage,
							}}
							onOpenDrawer={() => setDrawer(true)}
						/>
					) : (
						<>
							<MailList
								listWidth={listWidth}
								onOpenDrawer={() => setDrawer(true)}
								onSearch={openSearch}
								onCompose={() => setNewOn(true)}
							/>
							{/* táhlo šířky seznamu + Full Screen čtení (prototyp ř. 779–784) */}
							<div
								data-rz
								data-tabup
								style={{
									width: 9,
									flex: "none",
									cursor: "col-resize",
									position: "relative",
									margin: "0 -5px 0 -4px",
									zIndex: 6,
								}}
							>
								<div
									role="separator"
									aria-orientation="vertical"
									aria-label="Šířka seznamu zpráv"
									aria-valuemin={300}
									aria-valuemax={620}
									aria-valuenow={listWidth}
									tabIndex={0}
									onPointerDown={rzDown}
									onDoubleClick={rzReset}
									onKeyDown={rzKey}
									title="Táhni pro změnu šířky seznamu · dvojklik vrátí výchozí"
									style={{ position: "absolute", inset: 0, cursor: "col-resize" }}
								>
									<span
										data-rzline
										style={{ position: "absolute", left: 4, top: 0, bottom: 0, width: 1 }}
									/>
								</div>
								<button
									type="button"
									onClick={() => {
										const n = !lcol;
										setLcol(n);
										showToast(
											n
												? "Full Screen — čtení na celou šířku. Šipkou na děliči se vrátíš."
												: "Split View — seznam vedle čtení.",
										);
									}}
									title={
										lcol ? "Zobrazit seznam (Split View)" : "Skrýt seznam — čtení na celou šířku"
									}
									style={{
										position: "absolute",
										top: "50%",
										left: -18,
										transform: "translateY(-50%)",
										width: 44,
										height: 44,
										zIndex: 1,
										borderRadius: 9,
										border: "1px solid var(--line)",
										background: "var(--panel)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										cursor: "pointer",
										color: "var(--ink-3)",
										boxShadow: "var(--shadow-sm)",
										fontFamily: "var(--w-font-mono)",
										fontSize: 11,
									}}
								>
									{lcol ? "›" : "‹"}
								</button>
							</div>
							<MailThread />
						</>
					)
				) : m.scr === "deni" ? (
					<DeniScreen />
				) : m.scr === "prirucka" ? (
					<PriruckaScreen />
				) : (
					<NastaveniScreen />
				)}
			</div>

			{/* Mobilní spodní lišta modulu ZRUŠENA (feedback: dvě menu nad sebou) —
			    navigaci drží jediná aplikační lišta; Napsat + hamburger Schránek
			    jsou v hlavičce seznamu (onCompose/onOpenDrawer). */}

			{/* overlaye modulu: Nová zpráva, tahák zkratek, plovoucí composer.
			    Hledání = globální ⌘K paleta (koherence 2026-07-12), ne mailový overlay. */}
			<NewMessage
				open={newOn}
				onClose={() => {
					setNewOn(false);
					m.setNewMsg(null);
				}}
			/>
			<CheatSheet open={cheatOn} onClose={() => setCheatOn(false)} />
			<FloatComposer />
		</div>
	);
}
