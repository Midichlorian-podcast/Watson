/**
 * Occurrence-engine test (tsx, zero-dependency). Ověřuje R4 projekci výskytů —
 * hlavně strukturovaná pravidla monthly-nth / monthly-day / parity, která dřív engine
 * ignoroval (files/logika/02 §3.1 → §3.2). Spuštění:
 *   pnpm --filter @watson/web test        (nebo: pnpm exec tsx src/lib/runOccurrences.ts)
 *
 * Dny v týdnu = getUTCDay (0=Ne … 6=So). Referenční kalendář 2026:
 *   2026-07-01 = středa(3), 2026-07-06 = pondělí(1), 2026-07-07 = úterý(2),
 *   2026-06-29 = pondělí(1) a je to 5. pondělí června.
 */
import { type ExpandOpts, expandOccurrences } from "./occurrences";

type Case = {
	name: string;
	opts: ExpandOpts;
	expected: string[];
};

const W = (from: string, to: string) => ({ fromISO: from, toISO: to });

const cases: Case[] = [
	{
		name: "daily · count=3 (limit od base)",
		opts: {
			baseISO: "2026-07-01",
			kind: "daily",
			count: 3,
			...W("2026-07-01", "2026-07-31"),
		},
		expected: ["2026-07-01", "2026-07-02", "2026-07-03"],
	},
	{
		name: "daily · until (včetně data)",
		opts: {
			baseISO: "2026-07-01",
			kind: "daily",
			until: "2026-07-04",
			...W("2026-07-01", "2026-07-31"),
		},
		expected: ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"],
	},
	{
		name: "daily · showAll=false → jen příští v okně",
		opts: {
			baseISO: "2026-07-01",
			kind: "daily",
			showAll: false,
			...W("2026-07-10", "2026-07-31"),
		},
		expected: ["2026-07-10"],
	},
	{
		name: "weekly · base už na pondělí",
		opts: {
			baseISO: "2026-07-06",
			kind: "weekly",
			weekday: 1,
			...W("2026-07-06", "2026-07-27"),
		},
		expected: ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"],
	},
	{
		name: "weekly · snap když base leží mimo cílový den (st→po)",
		opts: {
			baseISO: "2026-07-01",
			kind: "weekly",
			weekday: 1,
			...W("2026-07-01", "2026-07-21"),
		},
		expected: ["2026-07-06", "2026-07-13", "2026-07-20"],
	},
	{
		name: "biweekly · +14 na cílový den",
		opts: {
			baseISO: "2026-07-02",
			kind: "biweekly",
			weekday: 4,
			...W("2026-07-02", "2026-08-15"),
		},
		expected: ["2026-07-02", "2026-07-16", "2026-07-30", "2026-08-13"],
	},
	{
		name: "monthly-nth · 1. úterý v měsíci (dřív driftovalo)",
		opts: {
			baseISO: "2026-07-07",
			kind: "monthly-nth",
			nth: 1,
			weekday: 2,
			...W("2026-07-01", "2026-09-30"),
		},
		expected: ["2026-07-07", "2026-08-04", "2026-09-01"],
	},
	{
		name: "monthly-nth · poslední pátek (nth=-1)",
		opts: {
			baseISO: "2026-07-31",
			kind: "monthly-nth",
			nth: -1,
			weekday: 5,
			...W("2026-07-01", "2026-09-30"),
		},
		expected: ["2026-07-31", "2026-08-28", "2026-09-25"],
	},
	{
		name: "monthly-nth · 5. pondělí (přeskočí měsíce bez něj)",
		opts: {
			baseISO: "2026-06-29",
			kind: "monthly-nth",
			nth: 5,
			weekday: 1,
			...W("2026-06-01", "2026-12-31"),
		},
		expected: ["2026-06-29", "2026-08-31", "2026-11-30"],
	},
	{
		name: "monthly-day · 25. každý měsíc",
		opts: {
			baseISO: "2026-07-25",
			kind: "monthly-day",
			day: 25,
			...W("2026-07-01", "2026-10-31"),
		},
		expected: ["2026-07-25", "2026-08-25", "2026-09-25", "2026-10-25"],
	},
	{
		name: "monthly-day · 31. (přeskočí měsíce bez 31.)",
		opts: {
			baseISO: "2026-07-31",
			kind: "monthly-day",
			day: 31,
			...W("2026-07-01", "2026-12-31"),
		},
		expected: ["2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31"],
	},
	{
		name: "monthly (holé) · 31. přetéká (prototyp: JS setMonth)",
		opts: {
			baseISO: "2026-01-31",
			kind: "monthly",
			...W("2026-01-01", "2026-04-30"),
		},
		expected: ["2026-01-31", "2026-03-03", "2026-03-31"],
	},
	{
		name: "yearly · stejný den v roce",
		opts: {
			baseISO: "2026-03-15",
			kind: "yearly",
			...W("2026-01-01", "2028-12-31"),
		},
		expected: ["2026-03-15", "2027-03-15", "2028-03-15"],
	},
	{
		name: "první výskyt == base (kontrakt callerů: od===base filtr)",
		opts: {
			baseISO: "2026-07-07",
			kind: "monthly-nth",
			nth: 1,
			weekday: 2,
			...W("2026-07-07", "2026-07-31"),
		},
		expected: ["2026-07-07"],
	},
];

const eqArr = (a: string[], b: string[]) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

let pass = 0;
const failures: string[] = [];
for (const c of cases) {
	const got = expandOccurrences(c.opts);
	if (eqArr(got, c.expected)) {
		pass++;
		console.log(`✓ ${c.name}`);
	} else {
		console.log(`✗ ${c.name}`);
		failures.push(
			`[${c.name}]\n    exp ${JSON.stringify(c.expected)}\n    got ${JSON.stringify(got)}`,
		);
	}
}

console.log(`\nCELKEM: ${pass}/${cases.length}`);
if (failures.length) {
	console.log(
		`\n=== SELHÁNÍ (${failures.length}) ===\n${failures.join("\n\n")}`,
	);
	process.exit(1);
}
