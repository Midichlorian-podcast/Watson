import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./AppSchema";
import { WatsonConnector } from "./connector";

/** Lokální PowerSync DB (SQLite WASM). Okamžité čtení/zápis, sync na pozadí. */
export const powerSync = new PowerSyncDatabase({
	schema: AppSchema,
	database: { dbFilename: "watson.db" },
});

let connected = false;

/** Připojí se k sync službě (po přihlášení). Idempotentní. */
export async function connectPowerSync() {
	if (connected) return;
	connected = true;
	await powerSync.connect(new WatsonConnector());
}

export async function disconnectPowerSync() {
	connected = false;
	await powerSync.disconnect();
}
