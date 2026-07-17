import { useTranslation } from "@watson/i18n";

/**
 * CC-P0-08 — permanentní, nezaměnitelné označení demo stavu Mailu (rozhodnutí §15/2,
 * varianta B: týmový seed a akce zůstávají viditelně demo. Osobní Gmail read/send
 * už je skutečný, banner proto přesně odděluje osobní poštu od simulovaných akcí.
 * Musí být vidět bez scrollu na každé mailové obrazovce i v composerech; zmizí až
 * s ověřeným read/send UI pro celý modul.
 * Regresi hlídá src/mail/runClaimsTest.ts.
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
