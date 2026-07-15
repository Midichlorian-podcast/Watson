/**
 * Regresní testy CC-P0-02: Quick Add insert řádek.
 * Hlídá invarianty, jejichž porušení dřív vedlo k tiché ztrátě úkolu:
 * - `recurrence_basis` nesmí být NULL (PostgreSQL NOT NULL; NULL → server 400 → op zahozena),
 * - `days` z parseru se musí uložit,
 * - start_date se skládá z termínu + času.
 * Spuštění: pnpm --filter @watson/web test (tsx src/lib/quickadd/runInsertTests.ts)
 */
import { buildQuickAddTaskRow, quickAddInsertSql } from "./insert";
import { parseQuick } from "./index";
import type { ParseCtx } from "./types";

const ctx: ParseCtx = { today: "2026-07-14", projects: [], people: [] };
let failed = 0;

function check(label: string, cond: boolean, detail?: unknown) {
	if (cond) {
		console.log(`  ✓ ${label}`);
	} else {
		failed++;
		console.error(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
	}
}

function rowFor(input: string, mode: "single" | "shared_all" = "single") {
	const parsed = parseQuick(input, ctx);
	const row = buildQuickAddTaskRow({
		parsed,
		taskId: "task-1",
		projectId: "proj-1",
		name: parsed.name.trim(),
		assignmentMode: mode,
		userId: "user-1",
		today: ctx.today,
		now: "2026-07-14T10:00:00.000Z",
		timeZone: "Europe/Prague",
	});
	const get = (col: string) => row.values[row.columns.indexOf(col)];
	return { parsed, row, get };
}

// (a) Běžný (neopakovaný) úkol — dřívější chyba: recurrence_basis=null → server 400.
{
	console.log("(a) běžný úkol");
	const { get } = rowFor("Zavolat klientovi zítra");
	check("recurrence_basis = 'due_date' (nikdy NULL)", get("recurrence_basis") === "due_date", {
		basis: get("recurrence_basis"),
	});
	check("due_date = 2026-07-15", get("due_date") === "2026-07-15", { due: get("due_date") });
	check("recurrence prázdné", get("recurrence") === null && get("recurrence_rule") === null);
	check("days = NULL (jednodenní)", get("days") === null);
}

// (b) Opakovaný úkol.
{
	console.log("(b) opakovaný úkol");
	const { get, parsed } = rowFor("Zalévat květiny denně");
	check("parser rozpoznal opakování", parsed.recurrence?.kind === "daily", parsed.recurrence);
	check("recurrence_basis = 'due_date'", get("recurrence_basis") === "due_date");
	check(
		"recurrence_rule = JSON pravidla",
		typeof get("recurrence_rule") === "string" &&
			JSON.parse(get("recurrence_rule") as string).kind === "daily",
	);
}

// (c) Vícedenní úkol — dřívější chyba: sloupec days se vůbec neposílal.
{
	console.log("(c) vícedenní úkol");
	const { get, parsed } = rowFor("Konference zítra 3 dny");
	check("parser rozpoznal days=3", parsed.days === 3, { days: parsed.days });
	check("days = 3 v řádku", get("days") === 3, { days: get("days") });
	check("recurrence_basis = 'due_date'", get("recurrence_basis") === "due_date");
}

// (d) Sdílené přiřazení — režim projde beze změny do řádku.
{
	console.log("(d) režim přiřazení");
	const { get } = rowFor("Porada zítra", "shared_all");
	check("assignment_mode = shared_all", get("assignment_mode") === "shared_all");
}

// (e) Čas dne → start_date z termínu + času.
{
	console.log("(e) čas dne");
	const { get } = rowFor("Schůzka zítra v 9:30");
	check(
		"start_date je skutečný UTC instant",
		get("start_date") === "2026-07-15T07:30:00.000Z",
		{ start: get("start_date") },
	);
	check("start_timezone = Europe/Prague", get("start_timezone") === "Europe/Prague");
}

// (f) SQL tvar: počet placeholderů = počet hodnot, sloupce obsahují povinné NOT NULL.
{
	console.log("(f) SQL tvar");
	const { row } = rowFor("Úkol bez atributů");
	const sql = quickAddInsertSql(row);
	const placeholders = (sql.match(/\?/g) ?? []).length;
	check("placeholdery = hodnoty", placeholders === row.values.length, {
		placeholders,
		values: row.values.length,
	});
	for (const col of ["recurrence_basis", "days", "assignment_mode", "start_timezone"]) {
		check(`sloupec ${col} přítomen`, row.columns.includes(col));
	}
}

if (failed > 0) {
	console.error(`\nQuick Add insert testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nQuick Add insert testy: vše prošlo");
