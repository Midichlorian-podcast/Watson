import { useTranslation } from "@watson/i18n";
import type { CSSProperties } from "react";
import { formatSyncTimestamp } from "../lib/syncTrust";
import { useTrustState } from "./TrustState";

export type KpiDefinition = {
	scope: string;
	period: string;
	timeZone: string;
	exclusions: string;
	formula: string;
	/** Zdroj mimo PowerSync (např. lokální Mail demo) musí přiznat vlastní čerstvost. */
	freshness?: string;
};

export function useKpiFreshness(): string {
	const { t, i18n } = useTranslation();
	const { sync } = useTrustState();
	const locale = i18n.resolvedLanguage ?? i18n.language ?? "cs";
	const timestamp = formatSyncTimestamp(sync.lastSyncedAt, locale) ?? t("metrics.timeUnknown");
	switch (sync.kind) {
		case "synced":
			return t("metrics.freshSynced", { time: timestamp });
		case "syncing":
			return t("metrics.freshSyncing", { time: timestamp });
		case "offline_cached":
			return t("metrics.freshOffline", { time: timestamp });
		case "sync_error":
			return t("metrics.freshError", { time: timestamp });
		default:
			return t("metrics.freshPending");
	}
}

export function KpiCard({
	value,
	label,
	color = "var(--w-ink)",
	definition,
	compact = false,
	style,
}: {
	value: string;
	label: string;
	color?: string;
	definition: KpiDefinition;
	compact?: boolean;
	style?: CSSProperties;
}) {
	const { t } = useTranslation();
	const syncedFreshness = useKpiFreshness();
	const metadata = [
		[t("metrics.scope"), definition.scope],
		[t("metrics.period"), definition.period],
		[t("metrics.timeZone"), definition.timeZone],
		[t("metrics.exclusions"), definition.exclusions],
		[t("metrics.freshness"), definition.freshness ?? syncedFreshness],
	] as const;
	return (
		<article
			data-kpi-card
			aria-label={`${label}: ${value}`}
			className="min-w-0 rounded-[13px] border border-line bg-card"
			style={{ padding: compact ? 13 : 16, ...style }}
		>
			<div className="flex items-baseline justify-between gap-3">
				<div className="font-mono" style={{ fontSize: compact ? 23 : 28, lineHeight: 1, color }}>
					{value}
				</div>
				<div className="text-right font-display font-semibold text-ink" style={{ fontSize: 12.5 }}>
					{label}
				</div>
			</div>
			<dl
				data-kpi-definition
				className="mt-3 grid border-line border-t pt-2.5 font-body"
				style={{ gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "4px 9px", fontSize: 10.5 }}
			>
				{metadata.map(([term, description]) => (
					<div key={term} className="contents">
						<dt className="font-semibold text-ink-3">{term}</dt>
						<dd className="min-w-0 text-ink-2">{description}</dd>
					</div>
				))}
			</dl>
			<p data-kpi-formula className="mt-2.5 font-body text-ink-3" style={{ fontSize: 10.5, lineHeight: 1.4 }}>
				<span className="font-semibold">{t("metrics.formula")}:</span> {definition.formula}
			</p>
		</article>
	);
}
