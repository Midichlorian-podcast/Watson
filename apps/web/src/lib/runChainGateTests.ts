/**
 * Regresní testy P1-01: gate='manual' se NIKDY neaktivuje automaticky.
 * Testuje čistou funkci computeChainStates (repair/konvergence postupů);
 * advance cesta používá stejné pravidlo (guard v taskToggled).
 * Spuštění: pnpm --filter @watson/web test
 */
import { computeChainStates } from "./chainAdvance";

type Step = {
	id: string;
	chain_id: string | null;
	task_id: string | null;
	position: number;
	gate: string | null;
	step_state: string;
	completed: number;
};

const step = (id: string, pos: number, gate: string | null, state: string, done = 0): Step => ({
	id,
	chain_id: "ch",
	task_id: `t-${id}`,
	position: pos,
	gate,
	step_state: state,
	completed: done,
});

let failed = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

// 1) auto brána: po hotovém kroku se další aktivuje
{
	const d = computeChainStates([
		step("a", 0, null, "done", 1),
		step("b", 1, "after_previous", "dormant"),
	]);
	check("auto brána se aktivuje", d.get("b") === "active", d.get("b"));
}

// 2) MANUAL brána: po hotovém kroku zůstává dormant (jádro P1-01)
{
	const d = computeChainStates([
		step("a", 0, null, "done", 1),
		step("b", 1, "manual", "dormant"),
	]);
	check("manual brána zůstává dormant", d.get("b") === "dormant", d.get("b"));
}

// 3) ručně UŽ aktivovaný manual krok repair nezhasne
{
	const d = computeChainStates([
		step("a", 0, null, "done", 1),
		step("b", 1, "manual", "active"),
	]);
	check("aktivovaný manual krok zůstává active", d.get("b") === "active", d.get("b"));
}

// 4) with_previous za manual krokem se bez aktivace neveze
{
	const d = computeChainStates([
		step("a", 0, null, "done", 1),
		step("b", 1, "manual", "dormant"),
		step("c", 2, "with_previous", "dormant"),
	]);
	check("with_previous za dormant manual nejede", d.get("c") === "dormant", d.get("c"));
}

// 5) with_previous za AKTIVNÍM manual krokem jede
{
	const d = computeChainStates([
		step("a", 0, null, "done", 1),
		step("b", 1, "manual", "active"),
		step("c", 2, "with_previous", "dormant"),
	]);
	check("with_previous za aktivním manual jede", d.get("c") === "active", d.get("c"));
}

// 6) drift: dva aktivní kroky → konverguje na jeden (první neuzavřený)
{
	const d = computeChainStates([
		step("a", 0, null, "active"),
		step("b", 1, "after_previous", "active"),
	]);
	check("dva aktivní → první active, druhý dormant", d.get("a") === "active" && d.get("b") === "dormant", [
		d.get("a"),
		d.get("b"),
	]);
}

if (failed) {
	console.error(`\nChain gate testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nChain gate testy: vše prošlo");
