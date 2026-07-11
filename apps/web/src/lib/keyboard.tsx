import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Cheatsheet } from "../components/Cheatsheet";
import { CommandPalette } from "../components/CommandPalette";
import { useAddTask } from "./addTask";
import { useListSearch } from "./listSearch";
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
	k: "/ukoly", // kalendář = pohled Úkolů (view switcher v headeru)
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
	const { openAdd } = useAddTask();
	const { setView, locked } = useViewMode();
	const { setOpen: setSearchOpen } = useListSearch();
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

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (onMailRef.current) return;
			// Esc zavře tahák / paletu (ostatní vrstvy mají vlastní Esc handlery)
			if (e.key === "Escape") {
				if (cheatOpen) setCheatOpen(false);
				else if (paletteOpen) setPaletteOpen(false);
				return;
			}
			// ⌘K / Ctrl+K → command palette (před typing guardem, funguje i z inputu)
			if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
				e.preventDefault();
				setPaletteOpen((o) => !o);
				return;
			}
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el &&
				(el.tagName === "INPUT" ||
					el.tagName === "TEXTAREA" ||
					el.isContentEditable);
			// ⌘Z / ⌘⇧Z → zpět/vpřed (prototyp ř. 2206; s typing guardem)
			if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
				if (typing) return;
				e.preventDefault();
				if (e.shiftKey) void redo();
				else void undo();
				return;
			}
			if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

			// g + písmeno → navigace (okno 1200 ms); g+k = kalendářový pohled Úkolů
			if (gPending.current) {
				gPending.current = false;
				clearTimeout(gTimer.current);
				const key = (e.key || "").toLowerCase();
				const dest = G_ROUTES[key];
				if (dest) {
					e.preventDefault();
					// Zamčený výchozí pohled g-zkratky nepřepínají (prototyp goTo + viewLock).
					if (key === "k" && !locked) setView("calendar");
					else if (key === "u" && !locked) setView("list");
					void navigate({ to: dest });
				}
				return;
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
		setView,
		locked,
		setSearchOpen,
	]);

	return (
		<>
			{children}
			{cheatOpen && <Cheatsheet onClose={() => setCheatOpen(false)} />}
			{paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
		</>
	);
}
