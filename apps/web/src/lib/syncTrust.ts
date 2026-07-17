export type SyncTrustKind =
	| "starting"
	| "connecting"
	| "initial_sync"
	| "syncing"
	| "synced"
	| "sync_error"
	| "offline_cached"
	| "offline_empty";

export type SyncStatusSnapshot = {
	connected: boolean;
	connecting?: boolean;
	/** `false` je okamžitý browserový důkaz odpojení; `true` samo o sobě spojení nedokazuje. */
	browserOnline?: boolean;
	hasSynced?: boolean;
	lastSyncedAt?: Date | string | null;
	dataFlowStatus?: {
		downloading?: boolean;
		uploading?: boolean;
		downloadError?: unknown;
		uploadError?: unknown;
	};
};

export type SyncTrustState = {
	kind: SyncTrustKind;
	/** Data už mají alespoň jeden potvrzený checkpoint a smějí se zobrazit jako cache. */
	dataUsable: boolean;
	/** Data mohou být starší než autoritativní serverový stav. */
	dataStale: boolean;
	transferring: boolean;
	hasTransportError: boolean;
	lastSyncedAt: Date | null;
};

function validDate(value: SyncStatusSnapshot["lastSyncedAt"]): Date | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Jediný faktický překlad PowerSync signálů do stavů, které Watson smí tvrdit
 * uživateli. Samotné `connected` nikdy neznamená `synced`.
 */
export function deriveSyncTrustState(status: SyncStatusSnapshot): SyncTrustState {
	const lastSyncedAt = validDate(status.lastSyncedAt);
	const dataUsable = status.hasSynced === true || lastSyncedAt !== null;
	const transferring = Boolean(
		status.dataFlowStatus?.downloading || status.dataFlowStatus?.uploading,
	);
	const hasTransportError = Boolean(
		status.dataFlowStatus?.downloadError || status.dataFlowStatus?.uploadError,
	);

	let kind: SyncTrustKind;
	if (status.browserOnline === false) kind = dataUsable ? "offline_cached" : "offline_empty";
	else if (hasTransportError) kind = "sync_error";
	else if (status.connected && status.hasSynced !== true) kind = "initial_sync";
	else if (status.connected && transferring) kind = "syncing";
	else if (status.connected) kind = "synced";
	else if (status.connecting) kind = "connecting";
	else if (status.hasSynced === undefined && lastSyncedAt === null) kind = "starting";
	else if (dataUsable) kind = "offline_cached";
	else kind = "offline_empty";

	return {
		kind,
		dataUsable,
		dataStale:
			dataUsable && (kind === "offline_cached" || kind === "connecting" || kind === "sync_error"),
		transferring,
		hasTransportError,
		lastSyncedAt,
	};
}

export function formatSyncTimestamp(value: Date | null, locale: string): string | null {
	if (!value) return null;
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}
