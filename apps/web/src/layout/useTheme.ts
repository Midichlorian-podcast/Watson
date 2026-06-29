import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "w-theme";

/**
 * Light/dark přepínač přes `[data-w-theme="dark"]` na <html> (tokeny v packages/ui).
 * Zatím localStorage (efemérní UI preference); trvale per-uživatel přes sync engine později (K3).
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    const el = document.documentElement;
    if (theme === "dark") el.setAttribute("data-w-theme", "dark");
    else el.removeAttribute("data-w-theme");
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((p) => (p === "dark" ? "light" : "dark")) };
}
