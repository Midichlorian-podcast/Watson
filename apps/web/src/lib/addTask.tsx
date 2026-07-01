import { type ReactNode, createContext, useContext, useState } from "react";
import { AddTaskModal } from "../components/AddTaskModal";

interface AddTaskCtx {
  openAdd: () => void;
}
const Ctx = createContext<AddTaskCtx>({ openAdd: () => {} });

/** Globální „Přidat úkol" — modal otevřený z tlačítek shellu i zkratkou `q` (viz KeyboardProvider). */
export function AddTaskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Ctx.Provider value={{ openAdd: () => setOpen(true) }}>
      {children}
      {open && <AddTaskModal onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

export const useAddTask = () => useContext(Ctx);
