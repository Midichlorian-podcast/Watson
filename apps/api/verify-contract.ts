/**
 * Contract test (F1, CC-P0-18): PostgreSQL ↔ write registry ↔ PowerSync sync rules.
 * Hlídá drift, který dřív způsoboval tichou ztrátu dat (třída CC-P0-02):
 *
 *  1. každý sloupec write registru (TABLES) existuje v PG a typ zhruba sedí,
 *  2. žádný PG NOT NULL sloupec BEZ defaultu v zapisovatelné tabulce nechybí
 *     v registru (klient by insert nikdy nesložil → 400 → zahozená operace),
 *  3. každý sloupec v sync-config.yaml SELECTech existuje v PG (jinak PowerSync
 *     službu config položí nebo sloupec dorazí null).
 *
 * Vyžaduje běžící PostgreSQL. Spuštění: pnpm --filter @watson/api verify:contract
 */
import "./src/env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb, sql } from "@watson/db";
import { TABLES } from "./src/powersync";

type PgCol = {
	table_name: string;
	column_name: string;
	data_type: string;
	is_nullable: string;
	column_default: string | null;
};

const db = getDb();
let failed = 0;
const fail = (msg: string) => {
	failed++;
	console.error(`  ✗ ${msg}`);
};

/** Kompatibilita typu registru s PG typem (záměrně volná — jde o hrubý drift). */
const typeOk = (reg: string, pg: string): boolean => {
	if (reg === "int") return ["integer", "bigint", "smallint", "numeric"].includes(pg);
	if (reg === "bool") return pg === "boolean";
	if (reg === "json") return pg === "jsonb" || pg === "json";
	if (reg === "ts")
		return ["timestamp with time zone", "timestamp without time zone", "date"].includes(pg);
	// text: uuid, varchar, text, enumy (USER-DEFINED) i jsonb se posílají jako string
	return ["text", "character varying", "uuid", "USER-DEFINED", "jsonb", "json"].includes(pg);
};

async function main() {
	const cols = (await db.execute(sql`
		SELECT table_name, column_name, data_type, is_nullable, column_default
		FROM information_schema.columns WHERE table_schema = 'public'
	`)) as PgCol[];
	const byTable = new Map<string, Map<string, PgCol>>();
	for (const c of cols) {
		if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
		byTable.get(c.table_name)?.set(c.column_name, c);
	}

	// ── 1+2: write registry ↔ PG ──
	console.log(`Write registry: ${Object.keys(TABLES).length} tabulek`);
	for (const [table, def] of Object.entries(TABLES)) {
		const pgCols = byTable.get(table);
		if (!pgCols) {
			fail(`registr: tabulka ${table} v PG neexistuje`);
			continue;
		}
		for (const [col, regType] of Object.entries(def.columns)) {
			const pg = pgCols.get(col);
			if (!pg) {
				fail(`registr: ${table}.${col} v PG neexistuje`);
				continue;
			}
			if (!typeOk(regType, pg.data_type))
				fail(`registr: ${table}.${col} typ '${regType}' nesedí na PG '${pg.data_type}'`);
		}
		// NOT NULL bez defaultu, které klient přes registr nemůže poslat → insert nikdy
		// neprojde. patchOnly tabulky se přes sync nevytvářejí (create = API command).
		if (!def.patchOnly) {
			const AUTO = new Set([
				"id",
				"created_at",
				"updated_at",
				def.creatorCol ?? "",
				def.ownerCol ?? "",
			]);
			for (const [col, pg] of pgCols) {
				if (AUTO.has(col) || col in def.columns) continue;
				if (pg.is_nullable === "NO" && pg.column_default == null)
					fail(
						`registr: ${table}.${col} je NOT NULL bez defaultu, ale registr ho nezná — PUT nikdy neprojde`,
					);
			}
		}
	}
	if (failed === 0) console.log("  ✓ registr ↔ PG bez driftu");

	// ── 3: sync-config.yaml ↔ PG ──
	const yamlPath = fileURLToPath(new URL("../../powersync/sync-config.yaml", import.meta.url));
	const yaml = readFileSync(yamlPath, "utf8").replace(/\n\s+/g, " ");
	const selects = [...yaml.matchAll(/SELECT (.+?) FROM (\w+)/gi)];
	console.log(`Sync rules: ${selects.length} SELECTů`);
	let syncFails = 0;
	for (const m of selects) {
		const table = m[2] as string;
		const pgCols = byTable.get(table);
		if (!pgCols) {
			fail(`sync-config: tabulka ${table} v PG neexistuje`);
			syncFails++;
			continue;
		}
		for (const raw of (m[1] as string).split(",")) {
			// alias „x AS y" → zdrojový sloupec x; výrazy s funkcemi/parametry přeskoč
			const token = raw.trim().split(/\s+AS\s+/i)[0]?.trim() ?? "";
			if (!/^[a-z_][a-z0-9_]*$/i.test(token) || token === "") continue;
			if (!pgCols.has(token)) {
				fail(`sync-config: ${table}.${token} v PG neexistuje`);
				syncFails++;
			}
		}
	}
	if (syncFails === 0) console.log("  ✓ sync rules ↔ PG bez driftu");

	if (failed) {
		console.error(`\nContract test: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nContract test: vše prošlo");
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
