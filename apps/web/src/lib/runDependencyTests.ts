import { dependencyCompletionDecision } from "./dependencies";

function check(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

const clear = { policy: "strict" as const, blockers: [] };
const warning = { policy: "warning" as const, blockers: [{ id: "a", name: "A" }] };
const strict = { policy: "strict" as const, blockers: [{ id: "a", name: "A" }] };

check(dependencyCompletionDecision(clear, undefined, 20_000) === "allow", "clear task must pass");
check(
	dependencyCompletionDecision(warning, undefined, 20_000) === "warn",
	"warning policy must require acknowledgement",
);
check(
	dependencyCompletionDecision(warning, 15_000, 20_000) === "allow",
	"second action inside the acknowledgement window must pass",
);
check(
	dependencyCompletionDecision(warning, 9_000, 20_000) === "warn",
	"expired acknowledgement must warn again",
);
check(
	dependencyCompletionDecision(strict, 19_000, 20_000) === "deny",
	"strict policy must never be bypassed by a repeated click",
);

console.log("dependencies: warning acknowledgement and strict completion policy passed");
