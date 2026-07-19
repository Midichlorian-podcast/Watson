import { PowerSyncDatabase } from "@powersync/web";
import { API_URL } from "../api";
import { queryClient } from "../queryClient";
import { storageGet, storageKeys, storageRemove, storageSet } from "../storage";
import { withCrossWindowLock } from "../windowCoordinator";
import { browserSupportsSafeMultiWindowData } from "../windowSurfaces";
import { AppSchema } from "./AppSchema";
import {
	assertPowerSyncStartup,
	connectBeforePublish,
	deleteIndexedDatabase,
	isReusablePowerSyncStatus,
} from "./connectionLifecycle";
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
const ENCRYPTION_MIGRATED_PREFIX = "watson.device.dbEncrypted.v1.";
const PLAINTEXT_CLEANUP_PREFIX = "watson.device.plaintextDbCleanup.v1.";

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
type PowerSyncHmrState = {
	__watsonPowerSync?: PowerSyncDatabase;
	__watsonUserHash?: string | null;
};

// Produkční stránka nesmí vystavovat živý databázový objekt na globalThis.
// Globální úložiště je potřeba pouze ve Vite dev režimu, kde drží instanci přes HMR.
const hmr: PowerSyncHmrState =
	import.meta.env?.DEV === true ? (globalThis as PowerSyncHmrState) : {};

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
	for (const key of storageKeys()) {
		if (key.startsWith("watson") && !COSMETIC_KEYS.has(key)) storageRemove(key);
	}
	queryClient.clear();
}

/** Jednorázově vyčistí legacy sdílený watson.db (data všech dřívějších přihlášení). */
async function wipeLegacySharedDb() {
	if (storageGet(LEGACY_WIPED_KEY) === "1") return;
	try {
		// Databázi neotvírat: wa-sqlite VFS drží IndexedDB handle až do konce
		// stránky a fyzické deleteDatabase by pak zůstalo zablokované.
		await deleteIndexedDatabase("watson.db");
		storageSet(LEGACY_WIPED_KEY, "1");
	} catch (err) {
		console.warn("[powersync] čištění legacy watson.db selhalo:", err);
	}
}

async function fetchLocalDataKey(): Promise<string> {
	const response = await fetch(`${API_URL}/api/me/local-data-key`, {
		credentials: "include",
		cache: "no-store",
	});
	if (!response.ok) throw new Error(`local_data_key_http_${response.status}`);
	const body = (await response.json()) as { key?: unknown; version?: unknown };
	if (typeof body.key !== "string" || body.key.length < 32 || body.version !== 1) {
		throw new Error("local_data_key_invalid");
	}
	return body.key;
}

/**
 * Jednorázový přechod ze staré nešifrované per-user DB. Nejprve synchronně
 * odešle CELOU lokální CRUD frontu; teprve potom cache smaže. Při offline stavu
 * nebo serverové chybě migrace failne a původní DB i neodeslané změny zůstanou
 * nedotčené — aplikace nabídne retry místo tiché ztráty dat.
 */
async function migratePlaintextDb(h: string): Promise<string> {
	const marker = `${ENCRYPTION_MIGRATED_PREFIX}${h}`;
	const cleanupMarker = `${PLAINTEXT_CLEANUP_PREFIX}${h}`;
	const plaintextFilename = `watson-${h}.db`;
	const encryptedFilename = `watson-${h}-encrypted-v2.db`;
	const state = storageGet(marker);
	// Hodnota 1 pochází z dřívější verze, která šifrovala původní filename.
	if (state === "1") return plaintextFilename;
	if (state === "2") {
		if (storageGet(cleanupMarker) === "1") {
			try {
				// Při novém startu už starý wa-sqlite VFS handle neexistuje.
				await deleteIndexedDatabase(plaintextFilename, indexedDB, 1_000);
				storageRemove(cleanupMarker);
			} catch (error) {
				// Jiná otevřená karta může úklid dočasně blokovat; data už byla
				// logicky vyčištěna a pokus se zopakuje při příštím startu.
				console.warn("[powersync] odložený úklid plaintext DB zatím neproběhl", {
					name: error instanceof Error ? error.name : "UnknownError",
				});
			}
		}
		return encryptedFilename;
	}
	// Čistá instalace nemá co migrovat. Neotvírat prázdnou plaintext DB jen
	// kvůli detekci — její VFS handle by zbytečně zablokoval fyzický úklid.
	if (typeof indexedDB.databases === "function") {
		const databases = await indexedDB.databases();
		if (!databases.some((database) => database.name === plaintextFilename)) {
			storageSet(marker, "2");
			return encryptedFilename;
		}
	}
	const old = new PowerSyncDatabase({
		schema: AppSchema,
		database: { dbFilename: plaintextFilename },
	});
	const connector = new WatsonConnector();
	try {
		await old.waitForReady();
		// uploadData vždy dokončí právě jednu transakci. Pevný strop chrání před
		// poškozenou/nekonečně doplňovanou frontou; běžně smyčka proběhne 0–N×.
		for (let n = 0; n < 10_000; n += 1) {
			const pending = await old.getNextCrudTransaction();
			if (!pending) break;
			await connector.uploadData(old);
			if (n === 9_999) throw new Error("plaintext_migration_queue_limit");
		}
		await old.disconnectAndClear();
		await old.close();
		// PowerSync/wa-sqlite neuvolní VFS IndexedDB handle dostatečně brzo pro
		// bezpečné znovuotevření se šifrováním pod stejným názvem. Nová šifrovaná
		// DB proto používá verzovaný filename; fyzický úklid se provede při
		// příštím startu. Marker se zapisuje až po úplném vyčištění staré fronty.
		storageSet(marker, "2");
		storageSet(cleanupMarker, "1");
		return encryptedFilename;
	} catch (error) {
		try {
			await old.close();
		} catch {
			/* původní DB zůstává pro další bezpečný pokus */
		}
		throw new Error("local_database_encryption_migration_failed", { cause: error });
	}
}

/**
 * Otevře (a připojí) per-user DB. Idempotentní pro stejného uživatele;
 * pro jiného uživatele nejdřív bezpečně zavře starou instanci a vyčistí
 * lokální stav. App.tsx na výsledek ČEKÁ před renderem routeru.
 */
export function initPowerSyncForUser(userId: string): Promise<void> {
	return enqueue(async () => {
		const h = await userHash(userId);
		return withCrossWindowLock(`powersync-init:${h}`, async () => {
			if (
				currentHash === h &&
				powerSync &&
				!powerSync.closed &&
				isReusablePowerSyncStatus(powerSync.currentStatus)
			) {
				return;
			}

			if (powerSync) {
				try {
					await powerSync.disconnect();
					await powerSync.close();
				} catch (err) {
					console.warn("[powersync] zavírání staré DB selhalo:", err);
				}
			}
			// Jiná identita, než pro kterou tu jsou lokální data → vyčistit.
			if (storageGet(LAST_USER_KEY) !== h) wipeSensitiveLocalState();
			await wipeLegacySharedDb();
			const encryptionKey = await fetchLocalDataKey();
			const dbFilename = await migratePlaintextDb(h);
			storageSet(LAST_USER_KEY, h);

			const db = new PowerSyncDatabase({
				schema: AppSchema,
				database: { dbFilename },
				encryptionKey,
				// SDK používá SharedWorker pro DB i sync stream. Explicitní flag drží
				// Watson na stejné, otestovatelné hranici i po budoucím upgradu SDK.
				flags: { enableMultiTabs: browserSupportsSafeMultiWindowData() },
			});
			try {
				await connectBeforePublish({
					candidate: db,
					connect: async (candidate) => {
						// SDK connection manager chybu inicializace streamu interně polyká.
						// `waitForReady` proto musí proběhnout přímo zde a výsledný status
						// musí obsahovat buď spojení, nebo dříve potvrzenou offline cache.
						await candidate.waitForReady();
						await candidate.connect(new WatsonConnector());
						assertPowerSyncStartup(candidate.currentStatus);
					},
					publish: (candidate) => {
						powerSync = candidate;
						currentHash = h;
						hmr.__watsonPowerSync = candidate;
						hmr.__watsonUserHash = h;
						// Dev-only handle pro ladění/verifikaci z konzole (dynamický import ve Vite
						// vyrábí druhou instanci modulu, takže live-binding z konzole nejde použít).
						if (import.meta.env?.DEV === true) {
							(window as unknown as { __watsonDb?: PowerSyncDatabase }).__watsonDb = candidate;
						}
					},
				});
			} catch (error) {
				throw new Error("local_database_connect_failed", { cause: error });
			}
		});
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
			storageRemove(LAST_USER_KEY);
		}
		currentHash = null;
		hmr.__watsonUserHash = null;
		// powerSync necháváme nastavené (zavřené) — App po logout renderuje SignIn,
		// další login přes initPowerSyncForUser instanci nahradí.
	});
}
