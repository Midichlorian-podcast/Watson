import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Cheatsheet } from "../components/Cheatsheet";
import { CommandPalette } from "../components/CommandPalette";
import { useAddTask } from "./addTask";
import { useListSearch } from "./listSearch";
import { redo, undo } from "./undo";
import { useViewMode } from "./viewMode";

/** g + písmeno → route (plná mapa prototypu, ř. 2216: d/n/u/k/p/c/r/s/i/h). */
const G_ROUTES: Record<
	string,
	| "/"
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
	d: "/",
	u: "/ukoly",
	k: "/ukoly", // kalendář = pohled Úkolů (view switcher v headeru)
	n: "/nadchazejici",
	p: "/projekty",
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

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
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
