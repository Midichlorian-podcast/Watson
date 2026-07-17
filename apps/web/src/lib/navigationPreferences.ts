import { useSyncExternalStore } from "react";
import { storageGet, storageSet } from "./storage";

export type NavigationMode = "guided" | "advanced";

const KEY = "watson.navigationMode";
const CHANGE_EVENT = "watson:navigation-mode";

export function getNavigationMode(): NavigationMode {
	return storageGet(KEY) === "advanced" ? "advanced" : "guided";
}

export function setNavigationMode(mode: NavigationMode): void {
	storageSet(KEY, mode);
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, listener);
	window.addEventListener("storage", listener);
	return () => {
		window.removeEventListener(CHANGE_EVENT, listener);
		window.removeEventListener("storage", listener);
	};
}

/** Preference is non-critical UI state; blocked storage safely falls back to guided. */
export function useNavigationMode(): NavigationMode {
	return useSyncExternalStore(subscribe, getNavigationMode, () => "guided");
}
