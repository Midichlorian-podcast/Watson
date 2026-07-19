import {
	type AbstractPowerSyncDatabase,
	type PowerSyncBackendConnector,
	UpdateType,
} from "@powersync/web";
import { API_URL } from "../api";

/**
 * Které HTTP stavy jsou TRVALÉ (op zahodit) vs. PŘECHODNÉ (znovu zkusit).
 * Trvalé = server op nikdy nepřijme: 400 (neplatná data/constraint), 403 (nemáš právo → rollback UX),
 * 409 (konflikt), 422 (validace).
 * Přechodné (NEzahazovat, jinak ztráta offline dat): 401 (vypršelá session → re-auth), 408 (timeout),
 * 429 (rate limit), 5xx (výpadek serveru), síťová chyba. Ty se musí zkusit znovu.
 */
const PERMANENT_STATUS = new Set([400, 403, 409, 422]);
function isPermanent(code?: string): boolean {
	const n = Number(code);
	return Number.isFinite(n) && PERMANENT_STATUS.has(n);
}

export class WatsonConnector implements PowerSyncBackendConnector {
	/** Token + endpoint sync služby z našeho backendu (vyžaduje session cookie). */
	async fetchCredentials() {
		const res = await fetch(`${API_URL}/api/powersync/token`, {
			credentials: "include",
		});
		if (!res.ok) throw new Error(`token endpoint: HTTP ${res.status}`);
		const { token, powersync_url } = (await res.json()) as {
			token: string;
			powersync_url: string;
		};
		return { endpoint: powersync_url, token };
	}

	/** Upload fronta → náš write endpoint (Postgres). */
	async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
		const tx = await database.getNextCrudTransaction();
		if (!tx) return;
		const clientId = await database.getClientId();

		// Každou op řešíme samostatně: TRVALE odmítnutou přeskočíme (a upozorníme), ale ve smyčce
		// pokračujeme — jinak by jedna vadná op zahodila i ostatní NEODESLANÉ zápisy z téže
		// transakce (ztráta dat). PŘECHODNÁ chyba (401/408/429/5xx/síť) → throw → PowerSync
		// zopakuje CELOU transakci (PUT/PATCH/DELETE jsou idempotentní, takže re-send je bezpečný).
		for (const op of tx.crud) {
			const method =
				op.op === UpdateType.PUT
					? "PUT"
					: op.op === UpdateType.PATCH
						? "PATCH"
						: "DELETE";
			const envelope = {
				op: method,
				table: op.table,
				id: op.id,
				data: op.opData,
				previous: op.previousValues,
				clientId,
				operationId: String(op.clientId),
			};
			// Síťovou výjimku necháme probublat: PowerSync zachová a zopakuje celou tx.
			const res = await fetch(`${API_URL}/api/sync/write`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(envelope),
			});
			if (res.ok) continue;
			const code = String(res.status);
			if (isPermanent(code)) {
				// CC-P0-04: PŘED dokončením transakce ulož odmítnutou operaci do
				// local-only tabulky (Centrum problémů) — uživatelův záměr nesmí
				// zmizet jen s 6s toastem. Payload zůstává jen na zařízení.
				let server: { error?: string; code?: string | null; requestId?: string | null } = {};
				try {
					server = (await res.json()) as typeof server;
				} catch {
					/* prázdné/textové tělo */
				}
				console.error("[powersync] trvale odmítnutá operace", {
					table: op.table,
					rowId: op.id,
					code,
					serverCode: server.code ?? server.error ?? null,
					requestId: server.requestId ?? null,
				});
				try {
					await database.execute(
						`INSERT OR IGNORE INTO local_rejected_ops
						 (id, created_at, last_attempt_at, attempt_count, client_id, operation_id,
						  table_name, op, row_id, payload, http_code, server_code, request_id, status)
						 VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
						[
							`${clientId}:${op.clientId}`,
							new Date().toISOString(),
							new Date().toISOString(),
							clientId,
							String(op.clientId),
							op.table,
							method,
							op.id,
							JSON.stringify(envelope),
							res.status,
							server.code ?? server.error ?? null,
							server.requestId ?? null,
						],
					);
				} catch (recErr) {
					console.error("[powersync] zápis do local_rejected_ops selhal", {
						name: recErr instanceof Error ? recErr.name : "UnknownError",
					});
					// Bez durable recovery záznamu se upload fronta nesmí potvrdit.
					throw new Error("rejected_operation_recovery_failed", { cause: recErr });
				}
				// S3 — op se zahodí (další sync vrátí lokální optimistickou změnu); upozorni uživatele.
				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent("watson:write-rejected", {
							detail: { table: op.table, op: op.op, code },
						}),
					);
				}
				// pokračuj dalšími op (tuhle jen přeskočíme)
			} else {
				// Přechodná (401 vypršelá session, 408/429, 5xx) → NEZAHAZUJ, zkus znovu.
				const e = new Error(`write HTTP ${res.status}`) as Error & {
					code?: string;
				};
				e.code = code;
				throw e;
			}
		}
		await tx.complete();
	}
}
