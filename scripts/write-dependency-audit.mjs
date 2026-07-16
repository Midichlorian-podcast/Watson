import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const artifactPath = resolve(
	process.env.WATSON_DEPENDENCY_AUDIT_ARTIFACT ?? "artifacts/dependency-audit.json",
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["audit", "--prod", "--audit-level", "high", "--json"], {
	encoding: "utf8",
	maxBuffer: 10 * 1024 * 1024,
});

let raw;
try {
	raw = JSON.parse(result.stdout || "{}");
} catch {
	raw = null;
}

const vulnerabilities = raw?.metadata?.vulnerabilities ?? {};
const counts = {
	info: Number(vulnerabilities.info ?? 0),
	low: Number(vulnerabilities.low ?? 0),
	moderate: Number(vulnerabilities.moderate ?? 0),
	high: Number(vulnerabilities.high ?? 0),
	critical: Number(vulnerabilities.critical ?? 0),
};
const advisories = Object.entries(raw?.advisories ?? {}).map(([id, advisory]) => ({
	id,
	module: advisory.module_name ?? advisory.moduleName ?? "unknown",
	severity: advisory.severity ?? "unknown",
	title: advisory.title ?? "Untitled advisory",
	patchedVersions: advisory.patched_versions ?? advisory.patchedVersions ?? null,
}));
const lockfileHash = createHash("sha256")
	.update(await readFile(resolve("pnpm-lock.yaml")))
	.digest("hex");
const thresholdBreaches = counts.high + counts.critical;
const commandCompleted = result.status !== null && raw !== null;
const passed = commandCompleted && result.status === 0 && thresholdBreaches === 0;
const report = {
	createdAt: new Date().toISOString(),
	status: passed ? "passed" : "failed",
	tool: "pnpm audit",
	scope: "production",
	threshold: "high",
	lockfileSha256: lockfileHash,
	packageManager: process.env.npm_config_user_agent?.split(" ")[0] ?? "pnpm",
	vulnerabilities: counts,
	dependencies: {
		production: Number(raw?.metadata?.dependencies ?? 0),
		optional: Number(raw?.metadata?.optionalDependencies ?? 0),
		total: Number(raw?.metadata?.totalDependencies ?? 0),
	},
	advisories,
	commandExitCode: result.status,
	error: commandCompleted ? null : "audit_unavailable_or_invalid_response",
};

await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(
	`Dependency audit: ${report.status}; high=${counts.high}, critical=${counts.critical}; artifact=${artifactPath}`,
);

if (!passed) {
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = 1;
}
