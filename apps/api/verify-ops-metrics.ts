import { createOpsCounters, isOpsTokenAuthorized } from "./src/opsMetrics";
import { providerFailureStatus } from "./src/providerErrors";

let failed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`✓ ${label}`);
	else {
		failed++;
		console.error(`✗ ${label}: ${JSON.stringify(detail)}`);
	}
}

const metrics = createOpsCounters("2026-01-01T00:00:00.000Z");
metrics.record("/health/ready", 503);
metrics.record("/api/tasks", 200);
metrics.record("/api/tasks", 500);
metrics.record("/api/auth/sign-in/email", 401);
metrics.record("/api/sync/write", 422);
metrics.record("/api/sync/write", 401);
metrics.record("/api/employee/status", 504);
const snapshot = metrics.snapshot();

check("health endpointy nekřiví API SLO", snapshot.apiRequestsTotal === 6, snapshot);
check("5xx se počítají napříč API", snapshot.http5xxTotal === 2, snapshot);
check("auth failure má samostatný čítač", snapshot.authFailureTotal === 1, snapshot);
check("jen trvalé sync odmítnutí se počítá jako rejection", snapshot.syncRejectionTotal === 1, snapshot);
check("504 se eviduje jako provider timeout", snapshot.providerTimeoutTotal === 1, snapshot);

const token = "ops-token-that-is-longer-than-thirty-two-bytes";
check("správný bearer token projde", isOpsTokenAuthorized(`Bearer ${token}`, token));
check("špatný bearer token neprojde", !isOpsTokenAuthorized("Bearer wrong", token));
check("krátký serverový token je fail-closed", !isOpsTokenAuthorized("Bearer short", "short"));
check(
	"extrémně dlouhá hlavička je odmítnuta před porovnáním",
	!isOpsTokenAuthorized(`Bearer ${"x".repeat(513)}`, token),
);
check(
	"provider timeout se vrací jako 504",
	providerFailureStatus(new Error("request timed out")) === 504,
);
check(
	"běžné provider selhání zůstává 502",
	providerFailureStatus(new Error("connection reset")) === 502,
);

if (failed) process.exit(1);
console.log("Ops metrics verification passed.");
