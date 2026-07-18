import { useSyncExternalStore } from "react";
import { storageGet, storageSet } from "../lib/storage";

type Theme = "light" | "dark";
const KEY = "w-theme";

/**
 * Light/dark přes `[data-w-theme="dark"]` na <html> — JEDEN sdílený stav pro celou app
 * (prototyp má jediný state.theme; header ikona i switch v Nastavení se přepínají spolu).
 * Zatím localStorage; trvale per-uživatel přes sync engine později (K3).
 */
let current: Theme = storageGet(KEY) === "dark" ? "dark" : "light";
const listeners = new Set<() => void>();

function apply(theme: Theme, persist = true) {
	const el = document.documentElement;
	if (theme === "dark") el.setAttribute("data-w-theme", "dark");
	else el.removeAttribute("data-w-theme");
	if (persist) storageSet(KEY, theme);
}
if (typeof document !== "undefined") apply(current);

function setTheme(theme: Theme) {
	current = theme;
	apply(theme);
	for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	const onStorage = (event: StorageEvent) => {
		if (event.key !== KEY) return;
		current = event.newValue === "dark" ? "dark" : "light";
		apply(current, false);
		l();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(l);
		window.removeEventListener("storage", onStorage);
	};
};

export function useTheme() {
	const theme = useSyncExternalStore(
		subscribe,
		() => current,
		() => current,
	);
	return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
