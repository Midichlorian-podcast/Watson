/**
 * Mail — náhled deep linku bez přístupu (L-22; prototyp hostPrevOn, ř. 1947–1960).
 * Celoobrazovkový overlay „co uvidí host/cizí": žádný název vlákna, žádná
 * schránka, žádné „požádej o přístup" — obsah bez oprávnění v UI neexistuje.
 */
import { useOverlayLayer } from "../lib/useOverlayLayer";

export function HostPreview({ onClose }: { onClose: () => void }) {
	const dialogRef = useOverlayLayer<HTMLDivElement>(true, onClose);

	return (
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-label="Deep link bez přístupu"
			data-esc-layer
			data-screen-label="Deep link bez přístupu"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: "var(--w-layer-nested)",
				background: "#17283f",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				animation: "wFade .15s ease",
			}}
		>
			<div style={{ textAlign: "center", maxWidth: 340, padding: 24 }}>
				<div
					style={{
						width: 44,
						height: 44,
						borderRadius: "50%",
						border: "2px solid rgba(255,255,255,.35)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						margin: "0 auto 14px",
					}}
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 12 12"
						fill="none"
						stroke="rgba(255,255,255,.7)"
						strokeWidth="1.2"
						aria-hidden
					>
						<rect x="2.2" y="5" width="7.6" height="5.2" rx="1.2" />
						<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" />
					</svg>
				</div>
				<div
					style={{
						fontFamily: "var(--w-font-display)",
						fontWeight: 700,
						fontSize: 16,
						color: "#fff",
					}}
				>
					Tento odkaz pro tebe nic neobsahuje
				</div>
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 12.5,
						color: "rgba(255,255,255,.65)",
						lineHeight: 1.6,
						marginTop: 8,
					}}
				>
					Žádný název vlákna, žádná schránka, žádné „požádej o přístup" — obsah, na který nemáš
					oprávnění, v UI neexistuje.
				</div>
				<button type="button"
					onClick={onClose}
					data-ghost
					style={{
						display: "inline-flex",
						fontSize: 12,
						padding: "8px 16px",
						marginTop: 18,
						color: "#fff",
						borderColor: "rgba(255,255,255,.35)",
						background: "transparent",
					}}
				>
					Zavřít náhled
				</button>
				<div
					style={{
						fontFamily: "var(--w-font-mono)",
						fontSize: 9,
						color: "rgba(255,255,255,.4)",
						marginTop: 14,
					}}
				>
					demo — takhle vypadá deep link pro hosta či kolegu bez grantu
				</div>
			</div>
		</div>
	);
}
