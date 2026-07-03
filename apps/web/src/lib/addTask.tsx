import { createContext, type ReactNode, useContext, useState } from "react";
import { AddTaskModal } from "../components/AddTaskModal";

/** Předvyplnění modalu (openAddAt prototypu, ř. 2664–2665 — klik/drag v kalendáři). */
export interface AddPrefill {
	/** YYYY-MM-DD → dateKind custom. */
	date?: string;
	/** HH:MM. */
	time?: string;
	/** Trvání v minutách. */
	duration?: number;
	/** Předvyplněný projekt (CTA „+ Přidat úkol" ve filtrovaném projektu). */
	projectId?: string;
}

interface AddTaskCtx {
	openAdd: (prefill?: AddPrefill) => void;
}
const Ctx = createContext<AddTaskCtx>({ openAdd: () => {} });

/** Globální „Přidat úkol" — modal otevřený z tlačítek shellu, zkratkou `q` i klikem v kalendáři. */
export function AddTaskProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState<AddPrefill | null>(null);

	return (
		<Ctx.Provider value={{ openAdd: (prefill) => setOpen(prefill ?? {}) }}>
			{children}
			{open && <AddTaskModal initial={open} onClose={() => setOpen(null)} />}
		</Ctx.Provider>
	);
}

export const useAddTask = () => useContext(Ctx);
