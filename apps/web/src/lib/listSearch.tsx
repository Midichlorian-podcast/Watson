import { type ReactNode, createContext, useContext, useState } from "react";

/**
 * Inline hledání v headeru (prototyp searchOpen + focusSearch, ř. 290–296 + 2261):
 * `/` otevře input v headeru, psaní filtruje aktuální seznam (Dnes/Úkoly/Nadcházející).
 */
interface ListSearchCtx {
  q: string;
  setQ: (q: string) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}

const Ctx = createContext<ListSearchCtx>({ q: "", setQ: () => {}, open: false, setOpen: () => {} });

export function ListSearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Ctx.Provider
      value={{
        q,
        setQ,
        open,
        setOpen: (o) => {
          setOpen(o);
          if (!o) setQ("");
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useListSearch = () => useContext(Ctx);

/** Filtr úkolů dle inline hledání (case-insensitive substring v názvu). */
export function filterByQuery<T extends { name: string | null }>(list: T[], q: string): T[] {
  const query = q.trim().toLowerCase();
  if (!query) return list;
  return list.filter((x) => (x.name ?? "").toLowerCase().includes(query));
}
