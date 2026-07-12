/**
 * Sdílené primitivy filtrů — jeden vzhled napříč aplikací (úkoly, mail, …).
 * Cíl: filtr vypadá a ovládá se všude stejně (feedback 2026-07-12: „filtrování
 * matoucí napříč appkou"). Chip = mosazná pilulka (aktivní = brass-soft + okraj).
 */
import type { CSSProperties, ReactNode } from "react";

/** Chip/pilulka filtru. `on` = aktivní (mosazná), radius default 8 (999 = plná pilulka). */
export const chipStyle = (on: boolean, radius: string | number = 8): CSSProperties => ({
	display: "inline-flex",
	alignItems: "center",
	gap: 6,
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 12,
	padding: "6px 11px",
	borderRadius: radius,
	border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
	color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
	background: on ? "var(--w-brass-soft)" : "transparent",
	cursor: "pointer",
});

/** Přepínací pilulka UVNITŘ filtr-popoveru (menší než chip). Sdílí úkoly i mail. */
export const pillStyle = (on: boolean, fs = 12, pad = "4px 11px"): CSSProperties => ({
	fontSize: fs,
	padding: pad,
	borderRadius: 999,
	border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
	color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
	background: on ? "var(--w-brass-soft)" : "transparent",
	cursor: "pointer",
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
});

/** Nadpis sekce ve filtr-popoveru (PRIORITA / STAV / FILTRY …) — jeden vzhled všude. */
export function FilterSectionLabel({ children }: { children: ReactNode }) {
	return (
		<div
			className="font-display font-bold uppercase"
			style={{
				fontSize: 10,
				letterSpacing: ".06em",
				marginBottom: 6,
				color: "var(--w-ink-3)",
			}}
		>
			{children}
		</div>
	);
}
