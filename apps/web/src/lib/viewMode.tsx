import { useRouterState } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { storageGet, storageRemove, storageSet } from "./storage";

export type ViewMode = "list" | "board" | "calendar";
export type ViewSurface = "tasks" | "upcoming" | "favorites";

export const VIEW_SURFACES: ViewSurface[] = ["tasks", "upcoming", "favorites"];

const LEGACY_LOCK = "watson.lockedView";
const DEFAULT_VIEW_PREFIX = "watson.defaultView.v2";

export function defaultViewStorageKey(surface: ViewSurface): string {
	return `${DEFAULT_VIEW_PREFIX}.${surface}`;
}

export function viewSurfaceForPath(path: string): ViewSurface | null {
	if (path === "/" || path.startsWith("/ukoly") || path.startsWith("/schranka"))
		return "tasks";
	if (path.startsWith("/nadchazejici")) return "upcoming";
	if (path.startsWith("/oblibene")) return "favorites";
	return null;
}

export function normalizeDefaultView(
	surface: ViewSurface,
	value: string | null,
): ViewMode | null {
	if (value !== "list" && value !== "board" && value !== "calendar") return null;
	// Globální inventář Úkolů nemá kalendář; ten patří Nadcházejícím. Starý globální
	// zámek „Kalendář" proto při migraci nesmí nechat Úkoly v neexistujícím stavu.
	if (surface === "tasks" && value === "calendar") return "list";
	return value;
}

interface SurfaceViewState {
	view: ViewMode;
	defaultView: ViewMode | null;
}

export function nextDefaultView(defaultView: ViewMode | null, currentView: ViewMode) {
	return defaultView === currentView ? null : currentView;
}

type SurfaceState = Record<ViewSurface, SurfaceViewState>;

function readInitialState(): SurfaceState {
	const legacy = storageGet(LEGACY_LOCK);
	const state = {} as SurfaceState;
	for (const surface of VIEW_SURFACES) {
		const key = defaultViewStorageKey(surface);
		const stored = normalizeDefaultView(surface, storageGet(key));
		const migrated = stored ?? normalizeDefaultView(surface, legacy);
		state[surface] = { view: migrated ?? "list", defaultView: migrated };
		if (!stored && migrated) storageSet(key, migrated);
	}
	if (legacy) storageRemove(LEGACY_LOCK);
	return state;
}

interface ViewModeContextValue {
	states: SurfaceState;
	setView: (surface: ViewSurface, view: ViewMode) => void;
	toggleLock: (surface: ViewSurface) => void;
}

const fallbackStates: SurfaceState = {
	tasks: { view: "list", defaultView: null },
	upcoming: { view: "list", defaultView: null },
	favorites: { view: "list", defaultView: null },
};

const Ctx = createContext<ViewModeContextValue>({
	states: fallbackStates,
	setView: () => {},
	toggleLock: () => {},
});

/**
 * Režim zobrazení a jeho výchozí hodnota jsou oddělené per pracovní povrch.
 * Přepnutí zobrazení je dočasné; zámeček ukládá právě zvolený režim jako výchozí.
 */
export function ViewModeProvider({ children }: { children: ReactNode }) {
	const path = useRouterState({ select: (state) => state.location.pathname });
	const activeSurface = viewSurfaceForPath(path);
	const previousSurface = useRef<ViewSurface | null>(activeSurface);
	const [states, setStates] = useState<SurfaceState>(readInitialState);

	// Při novém vstupu do modulu se vrať k jeho výchozímu pohledu. Přechody mezi
	// Dnes/Vše/Zásobníkem jsou stále jeden modul a dočasné zobrazení nerestartují.
	useEffect(() => {
		if (activeSurface && previousSurface.current !== activeSurface) {
			setStates((current) => ({
				...current,
				[activeSurface]: {
					...current[activeSurface],
					view: current[activeSurface].defaultView ?? "list",
				},
			}));
		}
		previousSurface.current = activeSurface;
	}, [activeSurface]);

	const setView = useCallback((surface: ViewSurface, view: ViewMode) => {
		setStates((current) => ({
			...current,
			[surface]: { ...current[surface], view },
		}));
	}, []);

	const toggleLock = useCallback((surface: ViewSurface) => {
		setStates((current) => {
			const selected = current[surface];
			const nextDefault = nextDefaultView(selected.defaultView, selected.view);
			// Kliknutí na právě uloženém defaultu jej odemkne. Pokud uživatel mezitím
			// přepnul pohled, jediné kliknutí nový pohled rovnou uloží jako default.
			if (nextDefault === null) {
				storageRemove(defaultViewStorageKey(surface));
				return {
					...current,
					[surface]: { ...selected, defaultView: null },
				};
			}
			storageSet(defaultViewStorageKey(surface), nextDefault);
			return {
				...current,
				[surface]: { ...selected, defaultView: nextDefault },
			};
		});
	}, []);

	return <Ctx.Provider value={{ states, setView, toggleLock }}>{children}</Ctx.Provider>;
}

export function useViewMode(surface: ViewSurface = "tasks") {
	const context = useContext(Ctx);
	const state = context.states[surface];
	const setView = useCallback(
		(view: ViewMode) => context.setView(surface, view),
		[context.setView, surface],
	);
	const toggleLock = useCallback(
		() => context.toggleLock(surface),
		[context.toggleLock, surface],
	);
	return {
		view: state.view,
		setView,
		locked: state.defaultView === state.view,
		defaultView: state.defaultView,
		toggleLock,
	};
}
