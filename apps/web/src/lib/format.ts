/**
 * Sdílené formátovací utility — dřív zkopírované napříč obrazovkami (audit: DRY).
 */

/** Iniciály ze jména (max 2 slova, velká písmena; „?" pro prázdné). */
export const initials = (name: string): string =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0] ?? "")
		.join("")
		.toUpperCase() || "?";

/** Dvouciferný zápis čísla (00–59 apod.). */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Minuty od půlnoci → „HH:MM". */
export const hhmm = (min: number): string =>
	`${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
