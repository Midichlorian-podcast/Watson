import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { API_URL } from "../api";
import type { RejectedOpRow } from "./AppSchema";

type WriteEnvelope = {
	op: "PUT" | "PATCH" | "DELETE";
	table: string;
	id: string;
	data?: Record<string, unknown>;
	previous?: Record<string, unknown>;
	clientId: string;
	operationId: string;
};

export type RetryRejectedResult = {
	ok: boolean;
	httpCode: number | null;
	code: string | null;
};

function parseEnvelope(payload: string | null): WriteEnvelope | null {
	try {
		const value = JSON.parse(payload ?? "null") as Partial<WriteEnvelope> | null;
		if (!value || typeof value !== "object") return null;
		if (value.op !== "PUT" && value.op !== "PATCH" && value.op !== "DELETE") return null;
		if (
			typeof value.table !== "string" ||
			typeof value.id !== "string" ||
			typeof value.clientId !== "string" ||
			typeof value.operationId !== "string"
		)
			return null;
		return value as WriteEnvelope;
	} catch {
		return null;
	}
}

/**
 * Znovu odešle dead-letter operaci se STEJNÝM idempotency klíčem. Stav se mění
 * pouze lokálně; úspěch záznam ponechá jako resolved pro dohledatelnost, chyba
 * jej vrátí do open a uloží poslední bezpečný serverový kód/request ID.
 */
export async function retryRejectedOperation(
	database: Pick<AbstractPowerSyncDatabase, "execute">,
	row: RejectedOpRow,
	fetchFn: typeof fetch = fetch,
): Promise<RetryRejectedResult> {
	const envelope = parseEnvelope(row.payload);
	if (!envelope) return { ok: false, httpCode: null, code: "legacy_payload" };

	const attemptedAt = new Date().toISOString();
	await database.execute(
		"UPDATE local_rejected_ops SET status = 'retrying', last_attempt_at = ?, attempt_count = COALESCE(attempt_count, 0) + 1 WHERE id = ?",
		[attemptedAt, row.id],
	);

	try {
		const response = await fetchFn(`${API_URL}/api/sync/write`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(envelope),
		});
		let server: { error?: string; code?: string | null; requestId?: string | null } = {};
		try {
			server = (await response.json()) as typeof server;
		} catch {
			// Bezpečný fallback pro proxy/empty odpověď.
		}

		if (response.ok) {
			await database.execute(
				"UPDATE local_rejected_ops SET status = 'resolved', http_code = ?, server_code = NULL, request_id = ? WHERE id = ?",
				[response.status, server.requestId ?? null, row.id],
			);
			return { ok: true, httpCode: response.status, code: null };
		}

		const code = server.code ?? server.error ?? `http_${response.status}`;
		await database.execute(
			"UPDATE local_rejected_ops SET status = 'open', http_code = ?, server_code = ?, request_id = ? WHERE id = ?",
			[response.status, code, server.requestId ?? null, row.id],
		);
		return { ok: false, httpCode: response.status, code };
	} catch {
		await database.execute(
			"UPDATE local_rejected_ops SET status = 'open', http_code = NULL, server_code = 'network_error' WHERE id = ?",
			[row.id],
		);
		return { ok: false, httpCode: null, code: "network_error" };
	}
}
