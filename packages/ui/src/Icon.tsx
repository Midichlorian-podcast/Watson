import type { CSSProperties } from "react";

/**
 * Tahová ikonová sada Watsona (24×24, stroke, linecap butt) — zdroj: prototyp `ICONP`
 * (design/handoff_watson/WatsonApp.dc.html). Brass akcent `#c68a3e` u vybraných.
 */
export const ICONS = {
	projekt: '<path d="M3 6.5 H9.2 L11.4 9 H21 V19 H3 Z"/>',
	termin:
		'<rect x="4" y="5.2" width="16" height="14.8" rx="1.4"/><line x1="4" y1="9.6" x2="20" y2="9.6"/><line x1="8.4" y1="3.2" x2="8.4" y2="6.6"/><line x1="15.6" y1="3.2" x2="15.6" y2="6.6"/><circle cx="9" cy="14" r="1.35" fill="#c68a3e" stroke="none"/>',
	priorita:
		'<line x1="6" y1="3" x2="6" y2="21"/><path d="M6 4.5 H18 L15 8 L18 11.5 H6 Z"/>',
	prirazeni:
		'<circle cx="12" cy="8.2" r="3.4"/><path d="M5.6 20 C5.6 16.2 8.2 14.2 12 14.2 C15.8 14.2 18.4 16.2 18.4 20"/>',
	trvani:
		'<line x1="7" y1="4" x2="17" y2="4"/><line x1="7" y1="20" x2="17" y2="20"/><path d="M7.6 4.5 C7.6 9 11 11 11 12 C11 13 7.6 15 7.6 19.5"/><path d="M16.4 4.5 C16.4 9 13 11 13 12 C13 13 16.4 15 16.4 19.5"/>',
	deadline:
		'<circle cx="12" cy="12.4" r="7.6"/><path d="M12 7.6 V12.4 L15.4 14.2"/>',
	opakovani:
		'<path d="M5 12 A7 7 0 0 1 15.6 6"/><path d="M15.6 3 V6.3 H12.3"/><path d="M19 12 A7 7 0 0 1 8.4 18"/><path d="M8.4 21 V17.7 H11.7"/>',
	barva:
		'<path d="M12 3.4 C12 3.4 6.2 10 6.2 14.2 A5.8 5.8 0 0 0 17.8 14.2 C17.8 10 12 3.4 12 3.4 Z"/>',
	priloha:
		'<path d="M14.6 7.4 L8.4 13.6 A3 3 0 0 0 12.6 17.8 L18.4 12 A5 5 0 0 0 11.4 4.9 L5.8 10.5"/>',
	postup:
		'<line x1="7.7" y1="12" x2="9.8" y2="12"/><line x1="14.2" y1="12" x2="16.3" y2="12"/><circle cx="5.4" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="18.6" cy="12" r="2.3" fill="#c68a3e" stroke="none"/>',
	popis:
		'<line x1="5" y1="7.5" x2="19" y2="7.5"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16.5" x2="13.5" y2="16.5"/>',
	pridat:
		'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
	hotovo: '<path d="M5 12.5 L10 17.5 L19 6.8"/>',
	upravit:
		'<path d="M5 19 L5.6 15.4 L16 5 A1.4 1.4 0 0 1 19 8 L8.6 18.4 Z"/><line x1="13.4" y1="7.6" x2="16.4" y2="10.6"/>',
	duplikovat:
		'<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 14.5 A1.5 1.5 0 0 1 3.5 13 V5 A1.5 1.5 0 0 1 5 3.5 H13 A1.5 1.5 0 0 1 14.5 5"/>',
	smazat:
		'<line x1="5" y1="7" x2="19" y2="7"/><path d="M8 7 V5.6 A1.1 1.1 0 0 1 9.1 4.5 H14.9 A1.1 1.1 0 0 1 16 5.6 V7"/><path d="M6.6 7 L7.4 18.8 A1.6 1.6 0 0 0 9 20.4 H15 A1.6 1.6 0 0 0 16.6 18.8 L17.4 7"/>',
	odkaz:
		'<path d="M10.5 13.5 A3.6 3.6 0 0 1 10.5 8.4 L13.2 5.7 A3.8 3.8 0 0 1 18.5 11 L16.8 12.7"/><path d="M13.5 10.5 A3.6 3.6 0 0 1 13.5 15.6 L10.8 18.3 A3.8 3.8 0 0 1 5.5 13 L7.2 11.3"/>',
	vice: '<circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
	zavrit:
		'<line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5"/>',
	hledat:
		'<circle cx="10.5" cy="10.5" r="6"/><line x1="15" y1="15" x2="20" y2="20"/>',
	schranka:
		'<path d="M4 13.2 L6.6 5.4 A1 1 0 0 1 7.5 4.8 H16.5 A1 1 0 0 1 17.4 5.4 L20 13.2 V18.6 A1.2 1.2 0 0 1 18.8 19.8 H5.2 A1.2 1.2 0 0 1 4 18.6 Z"/><path d="M4 13.2 H8.2 L9.6 16 H14.4 L15.8 13.2 H20"/>',
	dnes: '<line x1="3.6" y1="18.4" x2="20.4" y2="18.4"/><path d="M7.6 18.4 A4.4 4.4 0 0 1 16.4 18.4"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="5.6" y1="9.2" x2="6.9" y2="10.2"/><line x1="18.4" y1="9.2" x2="17.1" y2="10.2"/>',
	nadchazejici:
		'<rect x="4" y="5.2" width="16" height="14.8" rx="1.4"/><line x1="4" y1="9.6" x2="20" y2="9.6"/><line x1="8.4" y1="3.2" x2="8.4" y2="6.6"/><line x1="15.6" y1="3.2" x2="15.6" y2="6.6"/><path d="M10.8 15.4 H13.6"/><path d="M12.3 14 L13.7 15.4 L12.3 16.8"/>',
	ukoly:
		'<path d="M4 7 L5.4 8.4 L7.8 6"/><line x1="10.5" y1="7.3" x2="20" y2="7.3"/><path d="M4 13 L5.4 14.4 L7.8 12"/><line x1="10.5" y1="13.3" x2="20" y2="13.3"/><line x1="10.5" y1="18.6" x2="20" y2="18.6"/><line x1="4.4" y1="18.6" x2="7.8" y2="18.6"/>',
	projekty:
		'<rect x="3.8" y="3.8" width="7" height="7" rx="1.4"/><rect x="13.2" y="3.8" width="7" height="7" rx="1.4" fill="#c68a3e" stroke="none"/><rect x="3.8" y="13.2" width="7" height="7" rx="1.4"/><rect x="13.2" y="13.2" width="7" height="7" rx="1.4"/>',
	tym: '<circle cx="9" cy="9.2" r="3"/><path d="M3.6 19 C3.6 15.6 6 13.7 9 13.7 C12 13.7 14.4 15.6 14.4 19"/><circle cx="16.6" cy="9.6" r="2.4"/><path d="M15.2 13.9 C18.6 13.9 20.4 15.9 20.4 19"/>',
	cile: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.4" fill="#c68a3e" stroke="none"/>',
	reporty:
		'<line x1="4" y1="20" x2="20.4" y2="20"/><line x1="7.2" y1="20" x2="7.2" y2="13" stroke-width="2.4"/><line x1="12" y1="20" x2="12" y2="8" stroke-width="2.4"/><line x1="16.8" y1="20" x2="16.8" y2="15" stroke-width="2.4"/>',
	nastaveni:
		'<line x1="4" y1="8.5" x2="20" y2="8.5"/><line x1="4" y1="15.5" x2="20" y2="15.5"/><circle cx="9" cy="8.5" r="2.4" fill="var(--w-card)"/><circle cx="15" cy="15.5" r="2.4" fill="var(--w-card)"/>',
	zvonek:
		'<path d="M6.6 17 C6.6 11.2 7.8 8.6 12 8.6 C16.2 8.6 17.4 11.2 17.4 17 Z"/><line x1="5" y1="17" x2="19" y2="17"/><path d="M10.2 20 A2.1 2.1 0 0 0 13.8 20"/><line x1="12" y1="6" x2="12" y2="8.6"/>',
	motiv:
		'<circle cx="12" cy="12" r="7.4"/><path d="M12 4.6 A7.4 7.4 0 0 0 12 19.4 Z" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG ikona z `ICONS`. Dědí barvu přes `currentColor`. */
export function Icon({
	name,
	size = 18,
	className,
	style,
}: {
	name: IconName;
	size?: number;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.9}
			strokeLinecap="butt"
			strokeLinejoin="round"
			className={className}
			style={{ flexShrink: 0, ...style }}
			aria-hidden="true"
			// biome-ignore lint: statické SVG cesty z naší vlastní sady (ne uživatelský vstup)
			dangerouslySetInnerHTML={{ __html: ICONS[name] }}
		/>
	);
}
