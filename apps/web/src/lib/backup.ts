/**
 * Lokální EXPORT dat nasyncovaných v PowerSync SQLite jako jeden JSON soubor.
 * Funguje offline, bez serveru i bez Googlu.
 *
 * P1-12 — tohle NENÍ záloha a UI to tak nesmí prezentovat: chybí import/restore,
 * manifest schématu, checksum i data, která lokální DB nedrží (task_activity,
 * audit_events, mail). Skutečná versioned záloha s ověřeným restore = F3 (CC-P0-14).
 */
import { powerSync } from "./powersync/db";

/** Tabulky zahrnuté do zálohy (dle AppSchema; task_activity je insert-only, lokálně není). */
const BACKUP_TABLES = [
	"tasks",
	"projects",
	"sections",
	"statuses",
	"project_members",
	"assignments",
	"comments",
	"task_occurrence_overrides",
	"task_user_colors",
	"reminders",
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
export async function downloadBackup(stamp: string): Promise<BackupResult> {
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
