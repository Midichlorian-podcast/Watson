import {
	type AbstractPowerSyncDatabase,
	type CrudEntry,
	type PowerSyncBackendConnector,
	UpdateType,
} from "@powersync/web";
import { API_URL } from "../api";

/** Postgres chyby (constraint/permission) → zahodit op, ať neblokuje frontu. */
const FATAL = [/^22\d\d\d$/, /^23\d\d\d$/, /^42501$/, /^4\d\d$/];

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

		let last: CrudEntry | null = null;
		try {
			for (const op of tx.crud) {
				last = op;
				const method =
					op.op === UpdateType.PUT
						? "PUT"
						: op.op === UpdateType.PATCH
							? "PATCH"
							: "DELETE";
				const res = await fetch(`${API_URL}/api/sync/write`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({
						op: method,
						table: op.table,
						id: op.id,
						data: op.opData,
					}),
				});
				if (!res.ok) {
					const e = new Error(`write HTTP ${res.status}`) as Error & {
						code?: string;
					};
					e.code = String(res.status);
					throw e;
				}
			}
			await tx.complete();
		} catch (ex) {
			const code = (ex as { code?: string }).code;
			if (code && FATAL.some((r) => r.test(code))) {
				console.error("[powersync] zahozuji nevratnou operaci", last, ex);
				// S3 — op se zahodí (další sync vrátí lokální optimistickou změnu); upozorni uživatele.
				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent("watson:write-rejected", {
							detail: { table: last?.table, op: last?.op, code },
						}),
					);
				}
				await tx.complete();
			} else {
				throw ex; // dočasná chyba → PowerSync zkusí znovu
			}
		}
	}
}
