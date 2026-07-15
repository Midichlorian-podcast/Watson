import assert from "node:assert/strict";
import { normalizeSearchText, parseSearchQuery, rankSearchCandidates } from "./universalSearch";

assert.equal(normalizeSearchText("  Příliš Žluťoučký  "), "prilis zlutoucky");
const parsed = parseSearchQuery('type:úkol in:"Kancelář Praha" status:open before:2026-08-01 "roční report"');
assert.deepEqual(parsed.types, ["task"]);
assert.deepEqual(parsed.workspaces, ["kancelar praha"]);
assert.deepEqual(parsed.statuses, ["open"]);
assert.equal(parsed.before, "2026-08-01");
assert.deepEqual(parsed.terms, ["rocni report"]);

const candidates = [
	{
		id: "exact",
		kind: "task" as const,
		title: "Roční report",
		fields: ["Finance"],
		workspace: "Kancelář Praha",
		status: "open",
		date: "2026-07-20",
		value: "exact",
	},
	{
		id: "body",
		kind: "task" as const,
		title: "Uzavřít rok",
		fields: ["Připravit roční report"],
		workspace: "Kancelář Praha",
		status: "open",
		date: "2026-07-20",
		value: "body",
	},
	{
		id: "wrong-tenant",
		kind: "task" as const,
		title: "Roční report",
		workspace: "Obchod",
		status: "open",
		date: "2026-07-20",
		value: "wrong-tenant",
	},
	{
		id: "wrong-kind",
		kind: "mail" as const,
		title: "Roční report",
		workspace: "Kancelář Praha",
		status: "open",
		date: "2026-07-20",
		value: "wrong-kind",
	},
];
assert.deepEqual(
	rankSearchCandidates(candidates, parsed).map((result) => result.value),
	["exact", "body"],
);
assert.deepEqual(
	rankSearchCandidates(candidates, parseSearchQuery("report"), "mail").map((result) => result.value),
	["wrong-kind"],
);
assert.equal(parseSearchQuery("unknown:value").terms[0], "unknown:value");
assert.equal(parseSearchQuery("before:not-a-date").before, null);

console.log("universalSearch: operators, diacritics, scope and relevance passed");
