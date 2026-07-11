/**
 * Mail — shell obrazovky: 3-panelový layout (účty a složky / seznam / thread
 * workspace) dle prototypu data-mailroot + mobilní krok list↔thread (data-mstep),
 * mobilní spodní lišta (data-moonly, ř. 1784–1800), resize táhlo seznamu +
 * Full Screen čtení (rz, ř. 779–784 + 2624–2652), sbalený panel složek (sube)
 * a vlastní klávesnice mailu (prototyp kbd, ř. 2740–2769). Motiv se propisuje
 * z aplikace (kontrakt `vzhled`) přes data-wm-theme scope.
 */
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTheme } from "../layout/useTheme";
import "./mail.css";
import { showToast } from "../lib/toast";
import { AdminScreen } from "./AdminScreen";
import { CheatSheet } from "./CheatSheet";
import { DeniScreen } from "./DeniScreen";
import { FloatComposer } from "./FloatComposer";
import { MailList, useListRows } from "./MailList";
import { MailSub } from "./MailSub";
import { MailThread } from "./MailThread";
import { NastaveniScreen } from "./NastaveniScreen";
import { NewMessage } from "./NewMessage";
import { PriruckaScreen } from "./PriruckaScreen";
import { SearchOverlay } from "./SearchOverlay";
import { useMail } from "./state";

const lsSet = (key: string, val: string) => {
	try {
		localStorage.setItem(key, val);
	} catch {
		/* blokované úložiště — volba platí jen pro session */
	}
};

export function MailScreen() {
	const m = useMail();
	const { theme } = useTheme();
	const [drawer, setDrawer] = useState(false);
	// overlaye: hledání (⌘K, /), Nová zpráva (C, Napsat), tahák zkratek (?)
	const [searchOn, setSearchOn] = useState(false);
	const [newOn, setNewOn] = useState(false);
	const [cheatOn, setCheatOn] = useState(false);
	// Full Screen čtení (lcol) + drag resize seznamu (prototyp rz, ř. 2624–2652)
	const [lcol, setLcol] = useState(false);
	const [dragging, setDragging] = useState(false);
	const lwRef = useRef<string | null>(null);
	// sbalený panel složek na ikony (prototyp sube, ř. 347–350; persist)
	const [sube, setSube] = useState(() => {
		try {
			// bez uložené volby zůstává panel rozbalený (kontinuita modulu)
			return localStorage.getItem("watson-mail.sube") !== "0";
		} catch {
			return true;
		}
	});
	const toggleSube = useCallback(() => {
		setSube((v) => !v);
	}, []);
	useEffect(() => {
		lsSet("watson-mail.sube", sube ? "1" : "0");
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
				if (lwRef.current) lsSet("watson-mail.listW", lwRef.current);
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
		lsSet("watson-mail.listW", "");
		showToast("Šířka seznamu vrácena na výchozí.");
	}, []);

	// ⌘F ve vlákně dispatchuje 'watson-mail:search' → otevři hledání
	useEffect(() => {
		const h = () => setSearchOn(true);
		window.addEventListener("watson-mail:search", h);
		return () => window.removeEventListener("watson-mail:search", h);
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
			// ⌘K → hledání (před typing guardem, funguje i z pole; prototyp ř. 2745)
			if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
				e.preventDefault();
				setSearchOn((v) => !v);
				return;
			}
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
			if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
			// otevřený overlay = klávesy seznamu nereagují (kaskáda prototypu)
			if (document.querySelector("[data-esc-layer]")) return;
			const ids = orderRef.current;
			const cur = mail.sel ? ids.indexOf(mail.sel) : -1;
			const k = e.key.toLowerCase();
			switch (k) {
				case "j": {
					e.preventDefault();
					const n = ids[Math.min(ids.length - 1, cur + 1)];
					if (n) mail.openThread(n);
					break;
				}
				case "k": {
					e.preventDefault();
					const n = ids[Math.max(0, cur - 1)];
					if (n) mail.openThread(n);
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
					setSearchOn(true);
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
				/>
				{/* vnitřní obrazovky nahrazují seznam+vlákno; panel složek zůstává */}
				{m.scr === "mail" ? (
					<>
						<MailList
							onOpenDrawer={() => setDrawer(true)}
							onSearch={() => setSearchOn(true)}
							onCompose={() => setNewOn(true)}
						/>
						{/* táhlo šířky seznamu + Full Screen čtení (prototyp ř. 779–784) */}
						<div
							data-rz
							data-tabup
							onPointerDown={rzDown}
							onDoubleClick={rzReset}
							title="Táhni pro změnu šířky seznamu · dvojklik vrátí výchozí"
							style={{
								width: 9,
								flex: "none",
								cursor: "col-resize",
								position: "relative",
								margin: "0 -5px 0 -4px",
								zIndex: 6,
							}}
						>
							<span
								data-rzline
								style={{ position: "absolute", left: 4, top: 0, bottom: 0, width: 1 }}
							/>
							<span
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
									left: -4,
									transform: "translateY(-50%)",
									width: 17,
									height: 38,
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
							</span>
						</div>
						<MailThread />
					</>
				) : m.scr === "deni" ? (
					<DeniScreen />
				) : m.scr === "admin" ? (
					<AdminScreen />
				) : m.scr === "prirucka" ? (
					<PriruckaScreen />
				) : (
					<NastaveniScreen />
				)}
			</div>

			{/* Mobilní spodní lišta modulu ZRUŠENA (feedback: dvě menu nad sebou) —
			    navigaci drží jediná aplikační lišta; Napsat + hamburger Schránek
			    jsou v hlavičce seznamu (onCompose/onOpenDrawer). */}

			{/* overlaye modulu: hledání ⌘K, Nová zpráva, tahák zkratek, plovoucí composer */}
			<SearchOverlay open={searchOn} onClose={() => setSearchOn(false)} />
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
