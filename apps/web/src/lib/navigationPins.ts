import { useSyncExternalStore } from "react";
import { storageGet, storageSet } from "./storage";

export type NavigationPinKind = "project" | "saved_view";
export interface NavigationPin {
	kind: NavigationPinKind;
	id: string;
	/** Fallback metadata keeps a shortcut useful while its PowerSync row is still arriving. */
	label?: string;
	surface?: "tasks" | "upcoming";
	workspaceId?: string;
}

const STORAGE_KEY = "watson.navigationPins.v1";
const CHANGE_EVENT = "watson:navigation-pins";
const EMPTY: NavigationPin[] = [];
let cachedRaw: string | null | undefined;
let cachedPins: NavigationPin[] = EMPTY;

function validPin(value: unknown): value is NavigationPin {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		(row.kind === "project" || row.kind === "saved_view") &&
		typeof row.id === "string" &&
		row.id.length > 0 &&
		row.id.length <= 160 &&
		(row.label === undefined || (typeof row.label === "string" && row.label.length <= 160)) &&
		(row.surface === undefined || row.surface === "tasks" || row.surface === "upcoming") &&
		(row.workspaceId === undefined || typeof row.workspaceId === "string")
	);
}

export function readNavigationPins(): NavigationPin[] {
	const raw = storageGet(STORAGE_KEY);
	if (raw === cachedRaw) return cachedPins;
	cachedRaw = raw;
	if (!raw) {
		cachedPins = EMPTY;
		return cachedPins;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) throw new Error("invalid_navigation_pins");
		const seen = new Set<string>();
		cachedPins = parsed
			.filter(validPin)
			.filter((pin) => {
				const key = `${pin.kind}:${pin.id}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, 40);
	} catch {
		cachedPins = EMPTY;
	}
	return cachedPins;
}

function publish(next: NavigationPin[]) {
	const raw = JSON.stringify(next.slice(0, 40));
	storageSet(STORAGE_KEY, raw);
	cachedRaw = raw;
	cachedPins = next.slice(0, 40);
	if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setNavigationPin(
	kind: NavigationPinKind,
	id: string,
	pinned: boolean,
	metadata?: Pick<NavigationPin, "label" | "surface" | "workspaceId">,
) {
	const current = readNavigationPins();
	const without = current.filter((pin) => pin.kind !== kind || pin.id !== id);
	publish(pinned ? [...without, { kind, id, ...metadata }] : without);
}

function subscribe(onStoreChange: () => void) {
	if (typeof window === "undefined") return () => {};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		cachedRaw = undefined;
		onStoreChange();
	};
	window.addEventListener(CHANGE_EVENT, onStoreChange);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onStoreChange);
		window.removeEventListener("storage", onStorage);
	};
}

export function useNavigationPins() {
	const pins = useSyncExternalStore(subscribe, readNavigationPins, () => EMPTY);
	return {
		pins,
		isPinned: (kind: NavigationPinKind, id: string) =>
			pins.some((pin) => pin.kind === kind && pin.id === id),
		setPinned: setNavigationPin,
	};
}
