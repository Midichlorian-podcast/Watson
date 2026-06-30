import { type ReactNode, createContext, useContext, useState } from "react";

interface ProjectDetailCtx {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
}

const Ctx = createContext<ProjectDetailCtx>({ openId: null, open: () => {}, close: () => {} });

/** Drží, který projekt je otevřený v pravém detail panelu (slide-in nad gridem Projekty). */
export function ProjectDetailProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ openId, open: setOpenId, close: () => setOpenId(null) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useProjectDetail = () => useContext(Ctx);
