/**
 * Corpus runner (tsx, zero-dependency). Spustí parser proti všem __corpus__/*.json
 * a subset-asseruje očekávaná pole. Spuštění:  pnpm tsx apps/web/src/lib/quickadd/runCorpus.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseQuick } from "./parse";
import type { ParseCtx } from "./types";

const CTX: ParseCtx = {
  today: "2026-06-25", // čtvrtek
  projects: [
    { id: "obchod", name: "Obchod" },
    { id: "q3", name: "Q3 plánování" },
    { id: "web", name: "Web redesign" },
  ],
  people: [
    { id: "pn", name: "Petra Nováková", initials: "PN" },
    { id: "tm", name: "Tomáš Marek", initials: "TM" },
    { id: "jd", name: "Jana Dvořáková", initials: "JD" },
  ],
};

type Case = { input: string; expected: Record<string, unknown>; why?: string; ctx?: ParseCtx };

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null; // null ≈ undefined (oba „nenastaveno")
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "__corpus__");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

let total = 0;
let pass = 0;
const failures: string[] = [];

for (const f of files) {
  let cases: Case[];
  try {
    cases = JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch (e) {
    console.error(`⚠ JSON parse error ${f}: ${String(e)}`);
    continue;
  }
  let fp = 0;
  for (const c of cases) {
    total++;
    const out = parseQuick(c.input, c.ctx ?? CTX) as unknown as Record<string, unknown>;
    const diffs: string[] = [];
    for (const k of Object.keys(c.expected)) {
      if (!deepEq(out[k], c.expected[k])) {
        diffs.push(`    ${k}: exp ${JSON.stringify(c.expected[k])}  ·  got ${JSON.stringify(out[k])}`);
      }
    }
    if (diffs.length === 0) {
      pass++;
      fp++;
    } else {
      failures.push(`[${f}] "${c.input}"\n${diffs.join("\n")}${c.why ? `\n    (why: ${c.why})` : ""}`);
    }
  }
  console.log(`${fp === cases.length ? "✓" : "✗"} ${f}: ${fp}/${cases.length}`);
}

console.log(`\nCELKEM: ${pass}/${total}`);
if (failures.length) {
  console.log(`\n=== SELHÁNÍ (${failures.length}) ===\n${failures.slice(0, 80).join("\n\n")}`);
  process.exit(1);
}
