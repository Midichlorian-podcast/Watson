import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Cheatsheet } from "../components/Cheatsheet";
import { CommandPalette } from "../components/CommandPalette";
import { useAddTask } from "./addTask";
import { useListSearch } from "./listSearch";
import { useTaskDetail } from "./taskDetail";
import { redo, undo } from "./undo";
import { useViewMode } from "./viewMode";

/** g + písmeno → route (plná mapa prototypu, ř. 2216 + gmap: a/l/v/m pro nové obrazovky). */
const G_ROUTES: Record<
	string,
	| "/"
	| "/prehled"
	| "/mail"
	| "/seznamy"
	| "/velin"
	| "/ukoly"
	| "/nadchazejici"
	| "/projekty"
	| "/nastaveni"
	| "/schranka"
	| "/hledat"
	| "/cile"
	| "/reporty"
	| "/postupy"
> = {
	a: "/prehled",
	d: "/",
	u: "/ukoly",
	k: "/nadchazejici", // kalendář = jediný celoapkový kalendář (Nadcházející); z Úkolů odebrán
	n: "/nadchazejici",
	p: "/projekty",
	l: "/seznamy",
	v: "/velin", // Velín — ne-vedení uvidí zamčenou obrazovku (gating na obrazovce)
	m: "/mail",
	c: "/cile",
	r: "/reporty",
	s: "/postupy",
	i: "/schranka",
	h: "/hledat",
};

/**
 * Globální klávesové zkratky (1:1 dle Cloud Design): `?` tahák, `g`+písmeno navigace,
 * `q` nový úkol, Esc zavře tahák. Seznamová/kalendářová navigace (j/k, 1–3) přibude
 * s refaktorem seznamu (#36/#17) — viz RECONCILIACE.
 */
export function KeyboardProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const { openAdd, openCapture } = useAddTask();
	const { setView: setTaskView, locked: taskViewLocked } = useViewMode("tasks");
	const { setView: setUpcomingView, locked: upcomingViewLocked } = useViewMode("upcoming");
	const { setOpen: setSearchOpen } = useListSearch();
	const { openId } = useTaskDetail();
	const [cheatOpen, setCheatOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const gPending = useRef(false);
	const gTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	// Mail vlastní klávesnici, když je jeho obrazovka aktivní — appka své zkratky
	// vypíná (prototyp _onKey ř. 2853: `if(screen==='mail') return`).
	const path = useRouterState({ select: (s) => s.location.pathname });
	const onMail = path.startsWith("/mail");
	const onMailRef = useRef(onMail);
	onMailRef.current = onMail;

	// Otevřít globální paletu programově (mailová lupa dispatchuje 'watson:open-palette')
	// — jedno hledání pro navigaci i poštu, žádný samostatný mailový overlay.
	useEffect(() => {
		const h = () => setPaletteOpen(true);
		window.addEventListener("watson:open-palette", h);
		return () => window.removeEventListener("watson:open-palette", h);
	}, []);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			// Esc zavře tahák/paletu i na /mailu — jinak by je onMail early-return nechal
			// viset bez možnosti zavření klávesou (ostatní vrstvy nesou vlastní Esc handler).
			if (e.key === "Escape") {
				if (cheatOpen) setCheatOpen(false);
				else if (paletteOpen) setPaletteOpen(false);
				return;
			}
			// ⌘K / Ctrl+K → JEDNA globální paleta (i na /mailu — hledá navigaci i poštu;
			// mailový search-overlay zrušen, koherence 2026-07-12). Před onMail guardem.
			if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
				e.preventDefault();
				setCheatOpen(false);
				setPaletteOpen((o) => !o);
				return;
			}
			// Globální Quick Capture funguje na každé obrazovce včetně Mailu. Modifikovaná
			// zkratka nekoliduje s psaním ani s mailovými single-key akcemi.
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space") {
				if (document.querySelector("[data-esc-layer]")) return;
				e.preventDefault();
				setCheatOpen(false);
				setPaletteOpen(false);
				openCapture();
				return;
			}
			if (onMailRef.current) return;
			// Otevřená vrstva (detail úkolu / tahák / ⌘K / modal) blokuje globální
			// zkratky (q, /, ?, g-nav, ⌘Z), ať neprosáknou na obsah pod vrstvou —
			// stejně jako kbNav/BulkBar. Esc a ⌘K výše fungují i nad vrstvami záměrně.
			if (openId || document.querySelector("[data-esc-layer]")) return;
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
			// ⌘Z / ⌘⇧Z → zpět/vpřed (prototyp ř. 2206; s typing guardem)
			if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
				if (typing) return;
				e.preventDefault();
				if (e.shiftKey) void redo();
				else void undo();
				return;
			}
			if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

			// g + písmeno → navigace (okno 1200 ms); g+k = kalendář Nadcházejících
			if (gPending.current) {
				gPending.current = false;
				clearTimeout(gTimer.current);
				const key = (e.key || "").toLowerCase();
				const dest = G_ROUTES[key];
				if (dest) {
					e.preventDefault();
					// Zamčený výchozí pohled g-zkratky nepřepínají (prototyp goTo + viewLock).
					if (key === "k" && !upcomingViewLocked) setUpcomingView("calendar");
					else if (key === "u" && !taskViewLocked) setTaskView("list");
					void navigate({ to: dest });
					return;
				}
				// Neznámý cíl po `g` klávesu nespolkne — propadne do běžných zkratek
				// níže (např. `g` pak `q` založí úkol, `g` pak `?` otevře tahák).
			}
			if (e.key === "g" || e.key === "G") {
				e.preventDefault();
				gPending.current = true;
				clearTimeout(gTimer.current);
				gTimer.current = setTimeout(() => {
					gPending.current = false;
				}, 1200);
				return;
			}
			if (e.key === "?") {
				e.preventDefault();
				setCheatOpen((o) => !o);
				return;
			}
			// `/` → inline hledání v headeru (prototyp focusSearch, ř. 2261)
			if (e.key === "/") {
				e.preventDefault();
				setSearchOpen(true);
				return;
			}
			if (e.key === "q" || e.key === "Q") {
				e.preventDefault();
				openAdd();
				return;
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [
		cheatOpen,
		paletteOpen,
		navigate,
		openAdd,
		openCapture,
		setTaskView,
		taskViewLocked,
		setUpcomingView,
		upcomingViewLocked,
		setSearchOpen,
		openId,
	]);

	return (
		<>
			{children}
			{cheatOpen && <Cheatsheet onClose={() => setCheatOpen(false)} />}
			{paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
		</>
	);
}
