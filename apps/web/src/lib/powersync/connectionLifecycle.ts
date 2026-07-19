type DatabaseCandidate = {
	close: () => Promise<void>;
};

export type StartupSyncStatus = {
	connected?: boolean;
	connecting?: boolean;
	hasSynced?: boolean;
	lastSyncedAt?: Date | string | null;
	dataFlowStatus?: { downloadError?: unknown };
};

/**
 * PowerSync `connect()` může při chybě vytvoření streamu interně chybu spolknout
 * a vrátit se s výchozím prázdným statusem. Takový stav nesmí být publikovaný
 * jako hotová DB — UI by pak navždy tvrdilo „Ověřuji data…“ bez recovery akce.
 * Dříve potvrzená cache je naopak použitelná i při aktuálním výpadku sítě.
 */
export function assertPowerSyncStartup(status: StartupSyncStatus): void {
	const cached = status.hasSynced === true || status.lastSyncedAt != null;
	if (cached) return;
	if (status.dataFlowStatus?.downloadError != null) {
		throw new Error("powersync_initial_download_failed");
	}
	if (status.connected) return;
	throw new Error("powersync_connection_not_started");
}

/** Zda lze HMR instanci bezpečně znovu použít místo vytvoření nové. */
export function isReusablePowerSyncStatus(status: StartupSyncStatus): boolean {
	const cached = status.hasSynced === true || status.lastSyncedAt != null;
	if (!cached && status.dataFlowStatus?.downloadError != null) return false;
	return Boolean(
		status.connected ||
			status.connecting ||
			cached,
	);
}

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
