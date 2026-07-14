import { useStatus } from "@powersync/react";
import { useTranslation } from "@watson/i18n";

/**
 * CC-P0-01 — připravenost dat. `0` a „vše hotovo" jsou OBCHODNÍ TVRZENÍ a smí
 * se vyslovit až po doběhnutí všech podkladových dotazů: undefined běžícího
 * dotazu, prázdná cold-start cache a autoritativní prázdný výsledek nesmí být
 * k nerozeznání (runtime audit: Velín ukázal 0/0 a po sekundách 17/11).
 */
export function useAllReady(...isLoadings: boolean[]): boolean {
	// hasSynced kryje cold start: prázdná lokální DB vrací dotazy okamžitě
	// (isLoading=false), ale před dokončením PRVNÍHO syncu je prázdno
	// „ještě nevím", ne autoritativní nula. Offline s dřívějším syncem = ready
	// (stará data označí SyncStamp), offline BEZ jakéhokoli syncu = neready.
	const status = useStatus();
	const everSynced = status.hasSynced || (!status.connected && status.lastSyncedAt != null);
	return everSynced && isLoadings.every((l) => !l);
}

/** KPI hodnota: před ready pomlčka, ne nula. */
export const kpi = (ready: boolean, n: number | string): string => (ready ? String(n) : "–");

/**
 * Razítko čerstvosti dat: online nic (data jsou živá), offline ukáže čas
 * poslední synchronizace — stará data nesmí vypadat jako aktuální.
 */
export function SyncStamp() {
	const { t } = useTranslation();
	const status = useStatus();
	if (status.connected) return null;
	const at = status.lastSyncedAt
		? new Date(status.lastSyncedAt).toLocaleTimeString("cs-CZ", {
				hour: "2-digit",
				minute: "2-digit",
			})
		: "—";
	return (
		<span
			className="font-mono"
			style={{ fontSize: 10, color: "var(--w-overdue)", whiteSpace: "nowrap" }}
			title={t("common.offlineDataHint")}
		>
			{t("common.offlineDataAsOf", { time: at })}
		</span>
	);
}

/** Neutrální „načítám" místo pozitivního empty state (nesmí tvrdit hotovo). */
export function LoadingNote({ pad = "8px 16px 16px" }: { pad?: string }) {
	const { t } = useTranslation();
	return (
		<div className="font-body text-ink-3" style={{ padding: pad, fontSize: 12.5 }}>
			{t("common.loadingData")}
		</div>
	);
}
