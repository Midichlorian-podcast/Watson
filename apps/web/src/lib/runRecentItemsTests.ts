import { takePrivateJsonWith, writePrivateJsonWith } from "./powersync/privateState";
import { mergeRecentEntities, type RecentEntity } from "./recentItems";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

const rows: RecentEntity[] = [
	{ kind: "task", id: "a", openedAt: "2026-07-15T10:00:00.000Z" },
	{ kind: "project", id: "p", openedAt: "2026-07-15T09:00:00.000Z" },
];

console.log("(a) poslední otevřená položka");
{
	const next = mergeRecentEntities(rows, {
		kind: "meeting",
		id: "m",
		openedAt: "2026-07-15T11:00:00.000Z",
	});
	check("novější položka je první", next[0]?.id === "m", next);
	check("původní pořadí zůstává deterministické", next.map((item) => item.id).join(",") === "m,a,p", next);
}

console.log("(b) opakované otevření stejného objektu");
{
	const next = mergeRecentEntities(rows, {
		kind: "task",
		id: "a",
		openedAt: "2026-07-15T12:00:00.000Z",
	});
	check("objekt se neduplikuje", next.filter((item) => item.id === "a").length === 1, next);
	check("čas i pozice se aktualizují", next[0]?.id === "a" && next[0]?.openedAt.endsWith("12:00:00.000Z"), next);
}

console.log("(c) pevný limit");
{
	const many = Array.from({ length: 25 }, (_, index): RecentEntity => ({
		kind: "task",
		id: String(index),
		openedAt: `2026-07-15T10:${String(index).padStart(2, "0")}:00.000Z`,
	}));
	const next = mergeRecentEntities(
		many,
		{ kind: "project", id: "new", openedAt: "2026-07-15T12:00:00.000Z" },
		20,
	);
	check("uloží se nejvýše dvacet položek", next.length === 20, next.length);
	check("nejnovější položka se neztratí", next[0]?.id === "new", next[0]);
}

console.log("(d) PowerSync view-safe private upsert");
for (const exists of [false, true]) {
	const calls: string[] = [];
	const database = {
		writeTransaction: async (callback: (transaction: unknown) => Promise<void>) =>
			callback({
				getOptional: async () => (exists ? { id: "recent" } : null),
				execute: async (sql: string) => {
					calls.push(sql);
				},
			}),
	};
	await writePrivateJsonWith(
		database as never,
		"recent",
		{ ok: true },
		"2026-07-15T12:00:00.000Z",
	);
	check("nepoužije zakázaný ON CONFLICT nad view", calls.every((sql) => !sql.includes("ON CONFLICT")), calls);
	check(
		exists ? "existující řádek se aktualizuje" : "nový řádek se vloží",
		calls.length === 1 && calls[0]?.startsWith(exists ? "UPDATE" : "INSERT") === true,
		calls,
	);
}

console.log("(e) atomické převzetí jednorázového private state");
{
	let stored: string | null = JSON.stringify({ subject: "Jen jednou" });
	let transactions = 0;
	const database = {
		writeTransaction: async (
			callback: (transaction: {
				getOptional: () => Promise<{ value: string } | null>;
				execute: () => Promise<void>;
			}) => Promise<void>,
		) => {
			transactions += 1;
			await callback({
				getOptional: async () => (stored === null ? null : { value: stored }),
				execute: async () => {
					stored = null;
				},
			});
		},
	};
	const first = await takePrivateJsonWith<{ subject: string } | null>(
		database as never,
		"compose",
		null,
	);
	const second = await takePrivateJsonWith<{ subject: string } | null>(
		database as never,
		"compose",
		null,
	);
	check("první okno návrh převezme", first?.subject === "Jen jednou", first);
	check("druhé okno už dostane prázdný stav", second === null, second);
	check("každé převzetí proběhne uvnitř DB transakce", transactions === 2, transactions);
}

if (failed) {
	console.error(`\nRecent items testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nRecent items testy: vše prošlo");
