/**
 * Mail — tahák klávesových zkratek (Modul 12, jen ke čtení; prototyp markup
 * ř. 2188–2205 + řádky kbVals ř. 4420–4434). Centrovaná karta se scrimem,
 * kbd styl dodává mail.css ([data-wm-theme] kbd).
 */
import { useOverlayLayer } from "../lib/useOverlayLayer";

/** Řádky zkratek dle prototypu (kbVals.rows) + O/Enter, Esc dle handoff auditu. */
const ROWS: { k: string; l: string }[] = [
	{ k: "/ nebo ⌘K", l: "hledat v poště" },
	{ k: "J / K", l: "další / předchozí konverzace" },
	{ k: "O / Enter", l: "otevřít vybranou" },
	{ k: "R", l: "odpovědět" },
	{ k: "E", l: "archivovat" },
	{ k: "H", l: "hotovo" },
	{ k: "D / P", l: "připnout / odepnout" },
	{ k: "M", l: "ztlumit vlákno" },
	{ k: "S", l: "odložit na zítra" },
	{ k: "U", l: "přečtené / nepřečtené" },
	{ k: "C", l: "nová zpráva" },
	{ k: "X", l: "vybrat do hromadných akcí" },
	{ k: "⌘Enter", l: "odeslat rozepsanou odpověď" },
	{ k: "Esc", l: "zavřít okno / zrušit výběr" },
	{ k: "?", l: "tento přehled" },
];

export function CheatSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const overlayRef = useOverlayLayer<HTMLDivElement>(open, onClose);

	if (!open) return null;

	return (
		<div
			data-esc-layer
			style={{
				position: "fixed",
				inset: 0,
				zIndex: "var(--w-layer-nested)",
				animation: "wFade .12s ease",
			}}
		>
			<button
				type="button"
				aria-label="Zavřít zkratky"
				onClick={onClose}
				style={{ position: "absolute", inset: 0, border: 0, background: "rgba(23,40,63,.32)" }}
			/>
			<div
				ref={overlayRef}
				role="dialog"
				aria-modal="true"
				aria-label="Klávesové zkratky"
				data-screen-label="Zkratky"
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%,-50%)",
					zIndex: "calc(var(--w-layer-nested) + 1)",
					width: "min(420px, 94vw)",
					maxHeight: "88vh",
					overflow: "auto",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "var(--shadow)",
					animation: "wPop .14s ease",
					padding: "16px 18px 14px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
					<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 14, color: "var(--ink)", flex: 1 }}>
						Klávesové zkratky
					</span>
					<button type="button"
						onClick={onClose}
						aria-label="Zavřít zkratky"
						title="Zavřít (Esc)"
						style={{ width: 44, height: 44, border: 0, background: "transparent", fontSize: 16, lineHeight: 1, color: "var(--ink-3)", cursor: "pointer" }}
					>
						×
					</button>
				</div>
				{ROWS.map((r) => (
					<div key={r.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
						<kbd>{r.k}</kbd>
						<span style={{ fontFamily: "var(--w-font-body)", fontSize: 12, color: "var(--ink-2)" }}>
							{r.l}
						</span>
					</div>
				))}
				<div style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)", marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--line)", lineHeight: 1.6 }}>
					Swipe: krátký/dlouhý tah po řádku (mapování v Nastavení). Pravý klik či
					ťuknutí dvěma prsty na řádek otevře kontextové menu. Víc v Příručce.
				</div>
			</div>
		</div>
	);
}
