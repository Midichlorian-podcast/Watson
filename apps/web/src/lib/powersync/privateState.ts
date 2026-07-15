import { storageGet, storageRemove } from "../storage";
import { powerSync } from "./db";

interface PrivateStateTransaction {
	getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>;
	execute(sql: string, parameters?: unknown[]): Promise<unknown>;
}

interface PrivateStateWriter {
	writeTransaction(callback: (transaction: PrivateStateTransaction) => Promise<void>): Promise<void>;
}

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

/**
 * Atomický upsert citlivého device-only JSON. PowerSync tabulky jsou SQLite
 * views, na kterých `INSERT … ON CONFLICT` končí `cannot UPSERT a view`.
 * Existenci proto zjistíme a UPDATE/INSERT provedeme ve stejné transakci.
 */
export async function writePrivateJsonWith(
	database: PrivateStateWriter,
	key: string,
	value: unknown,
	now = new Date().toISOString(),
): Promise<void> {
	await database.writeTransaction(async (transaction) => {
		const existing = await transaction.getOptional<{ id: string }>(
			"SELECT id FROM local_private_state WHERE id = ?",
			[key],
		);
		if (existing) {
			await transaction.execute(
				"UPDATE local_private_state SET value = ?, updated_at = ? WHERE id = ?",
				[JSON.stringify(value), now, key],
			);
			return;
		}
		await transaction.execute(
			"INSERT INTO local_private_state (id, value, updated_at) VALUES (?, ?, ?)",
			[key, JSON.stringify(value), now],
		);
	});
}

/** Atomický upsert citlivého device-only JSON do šifrované lokální DB. */
export async function writePrivateJson(key: string, value: unknown): Promise<void> {
	await writePrivateJsonWith(powerSync as unknown as PrivateStateWriter, key, value);
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
