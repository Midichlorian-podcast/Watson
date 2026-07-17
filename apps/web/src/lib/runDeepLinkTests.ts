import assert from "node:assert/strict";
import { deepLinkHref } from "./deepLink";

const origin = "https://watson.example";
const cases = [
	["task", "/ukoly?ukol=id-1"],
	["project", "/projekty?projekt=id-1"],
	["list", "/seznamy?seznam=id-1"],
	["flow", "/postupy?postup=id-1"],
	["meeting", "/meets?meet=id-1"],
	["decision", "/meets?decision=id-1"],
	["goal", "/cile?cil=id-1"],
	["mail", "/mail?vlakno=id-1"],
	["person", "/reporty?tab=lide&clen=id-1"],
] as const;

for (const [entity, expected] of cases) {
	assert.equal(deepLinkHref(entity, "id-1", origin), `${origin}${expected}`);
}
assert.equal(
	deepLinkHref("task", "id s mezerou&?", origin),
	`${origin}/ukoly?ukol=id+s+mezerou%26%3F`,
);
assert.equal(
	deepLinkHref("person", "person-1", origin, "workspace-1"),
	`${origin}/reporty?tab=lide&prostor=workspace-1&clen=person-1`,
);

console.log("deepLink: canonical object links passed");
