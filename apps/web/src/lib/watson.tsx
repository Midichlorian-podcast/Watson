import { createContext, type ReactNode, useContext, useState } from "react";
import { WatsonCard } from "../components/WatsonCard";

interface WatsonCtx {
	toggleWatson: () => void;
}
const Ctx = createContext<WatsonCtx>({ toggleWatson: () => {} });

/**
 * Watson — vycentrovaná karta „Zeptej se Watsona" (AI příkazy napříč aplikací),
 * otevřená z headeru (pill W) a z mobilní lišty. Nahradila dřívější boční drawer
 * (feedback 2026-07-12: boční karty pryč, W má reálně konat).
 */
export function WatsonProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<Ctx.Provider value={{ toggleWatson: () => setOpen((o) => !o) }}>
			{children}
			{open && <WatsonCard onClose={() => setOpen(false)} />}
		</Ctx.Provider>
	);
}

export const useWatson = () => useContext(Ctx);
