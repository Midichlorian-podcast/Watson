import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { AddTaskModal } from "../components/AddTaskModal";

interface AddTaskCtx {
  openAdd: () => void;
}
const Ctx = createContext<AddTaskCtx>({ openAdd: () => {} });

/** Globální „Přidat úkol" — modal otevřený z tlačítek shellu i zkratkou `q`. */
export function AddTaskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "q" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <Ctx.Provider value={{ openAdd: () => setOpen(true) }}>
      {children}
      {open && <AddTaskModal onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

export const useAddTask = () => useContext(Ctx);
