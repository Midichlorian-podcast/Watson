import { deriveSyncTrustState, formatSyncTimestamp } from "./syncTrust";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

const derive = (overrides: Parameters<typeof deriveSyncTrustState>[0]) =>
	deriveSyncTrustState(overrides);

console.log("(a) připojení není synonymum dokončené synchronizace");
{
	const initial = derive({ connected: true, hasSynced: false });
	const syncing = derive({
		connected: true,
		hasSynced: true,
		dataFlowStatus: { downloading: true },
	});
	const synced = derive({ connected: true, hasSynced: true });
	check("první sync je samostatný stav", initial.kind === "initial_sync", initial);
	check("aktivní přenos nehlásí hotovo", syncing.kind === "syncing", syncing);
	check("synced vznikne až po checkpointu bez přenosu", synced.kind === "synced", synced);
}

console.log("(b) offline cache se nezamění za autoritativní data");
{
	const cached = derive({
		connected: false,
		browserOnline: false,
		hasSynced: true,
		lastSyncedAt: "2026-07-16T10:30:00.000Z",
	});
	const empty = derive({ connected: false, hasSynced: false });
	check(
		"cache je použitelná, ale označená jako stará",
		cached.kind === "offline_cached" && cached.dataUsable && cached.dataStale,
		cached,
	);
	check(
		"cold start offline není obchodní empty state",
		empty.kind === "offline_empty" && !empty.dataUsable,
		empty,
	);
}

console.log("(c) browserové odpojení má okamžitě přednost před opožděným socketem");
{
	const offlineBeforeSocket = derive({
		connected: true,
		browserOnline: false,
		hasSynced: true,
		lastSyncedAt: "2026-07-16T10:30:00.000Z",
	});
	check(
		"navigator offline neponechá falešný zelený stav",
		offlineBeforeSocket.kind === "offline_cached" && offlineBeforeSocket.dataStale,
		offlineBeforeSocket,
	);
}

console.log("(d) obnova spojení a chyby zachovají pravdivou čerstvost");
{
	const reconnecting = derive({
		connected: false,
		connecting: true,
		hasSynced: true,
		lastSyncedAt: new Date("2026-07-16T10:30:00.000Z"),
	});
	const error = derive({
		connected: true,
		hasSynced: true,
		lastSyncedAt: "2026-07-16T10:30:00.000Z",
		dataFlowStatus: { uploadError: new Error("secret transport detail") },
	});
	check(
		"reconnect používá přiznanou cache",
		reconnecting.kind === "connecting" && reconnecting.dataStale,
		reconnecting,
	);
	check(
		"transportní chyba má přednost před zeleným stavem",
		error.kind === "sync_error" && error.hasTransportError,
		error,
	);
}

console.log("(e) čas respektuje locale a neplatná hodnota se nezobrazí");
{
	const valid = formatSyncTimestamp(new Date("2026-07-16T10:30:00.000Z"), "cs-CZ");
	const invalid = derive({ connected: false, hasSynced: false, lastSyncedAt: "not-a-date" });
	check(
		"platný checkpoint obsahuje datum i čas",
		Boolean(valid?.match(/16/) && valid.match(/:/)),
		valid,
	);
	check(
		"neplatný checkpoint nevytvoří falešnou cache",
		invalid.lastSyncedAt === null && !invalid.dataUsable,
		invalid,
	);
}

if (failed) {
	console.error(`\nSync trust testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nSync trust testy: vše prošlo");
