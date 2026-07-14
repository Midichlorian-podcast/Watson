import { PowerSyncDatabase } from "@powersync/web";
import { queryClient } from "../queryClient";
import { AppSchema } from "./AppSchema";
import { WatsonConnector } from "./connector";

/**
 * CC-P0-03 — lokální data jsou PER UŽIVATEL:
 * - každý účet má vlastní SQLite soubor `watson-<hash>.db` (hash = neprůhledný
 *   otisk user ID, žádné PII v názvu souboru),
 * - při změně identity se stará DB zavře, vyčistí se TanStack query cache
 *   a smažou se všechny watson* localStorage klíče kromě čistě vzhledových
 *   (default-deny: nový klíč je od začátku považovaný za citlivý),
 * - legacy sdílený `watson.db` (mix dat všech účtů, co se kdy přihlásily)
 *   se jednorázově vyčistí přes disconnectAndClear.
 *
 * `powerSync` je ES live-binding — konzumenti (`import { powerSync }`) vidí
 * po přepnutí identity automaticky novou instanci. App.tsx NErenderuje router,
 * dokud initPowerSyncForUser(session.user.id) nedoběhne.
 */

const LAST_USER_KEY = "watson.device.lastUser";
const LEGACY_WIPED_KEY = "watson.device.legacyDbWiped";

/** Vzhledové preference přežijí změnu identity; VŠE ostatní watson* se maže. */
const COSMETIC_KEYS = new Set<string>([
	"watson.density",
	"watson.accent",
	"watson.rail",
	"watson.ovLayout",
	"watson.landing",
	"watson.calMode",
	"watson.calWeekView",
	"watson.calDensity",
	"watson.calBorder",
	"watson.calPlanning",
	"watson-mail.sube",
	"watson-mail.dens",
	"watson-mail.lines",
	"watson-mail.listW",
	LAST_USER_KEY,
	LEGACY_WIPED_KEY,
]);

// HMR pojistka: re-exekuce modulu (Vite) nesmí zahodit běžící instanci — jinak
// by konzumenti po HMR viděli powerSync undefined (pád Sidebar/useStatus).
const hmr = globalThis as {
	__watsonPowerSync?: PowerSyncDatabase;
	__watsonUserHash?: string | null;
};

// Živá vazba — nastaví ji initPowerSyncForUser dřív, než se vyrenderuje router.
export let powerSync: PowerSyncDatabase = hmr.__watsonPowerSync as PowerSyncDatabase;

let currentHash: string | null = hmr.__watsonUserHash ?? null;
// Jednoduchý mutex: init/shutdown se serializují (StrictMode volá efekty 2×).
let chain: Promise<unknown> = Promise.resolve();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
	const next = chain.then(fn, fn);
	chain = next.catch(() => {});
	return next;
};

/** Neprůhledný otisk user ID pro název DB souboru (žádný e-mail/ID v OPFS). */
async function userHash(userId: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
	return [...new Uint8Array(buf)]
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function wipeSensitiveLocalState() {
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith("watson") && !COSMETIC_KEYS.has(key)) localStorage.removeItem(key);
	}
	queryClient.clear();
}

/** Jednorázově vyčistí legacy sdílený watson.db (data všech dřívějších přihlášení). */
async function wipeLegacySharedDb() {
	if (localStorage.getItem(LEGACY_WIPED_KEY) === "1") return;
	try {
		const legacy = new PowerSyncDatabase({
			schema: AppSchema,
			database: { dbFilename: "watson.db" },
		});
		await legacy.disconnectAndClear();
		await legacy.close();
		// disconnectAndClear smaže řádky, ale IndexedDB soubor (wa-sqlite VFS)
		// zůstává — odstraň i ten, ať po sdílené DB nezbude nic.
		indexedDB.deleteDatabase("watson.db");
	} catch (err) {
		console.warn("[powersync] čištění legacy watson.db selhalo:", err);
	}
	localStorage.setItem(LEGACY_WIPED_KEY, "1");
}

/**
 * Otevře (a připojí) per-user DB. Idempotentní pro stejného uživatele;
 * pro jiného uživatele nejdřív bezpečně zavře starou instanci a vyčistí
 * lokální stav. App.tsx na výsledek ČEKÁ před renderem routeru.
 */
export function initPowerSyncForUser(userId: string): Promise<void> {
	return enqueue(async () => {
		const h = await userHash(userId);
		if (currentHash === h && powerSync) return;

		if (powerSync) {
			try {
				await powerSync.disconnect();
				await powerSync.close();
			} catch (err) {
				console.warn("[powersync] zavírání staré DB selhalo:", err);
			}
		}
		// Jiná identita, než pro kterou tu jsou lokální data → vyčistit.
		if (localStorage.getItem(LAST_USER_KEY) !== h) wipeSensitiveLocalState();
		await wipeLegacySharedDb();
		localStorage.setItem(LAST_USER_KEY, h);

		const db = new PowerSyncDatabase({
			schema: AppSchema,
			database: { dbFilename: `watson-${h}.db` },
		});
		powerSync = db;
		currentHash = h;
		hmr.__watsonPowerSync = db;
		hmr.__watsonUserHash = h;
		// Dev-only handle pro ladění/verifikaci z konzole (dynamický import ve Vite
		// vyrábí druhou instanci modulu, takže live-binding z konzole nejde použít).
		if (import.meta.env.DEV) {
			(window as unknown as { __watsonDb?: PowerSyncDatabase }).__watsonDb = db;
		}
		await db.connect(new WatsonConnector());
	});
}

/**
 * Odhlášení. `removeLocalData` = „odhlásit a odstranit data ze zařízení":
 * smaže obsah per-user DB (disconnectAndClear) i citlivé localStorage klíče —
 * po tobě na zařízení nic nezůstane. Bez něj data zůstávají pro rychlý
 * re-login STEJNÉHO účtu (jiný účet je stejně nevidí — má vlastní soubor).
 */
export function shutdownPowerSync(opts?: { removeLocalData?: boolean }): Promise<void> {
	return enqueue(async () => {
		if (powerSync) {
			try {
				if (opts?.removeLocalData) await powerSync.disconnectAndClear();
				else await powerSync.disconnect();
				await powerSync.close();
			} catch (err) {
				console.warn("[powersync] shutdown selhal:", err);
			}
		}
		if (opts?.removeLocalData) {
			wipeSensitiveLocalState();
			localStorage.removeItem(LAST_USER_KEY);
		}
		currentHash = null;
		hmr.__watsonUserHash = null;
		// powerSync necháváme nastavené (zavřené) — App po logout renderuje SignIn,
		// další login přes initPowerSyncForUser instanci nahradí.
	});
}
