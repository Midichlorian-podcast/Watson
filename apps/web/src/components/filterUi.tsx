/**
 * Sdílené primitivy filtrů — jeden vzhled napříč aplikací (úkoly, mail, …).
 * Cíl: filtr vypadá a ovládá se všude stejně (feedback 2026-07-12: „filtrování
 * matoucí napříč appkou"). Chip = mosazná pilulka (aktivní = brass-soft + okraj).
 */
import type { CSSProperties } from "react";

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
