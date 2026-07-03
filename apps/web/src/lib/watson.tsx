import { createContext, type ReactNode, useContext, useState } from "react";
import { WatsonPanel } from "../components/WatsonPanel";

interface WatsonCtx {
	toggleWatson: () => void;
}
const Ctx = createContext<WatsonCtx>({ toggleWatson: () => {} });

/** Watson drawer (assistant) — otevřený z headeru (pill + zvonek) a z Dnes stripu („Více →"). */
export function WatsonProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<Ctx.Provider value={{ toggleWatson: () => setOpen((o) => !o) }}>
			{children}
			{open && <WatsonPanel onClose={() => setOpen(false)} />}
		</Ctx.Provider>
	);
}

export const useWatson = () => useContext(Ctx);
