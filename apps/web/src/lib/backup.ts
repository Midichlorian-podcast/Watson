/**
 * Lokální EXPORT dat nasyncovaných v PowerSync SQLite jako jeden JSON soubor.
 * Funguje offline, bez serveru i bez Googlu.
 *
 * P1-12 — tohle NENÍ záloha a UI to tak nesmí prezentovat: chybí import/restore,
 * manifest schématu, checksum i data, která lokální DB nedrží (task_activity,
 * audit_events, mail). Skutečná versioned záloha s ověřeným restore = F3 (CC-P0-14).
 */

import { API_URL } from "./api";
import { powerSync } from "./powersync/db";

/** Tabulky zahrnuté do zálohy (dle AppSchema; task_activity je insert-only, lokálně není). */
const BACKUP_TABLES = [
	"tasks",
	"projects",
	"project_milestones",
	"sections",
	"statuses",
	"project_members",
	"assignments",
	"task_acceptances",
	"comments",
	"comment_decisions",
	"mentions",
	"comment_reactions",
	"task_occurrence_overrides",
	"task_user_colors",
	"reminders",
	"availability_profiles",
	"availability_blocks",
	"chains",
	"chain_steps",
	"goals",
	"goal_projects",
	"goal_milestones",
	"lists",
	"list_sections",
	"list_items",
	"list_templates",
	"contacts",
	"entity_links",
	// Meets — metadata porad (sidecar kotevních úkolů); bez nich by restore ztratil
	// vazbu meeting_id → stav/řetěz porady (audit Fáze 1).
	"meetings",
] as const;

export interface BackupResult {
	/** Kolik řádků celkem se zazálohovalo. */
	rowCount: number;
	/** Název staženého souboru. */
	filename: string;
}

/** Sesbírá všechny tabulky do jednoho objektu (název tabulky → pole řádků). */
async function collect(): Promise<{
	tables: Record<string, unknown[]>;
	rowCount: number;
}> {
	const tables: Record<string, unknown[]> = {};
	let rowCount = 0;
	for (const t of BACKUP_TABLES) {
		try {
			const rows = await powerSync.getAll(`SELECT * FROM ${t}`);
			tables[t] = rows;
			rowCount += rows.length;
		} catch {
			// Tabulka může chybět (starší schéma) — přeskoč, ať záloha nespadne celá.
			tables[t] = [];
		}
	}
	return { tables, rowCount };
}

/**
 * Vytvoří zálohu a spustí stažení souboru. `stamp` (ISO čas) dodá volající —
 * new Date() je záměrně mimo, ať jde funkce testovat deterministicky.
 */
export async function downloadLocalExport(stamp: string): Promise<BackupResult> {
	const { tables, rowCount } = await collect();
	const payload = {
		app: "watson",
		kind: "backup",
		version: 1,
		exportedAt: stamp,
		rowCount,
		tables,
	};
	const json = JSON.stringify(payload, null, 2);
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	// Bezpečný název souboru z časové značky (dvojtečky/tečky ven).
	const safe = stamp.replace(/[:.]/g, "-");
	const filename = `watson-zaloha-${safe}.json`;
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Uvolni blob URL až po kliknutí (Safari potřebuje malý odklad).
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	return { rowCount, filename };
}

export type ServerBackup = {
	manifest: {
		format: "watson-export";
		version: number;
		exportedAt: string;
		schemaMigrations: number | null;
		scope: { workspaces: number; userId: string; authority?: string };
		counts: Record<string, number>;
		checksum: string;
		signature: string;
		limitations?: Record<string, string>;
	};
	tables: Record<string, Record<string, unknown>[]>;
};

export type RestoreReport = {
	mode: "dry-run" | "apply";
	checksum: string;
	inserted: Record<string, number>;
	skippedExisting: Record<string, number>;
	totalInserted: number;
	totalSkippedExisting: number;
};

function triggerJsonDownload(value: unknown, filename: string) {
	const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type EncryptedServerBackup = {
	app: "watson";
	kind: "encrypted-server-export";
	version: 1;
	kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
	cipher: { name: "AES-GCM"; iv: string };
	ciphertext: string;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
	const binary = atob(value);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

// WebCrypto's DOM types intentionally reject views backed by SharedArrayBuffer.
// Copying also prevents callers from mutating parameters while an async operation runs.
const cryptoBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
	new Uint8Array(value);

async function backupKey(
	passphrase: string,
	salt: Uint8Array,
	iterations: number,
): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(passphrase),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt: cryptoBytes(salt), iterations },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function encryptServerBackup(
	backup: ServerBackup,
	passphrase: string,
): Promise<EncryptedServerBackup> {
	if (passphrase.length < 12) throw new Error("backup_passphrase_too_short");
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const iterations = 310_000;
	const key = await backupKey(passphrase, salt, iterations);
	const plaintext = new TextEncoder().encode(JSON.stringify(backup));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: cryptoBytes(iv) },
		key,
		cryptoBytes(plaintext),
	);
	return {
		app: "watson",
		kind: "encrypted-server-export",
		version: 1,
		kdf: {
			name: "PBKDF2",
			hash: "SHA-256",
			iterations,
			salt: bytesToBase64(salt),
		},
		cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

export async function decryptServerBackup(
	value: EncryptedServerBackup,
	passphrase: string,
): Promise<unknown> {
	if (!passphrase) throw new Error("restore_passphrase_required");
	if (
		value.version !== 1 ||
		value.kdf?.name !== "PBKDF2" ||
		value.kdf.hash !== "SHA-256" ||
		value.kdf.iterations < 100_000 ||
		value.kdf.iterations > 1_000_000 ||
		value.cipher?.name !== "AES-GCM"
	) {
		throw new Error("unsupported_encrypted_restore");
	}
	try {
		const salt = base64ToBytes(value.kdf.salt);
		const iv = base64ToBytes(value.cipher.iv);
		if (salt.length !== 16 || iv.length !== 12) throw new Error("invalid_encryption_params");
		const key = await backupKey(passphrase, salt, value.kdf.iterations);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: cryptoBytes(iv) },
			key,
			cryptoBytes(base64ToBytes(value.ciphertext)),
		);
		return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
	} catch {
		throw new Error("restore_decryption_failed");
	}
}

/** Autoritativní, podepsaný export ze serveru — jediný formát přijímaný restore endpointem. */
export async function downloadBackup(
	stamp: string,
	passphrase: string,
): Promise<BackupResult> {
	const response = await fetch(`${API_URL}/api/export`, { credentials: "include" });
	if (!response.ok) throw new Error(`export_${response.status}`);
	const backup = (await response.json()) as ServerBackup;
	if (backup.manifest?.format !== "watson-export" || backup.manifest.version !== 2) {
		throw new Error("unsupported_export");
	}
	const safe = stamp.replace(/[:.]/g, "-");
	const filename = `watson-server-export-${safe}.watson.json`;
	triggerJsonDownload(await encryptServerBackup(backup, passphrase), filename);
	return {
		rowCount: Object.values(backup.manifest.counts).reduce((sum, count) => sum + count, 0),
		filename,
	};
}

/** Rychlá klientská kontrola; kryptografii a veškeré ACL vždy znovu ověří server. */
export async function readRestoreFile(
	file: File,
	passphrase: string,
): Promise<ServerBackup> {
	if (file.size > 25 * 1024 * 1024) throw new Error("restore_file_too_large");
	let value: unknown;
	try {
		value = JSON.parse(await file.text());
	} catch {
		throw new Error("invalid_restore_json");
	}
	if (!value || typeof value !== "object") throw new Error("invalid_restore_file");
	const maybeEncrypted = value as Partial<EncryptedServerBackup>;
	if (maybeEncrypted.kind === "encrypted-server-export") {
		value = await decryptServerBackup(maybeEncrypted as EncryptedServerBackup, passphrase);
	}
	const backup = value as Partial<ServerBackup>;
	if (
		backup.manifest?.format !== "watson-export" ||
		backup.manifest.version !== 2 ||
		!backup.tables ||
		typeof backup.tables !== "object"
	) {
		throw new Error("unsupported_restore_file");
	}
	return backup as ServerBackup;
}

export async function restoreBackup(
	backup: ServerBackup,
	mode: "dry-run" | "apply",
	conflictMode: "skip" | "fail",
): Promise<RestoreReport> {
	const response = await fetch(`${API_URL}/api/restore`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ backup, mode, conflictMode }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		report?: RestoreReport;
		code?: string;
		error?: string;
	};
	if (!response.ok || !body.report) {
		throw new Error(body.code ?? body.error ?? `restore_${response.status}`);
	}
	return body.report;
}
