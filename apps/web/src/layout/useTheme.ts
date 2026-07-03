import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const KEY = "w-theme";

/**
 * Light/dark přes `[data-w-theme="dark"]` na <html> — JEDEN sdílený stav pro celou app
 * (prototyp má jediný state.theme; header ikona i switch v Nastavení se přepínají spolu).
 * Zatím localStorage; trvale per-uživatel přes sync engine později (K3).
 */
let current: Theme =
	typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "dark"
		? "dark"
		: "light";
const listeners = new Set<() => void>();

function apply(theme: Theme) {
	const el = document.documentElement;
	if (theme === "dark") el.setAttribute("data-w-theme", "dark");
	else el.removeAttribute("data-w-theme");
	localStorage.setItem(KEY, theme);
}
if (typeof document !== "undefined") apply(current);

function setTheme(theme: Theme) {
	current = theme;
	apply(theme);
	for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useTheme() {
	const theme = useSyncExternalStore(
		subscribe,
		() => current,
		() => current,
	);
	return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
