import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

/**
 * Výběr úkolů pro hromadné akce (prototyp selTasks + toggleSelTask, ř. 3133–3134):
 * checkbox v řádku seznamu, shift-klik vybere rozsah dle pořadí viditelných řádků
 * (navIds). Lišta akcí = components/BulkBar.tsx.
 */
interface BulkSelectCtx {
	selected: Record<string, true>;
	count: number;
	isSelected: (id: string) => boolean;
	/** Toggle výběru; shift-klik = rozsah mezi posledním klikem a `id` dle `orderIds`. */
	toggle: (id: string, shiftKey: boolean, orderIds: string[]) => void;
	clear: () => void;
}

const Ctx = createContext<BulkSelectCtx>({
	selected: {},
	count: 0,
	isSelected: () => false,
	toggle: () => {},
	clear: () => {},
});

export function BulkSelectProvider({ children }: { children: ReactNode }) {
	const [selected, setSelected] = useState<Record<string, true>>({});
	const lastSel = useRef<string | null>(null);

	const toggle = useCallback(
		(id: string, shiftKey: boolean, orderIds: string[]) => {
			setSelected((prev) => {
				const next = { ...prev };
				const anchor = lastSel.current;
				const ai = anchor ? orderIds.indexOf(anchor) : -1;
				const bi = orderIds.indexOf(id);
				if (shiftKey && ai >= 0 && bi >= 0) {
					// rozsah — vždy PŘIDÁ (prototyp: shift-klik = rozsah)
					const [from, to] = ai < bi ? [ai, bi] : [bi, ai];
					for (let i = from; i <= to; i++) {
						const oid = orderIds[i];
						if (oid) next[oid] = true;
					}
				} else if (next[id]) {
					delete next[id];
				} else {
					next[id] = true;
				}
				return next;
			});
			lastSel.current = id;
		},
		[],
	);

	const clear = useCallback(() => {
		setSelected({});
		lastSel.current = null;
	}, []);

	const value = useMemo<BulkSelectCtx>(
		() => ({
			selected,
			count: Object.keys(selected).length,
			isSelected: (id) => !!selected[id],
			toggle,
			clear,
		}),
		[selected, toggle, clear],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useBulkSelect = () => useContext(Ctx);
