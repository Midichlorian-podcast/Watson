import { createContext, type ReactNode, useContext, useState } from "react";
import { AddTaskModal } from "../components/AddTaskModal";

/** Předvyplnění modalu (openAddAt prototypu, ř. 2664–2665 — klik/drag v kalendáři). */
export interface AddPrefill {
	/** Kompaktní globální zachycení; lze beze ztráty rozepsaného draftu rozbalit. */
	capture?: boolean;
	/** Bezpečně omezený název z Web Share Targetu nebo bookmarkletu. */
	rawName?: string;
	/** Kontext sdílené stránky/textu; uloží se jako popis a v capture UI se ukáže. */
	description?: string;
	/** YYYY-MM-DD → dateKind custom. */
	date?: string;
	/** HH:MM. */
	time?: string;
	/** Trvání v minutách. */
	duration?: number;
	/** Počet dní (vícedenní úkol) — z tažení přes dny v kalendáři. */
	days?: number;
	/** Předvyplněný projekt (CTA „+ Přidat úkol" ve filtrovaném projektu). */
	projectId?: string;
	/** Rodičovský úkol — plné přidání podúkolu (s atributy) z detailu. */
	parentId?: string;
	/** Název rodiče pro hint v hlavičce modalu (jen zobrazení). */
	parentName?: string;
}

interface AddTaskCtx {
	openAdd: (prefill?: AddPrefill) => void;
	openCapture: (prefill?: Pick<AddPrefill, "rawName" | "description">) => void;
}
const Ctx = createContext<AddTaskCtx>({ openAdd: () => {}, openCapture: () => {} });

/** Globální „Přidat úkol" — modal otevřený z tlačítek shellu, zkratkou `q` i klikem v kalendáři. */
export function AddTaskProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState<AddPrefill | null>(null);

	return (
		<Ctx.Provider
			value={{
				openAdd: (prefill) => setOpen(prefill ?? {}),
				openCapture: (prefill) => setOpen({ capture: true, ...prefill }),
			}}
		>
			{children}
			{open && <AddTaskModal initial={open} onClose={() => setOpen(null)} />}
		</Ctx.Provider>
	);
}

export const useAddTask = () => useContext(Ctx);
