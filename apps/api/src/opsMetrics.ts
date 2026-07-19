import { createHash, timingSafeEqual } from "node:crypto";
import { getDb, sql } from "@watson/db";

export type OpsCountersSnapshot = {
	processStartedAt: string;
	apiRequestsTotal: number;
	http5xxTotal: number;
	authFailureTotal: number;
	syncRejectionTotal: number;
	providerTimeoutTotal: number;
};

export function createOpsCounters(processStartedAt = new Date().toISOString()) {
	const counters = {
		apiRequestsTotal: 0,
		http5xxTotal: 0,
		authFailureTotal: 0,
		syncRejectionTotal: 0,
		providerTimeoutTotal: 0,
	};

	return {
		record(path: string, status: number) {
			if (!path.startsWith("/api/")) return;
			counters.apiRequestsTotal++;
			if (status >= 500) counters.http5xxTotal++;
			if (path.startsWith("/api/auth/") && [400, 401, 403, 429].includes(status)) {
				counters.authFailureTotal++;
			}
			if (path === "/api/sync/write" && [400, 403, 409, 422].includes(status)) {
				counters.syncRejectionTotal++;
			}
			if (status === 504) counters.providerTimeoutTotal++;
		},
		snapshot(): OpsCountersSnapshot {
			return { processStartedAt, ...counters };
		},
	};
}

const counters = createOpsCounters();

export function recordHttpMetric(path: string, status: number) {
	counters.record(path, status);
}

function tokenDigest(value: string) {
	return createHash("sha256").update(value).digest();
}

export function isOpsTokenAuthorized(header: string | undefined, expected: string | undefined) {
	if (
		!expected ||
		expected.length < 32 ||
		expected.length > 512 ||
		!header?.startsWith("Bearer ")
	) {
		return false;
	}
	const provided = header.slice("Bearer ".length);
	if (!provided || provided.length > 512) return false;
	return timingSafeEqual(tokenDigest(provided), tokenDigest(expected));
}

export async function readOpsSloSnapshot() {
	try {
		const rows = (await getDb().execute(sql`
			SELECT count(*)::int AS count
			FROM reminders
			WHERE delivery_state = 'dead'
		`)) as { count: number }[];
		return {
			ok: true as const,
			generatedAt: new Date().toISOString(),
			scope: "single-process-counters; aggregate across replicas",
			database: "up" as const,
			reminderDead: Number(rows[0]?.count ?? 0),
			counters: counters.snapshot(),
		};
	} catch {
		return {
			ok: false as const,
			generatedAt: new Date().toISOString(),
			scope: "single-process-counters; aggregate across replicas",
			database: "down" as const,
			reminderDead: null,
			counters: counters.snapshot(),
		};
	}
}
