type DatabaseCandidate = {
	close: () => Promise<void>;
};

/**
 * Připojení databáze je transakční z pohledu zbytku aplikace: kandidát se
 * zveřejní až po úspěšném dokončení inicializace. Při chybě se vždy zavře,
 * takže retry nezačne nad napůl otevřenou instancí.
 */
export async function connectBeforePublish<T extends DatabaseCandidate>(options: {
	candidate: T;
	connect: (candidate: T) => Promise<void>;
	publish: (candidate: T) => void;
}): Promise<void> {
	try {
		await options.connect(options.candidate);
	} catch (error) {
		try {
			await options.candidate.close();
		} catch {
			/* původní chyba inicializace má přednost před chybou úklidu */
		}
		throw error;
	}
	options.publish(options.candidate);
}

/** Počká i na fyzické smazání IndexedDB; pouhé zavolání deleteDatabase nestačí. */
export function deleteIndexedDatabase(
	name: string,
	factory: Pick<IDBFactory, "deleteDatabase"> = indexedDB,
	timeoutMs = 10_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = factory.deleteDatabase(name);
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error("indexed_db_delete_blocked"));
		}, timeoutMs);
		request.onsuccess = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve();
		};
		request.onerror = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(request.error ?? new Error("indexed_db_delete_failed"));
		};
		// `blocked` je průběžná událost, ne konečný výsledek. Po zavření
		// posledního handle může tentýž request ještě normálně skončit úspěchem.
		request.onblocked = () => {};
	});
}
