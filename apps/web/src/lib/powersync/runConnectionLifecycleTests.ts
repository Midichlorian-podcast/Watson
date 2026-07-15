import { connectBeforePublish, deleteIndexedDatabase } from "./connectionLifecycle";

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

if (failed) {
	console.error(`\nDB lifecycle testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nDB lifecycle testy: vše prošlo");
