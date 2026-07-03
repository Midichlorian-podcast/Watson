import { createContext, type ReactNode, useContext, useState } from "react";

/**
 * Sdílený režim zobrazení Seznam | Nástěnka | Kalendář (prototyp s.view — globální pro
 * všechny workspace obrazovky) + zámek výchozího zobrazení (toggleViewLock, ř. 3240):
 * zamčené zobrazení se persistuje a platí po startu; bez zámku se startuje na Seznamu.
 */
export type ViewMode = "list" | "board" | "calendar";

const LS_LOCK = "watson.lockedView";

interface ViewModeCtx {
	view: ViewMode;
	setView: (v: ViewMode) => void;
	locked: boolean;
	toggleLock: () => void;
}

const Ctx = createContext<ViewModeCtx>({
	view: "list",
	setView: () => {},
	locked: false,
	toggleLock: () => {},
});

const readLock = (): ViewMode | null => {
	const v = localStorage.getItem(LS_LOCK);
	return v === "list" || v === "board" || v === "calendar" ? v : null;
};

export function ViewModeProvider({ children }: { children: ReactNode }) {
	const [view, setViewState] = useState<ViewMode>(() => readLock() ?? "list");
	const [locked, setLocked] = useState(() => readLock() !== null);

	// Zamčený výchozí pohled je snapshot z toggleLock — běžné přepínání ho nepřepisuje
	// (prototyp: lockedView mění jen toggleViewLock, ř. 3240).
	const setView = (v: ViewMode) => {
		setViewState(v);
	};
	const toggleLock = () => {
		if (locked) {
			localStorage.removeItem(LS_LOCK);
			setLocked(false);
		} else {
			localStorage.setItem(LS_LOCK, view);
			setLocked(true);
		}
	};

	return (
		<Ctx.Provider value={{ view, setView, locked, toggleLock }}>
			{children}
		</Ctx.Provider>
	);
}

export const useViewMode = () => useContext(Ctx);
