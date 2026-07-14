import { useTranslation } from "@watson/i18n";

/**
 * CC-P0-08 — permanentní, nezaměnitelné označení demo stavu Mailu (rozhodnutí §15/2,
 * varianta B: modul viditelný, ale nesmí tvrdit reálné připojení/odeslání/šifrování).
 * Musí být vidět bez scrollu na každé mailové obrazovce i v composerech; zmizí až
 * s reálným mail backendem (M1), ne dřív. Regresi hlídá src/mail/runClaimsTest.ts.
 */
export function MailDemoBanner({ compact }: { compact?: boolean }) {
	const { t } = useTranslation();
	return (
		<div
			role="status"
			data-mail-demo-banner
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				flex: "none",
				padding: compact ? "3px 10px" : "5px 14px",
				fontFamily: "var(--w-font-mono)",
				fontSize: compact ? 10.5 : 11.5,
				letterSpacing: 0.2,
				background: "var(--w-brass-soft)",
				borderBottom: "1px solid var(--line)",
				color: "var(--ink)",
			}}
		>
			<strong style={{ fontWeight: 700 }}>{t("mail.demoBadge")}</strong>
			<span style={{ opacity: 0.85, minWidth: 0 }}>{t("mail.demoBanner")}</span>
		</div>
	);
}
