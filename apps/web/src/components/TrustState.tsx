import { useQuery as usePsQuery, useStatus } from "@powersync/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { deriveSyncTrustState, formatSyncTimestamp, type SyncTrustState } from "../lib/syncTrust";

type TrustStateValue = {
	sync: SyncTrustState;
	openProblems: number;
};

const TrustStateContext = createContext<TrustStateValue | null>(null);

function subscribeNetworkStatus(onStoreChange: () => void) {
	window.addEventListener("online", onStoreChange);
	window.addEventListener("offline", onStoreChange);
	return () => {
		window.removeEventListener("online", onStoreChange);
		window.removeEventListener("offline", onStoreChange);
	};
}

const browserOnline = () => navigator.onLine;

export function TrustStateProvider({ children }: { children: ReactNode }) {
	const status = useStatus();
	const online = useSyncExternalStore(subscribeNetworkStatus, browserOnline, () => true);
	const { data: problemRows } = usePsQuery<{ count: number | string }>(
		"SELECT COUNT(*) AS count FROM local_rejected_ops WHERE status = 'open'",
	);
	const openProblems = Number(problemRows?.[0]?.count ?? 0);
	const sync = deriveSyncTrustState({
		connected: status.connected,
		connecting: status.connecting,
		browserOnline: online,
		hasSynced: status.hasSynced,
		lastSyncedAt: status.lastSyncedAt,
		dataFlowStatus: status.dataFlowStatus,
	});
	const value = { sync, openProblems: Number.isFinite(openProblems) ? openProblems : 0 };
	return <TrustStateContext.Provider value={value}>{children}</TrustStateContext.Provider>;
}

export function useTrustState(): TrustStateValue {
	const value = useContext(TrustStateContext);
	if (!value) throw new Error("useTrustState must be used inside TrustStateProvider");
	return value;
}

function useTrustCopy() {
	const { t, i18n } = useTranslation();
	const { sync, openProblems } = useTrustState();
	const locale = i18n.resolvedLanguage ?? i18n.language ?? "cs";
	const timestamp = formatSyncTimestamp(sync.lastSyncedAt, locale) ?? t("sync.timeUnknown");
	const syncLabel = {
		starting: t("sync.stateStarting"),
		connecting: t("sync.stateConnecting"),
		initial_sync: t("sync.stateInitial"),
		syncing: t("sync.stateSyncing"),
		synced: t("sync.stateSynced"),
		sync_error: t("sync.stateError"),
		offline_cached: t("sync.stateOfflineCached"),
		offline_empty: t("sync.stateOfflineEmpty"),
	}[sync.kind];
	const label = openProblems > 0 ? t("sync.stateAttention", { count: openProblems }) : syncLabel;
	return { t, sync, openProblems, timestamp, label, syncLabel };
}

/** Stav aplikace u loga. Text je viditelný i bez rozlišení barvy. */
export function SidebarTrustState({ collapsed, appName }: { collapsed: boolean; appName: string }) {
	const { sync, openProblems, label, timestamp } = useTrustCopy();
	const attention = openProblems > 0 || sync.kind === "sync_error";
	const offline = sync.kind === "offline_cached" || sync.kind === "offline_empty";
	const color = attention
		? "var(--w-overdue)"
		: offline
			? "var(--w-sidebar-accent)"
			: sync.kind === "synced"
				? "var(--w-success)"
				: "var(--w-brass)";
	const title = sync.dataStale ? `${label} · ${timestamp}` : label;
	return (
		<div
			role="status"
			aria-live="polite"
			aria-label={title}
			title={title}
			style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1 }}
		>
			<span
				aria-hidden
				style={{
					width: 9,
					height: 9,
					borderRadius: "50%",
					flex: "none",
					background: color,
					boxShadow: attention
						? `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)`
						: undefined,
				}}
			/>
			{!collapsed && (
				<div style={{ minWidth: 0, flex: 1 }}>
					<div
						className="truncate font-display"
						style={{
							fontWeight: 800,
							fontSize: 18,
							lineHeight: 1.05,
							color: "var(--w-sidebar-ink)",
						}}
					>
						{appName}
					</div>
					<div
						className="truncate font-body"
						style={{
							marginTop: 3,
							fontSize: 10.5,
							lineHeight: 1.1,
							color: "var(--w-sidebar-ink-2)",
						}}
					>
						{label}
					</div>
				</div>
			)}
		</div>
	);
}

type Notice = {
	key: "sync_problems" | "offline_cached" | "connecting_cached" | "sync_error_cached";
	tone: "warning" | "danger";
	text: string;
};

/**
 * Globální pravdivostní lišta. Zdravý stav prostor nezabírá; zobrazí jen cache,
 * chybu přenosu nebo změny vyžadující zásah.
 */
export function TrustStateBanner() {
	const { t, sync, openProblems, timestamp } = useTrustCopy();
	const notices: Notice[] = [];
	if (openProblems > 0) {
		notices.push({
			key: "sync_problems",
			tone: "danger",
			text: t("sync.bannerProblems", { count: openProblems }),
		});
	}
	if (sync.dataUsable && sync.kind === "offline_cached") {
		notices.push({
			key: "offline_cached",
			tone: "warning",
			text: t("sync.bannerOffline", { time: timestamp }),
		});
	}
	if (sync.dataUsable && sync.kind === "connecting") {
		notices.push({
			key: "connecting_cached",
			tone: "warning",
			text: t("sync.bannerConnecting", { time: timestamp }),
		});
	}
	if (sync.dataUsable && sync.kind === "sync_error") {
		notices.push({
			key: "sync_error_cached",
			tone: "danger",
			text: t("sync.bannerError", { time: timestamp }),
		});
	}
	if (notices.length === 0) return null;

	return (
		<div aria-live="polite" style={{ flex: "none" }}>
			{notices.map((notice) => (
				<div
					key={notice.key}
					data-trust-notice={notice.key}
					role="status"
					className="flex flex-wrap items-center justify-center font-body"
					style={{
						gap: "4px 10px",
						minHeight: 34,
						padding: "7px 14px",
						borderBottom: `1px solid ${notice.tone === "danger" ? "var(--w-overdue)" : "var(--w-brass)"}`,
						background: notice.tone === "danger" ? "var(--w-overdue-soft)" : "var(--w-brass-soft)",
						color: notice.tone === "danger" ? "var(--w-overdue)" : "var(--w-brass-text)",
						fontSize: 11.5,
						lineHeight: 1.35,
						textAlign: "center",
					}}
				>
					<span aria-hidden>{notice.tone === "danger" ? "!" : "◌"}</span>
					<span>{notice.text}</span>
					{notice.key === "sync_problems" && (
						<Link
							to="/nastaveni"
							search={{ sekce: "data" }}
							hash="sync-problems-title"
							className="font-display font-bold underline underline-offset-2"
						>
							{t("sync.openProblems")}
						</Link>
					)}
				</div>
			))}
		</div>
	);
}

export function SyncUnavailable() {
	const { t, sync } = useTrustCopy();
	const transportError = sync.kind === "sync_error";
	return (
		<div
			role="status"
			className="grid min-h-full place-items-center"
			style={{ padding: "48px 20px" }}
		>
			<div style={{ maxWidth: 430, textAlign: "center" }}>
				<div
					aria-hidden
					className="mx-auto grid place-items-center rounded-full font-display font-bold"
					style={{
						width: 44,
						height: 44,
						background: transportError ? "var(--w-overdue-soft)" : "var(--w-brass-soft)",
						color: transportError ? "var(--w-overdue)" : "var(--w-brass-text)",
					}}
				>
					{transportError ? "!" : "◌"}
				</div>
				<h2 className="mt-4 font-display font-extrabold text-ink" style={{ fontSize: 18 }}>
					{transportError ? t("sync.unavailableErrorTitle") : t("sync.unavailableOfflineTitle")}
				</h2>
				<p className="mt-2 font-body text-ink-3" style={{ fontSize: 13, lineHeight: 1.55 }}>
					{transportError ? t("sync.unavailableErrorDesc") : t("sync.unavailableOfflineDesc")}
				</p>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="mt-4 min-h-11 rounded-lg bg-brass px-4 font-display font-bold text-white hover:brightness-105"
				>
					{t("common.retry")}
				</button>
			</div>
		</div>
	);
}
