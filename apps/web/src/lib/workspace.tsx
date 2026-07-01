import { useQuery } from "@tanstack/react-query";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { API_URL } from "./api";

export interface Workspace {
  id: string;
  name: string;
  isPersonal: boolean;
  color: string | null;
}

/** Prostory přihlášeného uživatele (přes membership). Sdílený react-query klíč. */
export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces`, { credentials: "include" });
      if (!r.ok) throw new Error("workspaces");
      return (await r.json()).workspaces as Workspace[];
    },
  });
}

interface WorkspaceCtx {
  activeWs: string | null;
  setActiveWs: (id: string) => void;
  isCollapsed: (id: string) => boolean;
  toggleCollapse: (id: string) => void;
}
const Ctx = createContext<WorkspaceCtx>({
  activeWs: null,
  setActiveWs: () => {},
  isCollapsed: () => true,
  toggleCollapse: () => {},
});

const LS_KEY = "watson.activeWs";

/** Aktivní pracovní prostor (per-user v localStorage) + sbalování v sidebaru. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: workspaces } = useWorkspaces();
  const [activeWs, setActiveWsState] = useState<string | null>(() => localStorage.getItem(LS_KEY));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Zvol výchozí prostor (první neosobní / první), pokud žádný nebo neplatný.
  useEffect(() => {
    if (!workspaces || workspaces.length === 0) return;
    if (activeWs && workspaces.some((w) => w.id === activeWs)) return;
    const def = workspaces.find((w) => !w.isPersonal) ?? workspaces[0];
    if (def) {
      setActiveWsState(def.id);
      localStorage.setItem(LS_KEY, def.id);
    }
  }, [workspaces, activeWs]);

  const setActiveWs = (id: string) => {
    setActiveWsState(id);
    localStorage.setItem(LS_KEY, id);
    setCollapsed((c) => ({ ...c, [id]: false }));
  };
  const isCollapsed = (id: string) => (collapsed[id] !== undefined ? collapsed[id] : id !== activeWs);
  const toggleCollapse = (id: string) =>
    setCollapsed((c) => {
      const cur = c[id] !== undefined ? c[id] : id !== activeWs;
      return { ...c, [id]: !cur };
    });

  return (
    <Ctx.Provider value={{ activeWs, setActiveWs, isCollapsed, toggleCollapse }}>
      {children}
    </Ctx.Provider>
  );
}

export const useWorkspace = () => useContext(Ctx);
