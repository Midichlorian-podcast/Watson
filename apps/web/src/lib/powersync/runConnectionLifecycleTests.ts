import {
	assertPowerSyncStartup,
	connectBeforePublish,
	deleteIndexedDatabase,
	isReusablePowerSyncStatus,
} from "./connectionLifecycle";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

console.log("(a) úspěšná inicializace");
{
	const events: string[] = [];
	const candidate = {
		close: async () => {
			events.push("close");
		},
	};
	await connectBeforePublish({
		candidate,
		connect: async () => {
			events.push("connect:start");
			await Promise.resolve();
			events.push("connect:end");
		},
		publish: () => events.push("publish"),
	});
	check("kandidát se publikuje až po připojení", events.join(",") === "connect:start,connect:end,publish", events);
}

console.log("(b) selhání inicializace");
{
	const events: string[] = [];
	const candidate = {
		close: async () => {
			events.push("close");
		},
	};
	let threw = false;
	try {
		await connectBeforePublish({
			candidate,
			connect: async () => {
				events.push("connect");
				throw new Error("open_failed");
			},
			publish: () => events.push("publish"),
		});
	} catch {
		threw = true;
	}
	check("chyba se propaguje", threw);
	check("neúspěšný kandidát se zavře a nepublikuje", events.join(",") === "connect,close", events);
}

console.log("(c) fyzické smazání IndexedDB");
{
	const request: {
		onsuccess: (() => void) | null;
		onerror: (() => void) | null;
		onblocked: (() => void) | null;
		error: Error | null;
	} = { onsuccess: null, onerror: null, onblocked: null, error: null };
	const factory = {
		deleteDatabase: () => request,
	};
	let resolved = false;
	const deletion = deleteIndexedDatabase("watson-test.db", factory as never).then(() => {
		resolved = true;
	});
	await Promise.resolve();
	check("promise neproběhne před onsuccess", !resolved);
	request.onblocked?.();
	await Promise.resolve();
	check("blocked není mylně považováno za konečnou chybu", !resolved);
	request.onsuccess?.();
	await deletion;
	check("promise proběhne po onsuccess", resolved);
}

console.log("(d) tichý prázdný startup status se nesmí publikovat");
{
	let emptyRejected = false;
	try {
		assertPowerSyncStartup({});
	} catch (error) {
		emptyRejected = error instanceof Error && error.message === "powersync_connection_not_started";
	}
	check("prázdný status je chyba, ne nekonečné Ověřuji data", emptyRejected);
	let downloadRejected = false;
	try {
		assertPowerSyncStartup({ dataFlowStatus: { downloadError: new Error("network") } });
	} catch (error) {
		downloadRejected =
			error instanceof Error && error.message === "powersync_initial_download_failed";
	}
	check("cold-start download chyba je explicitní", downloadRejected);
	let connectedDownloadRejected = false;
	try {
		assertPowerSyncStartup({
			connected: true,
			dataFlowStatus: { downloadError: new Error("invalid token") },
		});
	} catch (error) {
		connectedDownloadRejected =
			error instanceof Error && error.message === "powersync_initial_download_failed";
	}
	check("spojení bez cache neschová download chybu", connectedDownloadRejected);
	check("živé spojení je použitelné", isReusablePowerSyncStatus({ connected: true }));
	check(
		"dříve potvrzená offline cache je použitelná",
		isReusablePowerSyncStatus({ connected: false, hasSynced: true }),
	);
	check(
		"HMR nepřevezme cold-start instanci s download chybou",
		!isReusablePowerSyncStatus({
			connected: true,
			dataFlowStatus: { downloadError: new Error("invalid token") },
		}),
	);
	check("prázdná HMR instance se znovu nepoužije", !isReusablePowerSyncStatus({}));
}

if (failed) {
	console.error(`\nDB lifecycle testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nDB lifecycle testy: vše prošlo");
