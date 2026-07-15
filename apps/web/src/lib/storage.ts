/**
 * Best-effort wrapper around Web Storage.
 *
 * Access to `window.localStorage` itself can throw (blocked third-party storage,
 * hardened browsers, private mode, exhausted quota). UI preferences must never
 * make the application fail to boot, so every operation degrades to in-memory
 * defaults and reports success/failure to callers that care about persistence.
 */
function local(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

export function storageGet(key: string): string | null {
	try {
		return local()?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

export function storageSet(key: string, value: string): boolean {
	try {
		const storage = local();
		if (!storage) return false;
		storage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export function storageRemove(key: string): boolean {
	try {
		const storage = local();
		if (!storage) return false;
		storage.removeItem(key);
		return true;
	} catch {
		return false;
	}
}

export function storageKeys(): string[] {
	try {
		const storage = local();
		if (!storage) return [];
		return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
			(key): key is string => key !== null,
		);
	} catch {
		return [];
	}
}
