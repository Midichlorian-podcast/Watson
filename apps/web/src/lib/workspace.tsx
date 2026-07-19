import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { API_URL } from "./api";
import { storageGet, storageSet } from "./storage";

export interface Workspace {
	id: string;
	name: string;
	isPersonal: boolean;
	color: string | null;
	/** Moje role v prostoru (memberships.role) — server ji posílá odjakživa. */
	role?: string;
	capabilities?: {
		manageGoals: boolean;
		manageListTemplates: boolean;
		manageKnowledge: boolean;
		manageWorkspaceMembers: boolean;
		createContacts: boolean;
		createLists: boolean;
	};
}

/**
 * Vedení = admin/manager aspoň jednoho TÝMOVÉHO prostoru (K2: Vlastník/Admin;
 * osobní prostory se nepočítají — tam je adminem každý). Gating Velína.
 */
export function isLeadership(workspaces: Workspace[] | undefined): boolean {
	return (workspaces ?? []).some(
		(w) => !w.isPersonal && (w.role === "admin" || w.role === "manager"),
	);
}

/** Prostory přihlášeného uživatele (přes membership). Sdílený react-query klíč. */
export function useWorkspaces() {
	return useQuery({
		queryKey: ["workspaces"],
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces`, {
				credentials: "include",
			});
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

/**
 * Aktivní pracovní prostor + sbalování v sidebaru. Plný app shell ukládá poslední
 * volbu jako výchozí pro příští okno; focus/wallboard dostanou izolovaný kontext,
 * takže jejich `?prostor=` nikdy nepřepne ostatní okna.
 */
export function WorkspaceProvider({
	children,
	initialWorkspaceId,
	persist = true,
}: {
	children: ReactNode;
	initialWorkspaceId?: string | null;
	persist?: boolean;
}) {
	const { data: workspaces } = useWorkspaces();
	const [activeWs, setActiveWsState] = useState<string | null>(
		() => initialWorkspaceId ?? (persist ? storageGet(LS_KEY) : null),
	);
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

	// Deep-link má přednost, ale jen pokud ho server skutečně vrátil přihlášenému uživateli.
	useEffect(() => {
		if (!workspaces || workspaces.length === 0) return;
		if (
			initialWorkspaceId &&
			initialWorkspaceId !== activeWs &&
			workspaces.some((workspace) => workspace.id === initialWorkspaceId)
		) {
			setActiveWsState(initialWorkspaceId);
			if (persist) storageSet(LS_KEY, initialWorkspaceId);
			return;
		}
		if (activeWs && workspaces.some((w) => w.id === activeWs)) return;
		const def = workspaces.find((w) => !w.isPersonal) ?? workspaces[0];
		if (def) {
			setActiveWsState(def.id);
			if (persist) storageSet(LS_KEY, def.id);
		}
	}, [workspaces, activeWs, initialWorkspaceId, persist]);

	const setActiveWs = useCallback(
		(id: string) => {
			setActiveWsState(id);
			if (persist) storageSet(LS_KEY, id);
			// Vyčistit explicitní stavy — rozbalený zůstane jen nově aktivní prostor
			// (jinak by se dřívější aktivní/ručně rozbalené hromadily rozbalené naráz).
			setCollapsed({ [id]: false });
		},
		[persist],
	);
	const isCollapsed = (id: string) =>
		collapsed[id] !== undefined ? collapsed[id] : id !== activeWs;
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
