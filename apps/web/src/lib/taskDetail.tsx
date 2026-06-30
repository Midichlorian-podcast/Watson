import { type ReactNode, createContext, useContext, useState } from "react";

interface TaskDetailCtx {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
}

const Ctx = createContext<TaskDetailCtx>({ openId: null, open: () => {}, close: () => {} });

/** Drží, který úkol je otevřený v pravém detail panelu (sdíleno napříč obrazovkami). */
export function TaskDetailProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ openId, open: setOpenId, close: () => setOpenId(null) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTaskDetail = () => useContext(Ctx);
