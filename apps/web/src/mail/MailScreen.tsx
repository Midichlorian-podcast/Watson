/**
 * Mail — shell obrazovky: 3-panelový layout (účty a složky / seznam / thread
 * workspace) dle prototypu data-mailroot + mobilní krok list↔thread (data-mstep)
 * a vlastní klávesnice mailu (prototyp kbd, ř. 2740–2769). Motiv se propisuje
 * z aplikace (kontrakt `vzhled`) přes data-wm-theme scope.
 */
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../layout/useTheme";
import "./mail.css";
import { AdminScreen } from "./AdminScreen";
import { CheatSheet } from "./CheatSheet";
import { DeniScreen } from "./DeniScreen";
import { MailList, useListRows } from "./MailList";
import { MailSub } from "./MailSub";
import { MailThread } from "./MailThread";
import { NastaveniScreen } from "./NastaveniScreen";
import { NewMessage } from "./NewMessage";
import { SearchOverlay } from "./SearchOverlay";
import { useMail } from "./state";

export function MailScreen() {
	const m = useMail();
	const { theme } = useTheme();
	const [drawer, setDrawer] = useState(false);
	// overlaye: hledání (⌘K, /), Nová zpráva (C, Napsat), tahák zkratek (?)
	const [searchOn, setSearchOn] = useState(false);
	const [newOn, setNewOn] = useState(false);
	const [cheatOn, setCheatOn] = useState(false);
	const { order } = useListRows();
	const orderRef = useRef(order);
	orderRef.current = order;
	const mRef = useRef(m);
	mRef.current = m;

	// klávesnice mailu — jen když je obrazovka aktivní (mount = aktivní route)
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el &&
				(el.tagName === "INPUT" ||
					el.tagName === "TEXTAREA" ||
					el.isContentEditable);
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
			style={{ display: "flex", flex: 1, minHeight: 0, height: "100%" }}
		>
			<div
				data-mailroot
				data-mstep={m.mstep}
				style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }}
			>
				<MailSub drawer={drawer} onCloseDrawer={() => setDrawer(false)} />
				{/* vnitřní obrazovky nahrazují seznam+vlákno; panel složek zůstává */}
				{m.scr === "mail" ? (
					<>
						<MailList
							onOpenDrawer={() => setDrawer(true)}
							onSearch={() => setSearchOn(true)}
							onCompose={() => setNewOn(true)}
						/>
						<MailThread />
					</>
				) : m.scr === "deni" ? (
					<DeniScreen />
				) : m.scr === "admin" ? (
					<AdminScreen />
				) : (
					<NastaveniScreen />
				)}
			</div>

			{/* overlaye modulu: hledání ⌘K, Nová zpráva, tahák zkratek */}
			<SearchOverlay open={searchOn} onClose={() => setSearchOn(false)} />
			<NewMessage open={newOn} onClose={() => setNewOn(false)} />
			<CheatSheet open={cheatOn} onClose={() => setCheatOn(false)} />
		</div>
	);
}
