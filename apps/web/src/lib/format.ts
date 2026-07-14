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
export const hhmm = (min: number): string => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/** Krátký den „po 14. 7." dle jazyka aplikace (sdílí Meets přehled, detail i toasty). */
export const shortDayLabel = (iso: string, lang: string): string => {
	const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
	if (!y || !mo || !d) return iso;
	return new Intl.DateTimeFormat(lang, {
		weekday: "short",
		day: "numeric",
		month: "numeric",
	}).format(new Date(y, mo - 1, d));
};
