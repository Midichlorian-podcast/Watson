/**
 * Paleta barev textu pro mailový composer — jedna sada VŠUDE (Nová zpráva,
 * odpověď ve vlákně, peek). Pevný výběr čitelný v light i dark (ne volný picker),
 * aby text zůstal kontrastní a šel bezpečně sanitizovat.
 */
export const TEXT_COLORS: { css: string; label: string }[] = [
	{ css: "#2A2620", label: "Výchozí" },
	{ css: "#BE4A34", label: "Červená" },
	{ css: "#C4892A", label: "Oranžová" },
	{ css: "#5E8C55", label: "Zelená" },
	{ css: "#3A6EA5", label: "Modrá" },
	{ css: "#7A5AA6", label: "Fialová" },
	{ css: "#8C8375", label: "Šedá" },
];
