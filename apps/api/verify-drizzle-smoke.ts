/**
 * Jednorázová regrese upgradu drizzle-orm 0.38 → 0.45.2 (GHSA-gpj5-g38j-94v9).
 * Zrcadlí PŘESNĚ vzory generického write path (apps/api/src/powersync.ts applyWrite):
 * sql.raw identifikátory, sql.join, INSERT … ON CONFLICT DO UPDATE SET col=EXCLUDED.col,
 * PATCH UPDATE a DELETE — na TEMP tabulce, takže na reálná data nesahá.
 */
import "./src/env";
import { getDb, sql } from "@watson/db";
import { sqlstateOf } from "./src/powersync";

type Rows = Record<string, unknown>[];

async function main() {
	const db = getDb();
	await db.execute(sql`
    CREATE TEMP TABLE smoke_tasks (id text PRIMARY KEY, name text, priority int, updated_at timestamptz)
  `);

	const table = "smoke_tasks";
	const put = async (id: string, data: Record<string, unknown>) => {
		const set = Object.entries(data).map(([col, val]) => ({ col, val }));
		const cols = ["id", ...set.map((s) => s.col)];
		const vals = [sql`${id}`, ...set.map((s) => sql`${s.val}`)];
		const updates = set.map((s) => sql`${sql.raw(s.col)} = EXCLUDED.${sql.raw(s.col)}`);
		updates.push(sql`updated_at = now()`);
		await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (${sql.join(
				cols.map((c) => sql.raw(c)),
				sql`, `,
			)})
      VALUES (${sql.join(vals, sql`, `)})
      ON CONFLICT (id) DO UPDATE SET ${sql.join(updates, sql`, `)}
    `);
	};

	let failed = 0;
	const check = (label: string, cond: boolean, detail?: unknown) => {
		if (cond) console.log(`  ✓ ${label}`);
		else {
			failed++;
			console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
		}
	};

	// INSERT přes upsert vzor
	await put("a1", { name: "první", priority: 2 });
	// konfliktní PUT = update stejného řádku (vzor applyWrite)
	await put("a1", { name: "přepsané", priority: 3 });
	const r1 = (await db.execute(
		sql`SELECT name, priority FROM ${sql.raw(table)} WHERE id = ${"a1"}`,
	)) as Rows;
	check("ON CONFLICT upsert", r1[0]?.name === "přepsané" && Number(r1[0]?.priority) === 3, r1);

	// PATCH vzor: jen dodané sloupce, sql.join updates
	const patchSet = [{ col: "name", val: "patchnuté" }];
	const updates = patchSet.map((s) => sql`${sql.raw(s.col)} = ${s.val}`);
	await db.execute(sql`UPDATE ${sql.raw(table)} SET ${sql.join(updates, sql`, `)} WHERE id = ${"a1"}`);
	const r2 = (await db.execute(sql`SELECT name, priority FROM smoke_tasks WHERE id = 'a1'`)) as Rows;
	check("PATCH update", r2[0]?.name === "patchnuté" && Number(r2[0]?.priority) === 3, r2);

	// hodnoty s SQL metaznaky musí zůstat parametrizované (ne interpolované)
	const evil = `x'; DROP TABLE smoke_tasks; --`;
	await put("a2", { name: evil, priority: 1 });
	const r3 = (await db.execute(sql`SELECT name FROM smoke_tasks WHERE id = 'a2'`)) as Rows;
	check("parametrizace hodnot", r3[0]?.name === evil, r3);

	// DELETE vzor
	await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE id = ${"a1"}`);
	const r4 = (await db.execute(sql`SELECT count(*)::int AS n FROM smoke_tasks`)) as Rows;
	check("DELETE", Number(r4[0]?.n) === 1, r4);

	// SQLSTATE musí být čitelný i ze zabalené chyby — drizzle ≥0.45 vrací
	// DrizzleQueryError s driver kódem až v `cause.code` (bez toho 400↔500 rozbité).
	try {
		await db.execute(sql`SELECT uuid_in('nevalidni'::cstring)`);
		check("SQLSTATE z chyby", false, "dotaz nečekaně prošel");
	} catch (err) {
		check("SQLSTATE z chyby (cause řetěz)", sqlstateOf(err) === "22P02", sqlstateOf(err));
	}

	if (failed) {
		console.error(`\nDrizzle smoke: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nDrizzle smoke: vše prošlo (0.45.2 zachovává chování write path)");
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
