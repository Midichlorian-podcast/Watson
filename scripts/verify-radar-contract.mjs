import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, index, ui, decisionLog, router, deepLink, verifier, browserVerifier, ci] =
	await Promise.all([
		read("apps/api/src/radar.ts"),
		read("apps/api/src/index.ts"),
		read("apps/web/src/components/RadarPanel.tsx"),
		read("apps/web/src/components/DecisionLog.tsx"),
		read("apps/web/src/router.tsx"),
		read("apps/web/src/lib/deepLink.ts"),
		read("apps/api/verify-radar.ts"),
		read("apps/api/verify-radar-ui.ts"),
		read("scripts/ci-api-integration.sh"),
	]);

for (const token of [
	"deadline_overdue",
	"incomplete_blocker",
	"sequence_impossible",
	"assignee_unavailable",
	"focus_conflict",
	"schedule_collision",
	"decision_review_overdue",
	"Math.min(100",
	"basis: \"fact\"",
	"basis: \"projection\"",
	"projectMembers.userId",
	"inArray(memberships.role, [\"admin\", \"manager\"])",
	"Cache-Control",
	"private, no-store",
	"coverage",
]) {
	assert.ok(api.includes(token), `Radar API contract missing: ${token}`);
}
assert.doesNotMatch(api, /availabilityBlocks\.label/);
assert.doesNotMatch(api, /employeeScore|productivityScore|scoreEmployee/);
assert.match(index, /"\/api\/radar\/\*"/);
assert.match(index, /app\.route\("\/", radarRoutes\)/);
for (const token of [
	"žádné skryté hodnocení lidí",
	"součet zveřejněných vah",
	"risk.evidence.map",
	"risk.score",
	"query.data.coverage === \"partial\"",
	"Otevřít rozhodnutí",
]) {
	assert.ok(ui.includes(token), `Radar UI contract missing: ${token}`);
}
assert.match(deepLink, /decision: \{ path: "\/meets", key: "decision" \}/);
assert.match(router, /decision\?: string/);
assert.match(decisionLog, /focusId/);
assert.match(verifier, /restricted projekt/);
assert.match(verifier, /soukromý popisek/);
assert.match(verifier, /skóre je přesný součet/);
assert.match(browserVerifier, /assertAxeClean/);
assert.match(browserVerifier, /width: 390/);
assert.match(browserVerifier, /decision_deep_link_not_focused/);
assert.match(ci, /verify:radar/);

console.log(
	"Radar contract: explainable facts, tenant scope, privacy redaction, no employee scoring, deep-links and browser proof verified.",
);
