import { powerSync } from "./db";
import { storageGet, storageRemove } from "../storage";

/** Čtení citlivého device-only JSON z šifrované PowerSync SQLite DB. */
export async function readPrivateJson<T>(key: string, fallback: T): Promise<T> {
	try {
		const row = await powerSync.getOptional<{ value: string }>(
			"SELECT value FROM local_private_state WHERE id = ?",
			[key],
		);
		if (!row) return fallback;
		return JSON.parse(row.value) as T;
	} catch {
		return fallback;
	}
}

/** Atomický upsert citlivého device-only JSON do šifrované lokální DB. */
export async function writePrivateJson(key: string, value: unknown): Promise<void> {
	await powerSync.execute(
		`INSERT INTO local_private_state (id, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		[key, JSON.stringify(value), new Date().toISOString()],
	);
}

export async function removePrivateJson(key: string): Promise<void> {
	await powerSync.execute("DELETE FROM local_private_state WHERE id = ?", [key]);
}

/**
 * Přesune starou čitelnou localStorage hodnotu do šifrované DB. Mazání proběhne
 * až po úspěšném zápisu; chyba proto nezpůsobí ztrátu uživatelského konceptu.
 */
export async function migratePrivateJson<T>(key: string, fallback: T): Promise<T> {
	const stored = await readPrivateJson<T | null>(key, null);
	if (stored !== null) {
		storageRemove(key);
		return stored;
	}
	const legacy = storageGet(key);
	if (!legacy) return fallback;
	try {
		const parsed = JSON.parse(legacy) as T;
		await writePrivateJson(key, parsed);
		storageRemove(key);
		return parsed;
	} catch {
		return fallback;
	}
}
