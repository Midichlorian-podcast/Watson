import { createContext, type ReactNode, useContext, useState } from "react";
import { trackRecentEntity } from "./recentItems";

interface TaskDetailCtx {
	openId: string | null;
	open: (id: string) => void;
	close: () => void;
	/** Pořadí viditelných úkolů aktuálního seznamu — ↑/↓ (j/k) v detailu (prototyp _navIds). */
	navIds: string[];
	setNavIds: (ids: string[]) => void;
}

const Ctx = createContext<TaskDetailCtx>({
	openId: null,
	open: () => {},
	close: () => {},
	navIds: [],
	setNavIds: () => {},
});

/** Drží, který úkol je otevřený v pravém detail panelu (sdíleno napříč obrazovkami). */
export function TaskDetailProvider({ children }: { children: ReactNode }) {
	const [openId, setOpenId] = useState<string | null>(null);
	const [navIds, setNavIds] = useState<string[]>([]);
	return (
		<Ctx.Provider
			value={{
				openId,
				open: (id) => {
					setOpenId(id);
					trackRecentEntity("task", id);
				},
				close: () => setOpenId(null),
				navIds,
				setNavIds,
			}}
		>
			{children}
		</Ctx.Provider>
	);
}

export const useTaskDetail = () => useContext(Ctx);
