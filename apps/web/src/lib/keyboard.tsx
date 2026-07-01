import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Cheatsheet } from "../components/Cheatsheet";
import { CommandPalette } from "../components/CommandPalette";
import { useAddTask } from "./addTask";

/** g + písmeno → route. Jen existující routes; ostatní cíle (kalendář/cíle/…) přibudou s obrazovkami. */
const G_ROUTES: Record<string, "/" | "/ukoly" | "/nadchazejici" | "/projekty" | "/nastaveni"> = {
  d: "/",
  u: "/ukoly",
  n: "/nadchazejici",
  p: "/projekty",
};

/**
 * Globální klávesové zkratky (1:1 dle Cloud Design): `?` tahák, `g`+písmeno navigace,
 * `q` nový úkol, Esc zavře tahák. Seznamová/kalendářová navigace (j/k, 1–3) přibude
 * s refaktorem seznamu (#36/#17) — viz RECONCILIACE.
 */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { openAdd } = useAddTask();
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
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      // g + písmeno → navigace (okno 1200 ms)
      if (gPending.current) {
        gPending.current = false;
        clearTimeout(gTimer.current);
        const dest = G_ROUTES[(e.key || "").toLowerCase()];
        if (dest) {
          e.preventDefault();
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
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        openAdd();
        return;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cheatOpen, paletteOpen, navigate, openAdd]);

  return (
    <>
      {children}
      {cheatOpen && <Cheatsheet onClose={() => setCheatOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}
