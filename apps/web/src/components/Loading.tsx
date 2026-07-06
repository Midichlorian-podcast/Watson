import { useStatus } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { type ReactNode, useEffect, useState } from "react";

/** Nenápadný brass spinner (SVG, respektuje prefers-reduced-motion přes CSS). */
export function Spinner({ size = 22 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			className="watson-spin"
			aria-hidden
		>
			<circle cx="12" cy="12" r="9" stroke="var(--w-line)" strokeWidth="2.4" />
			<path
				d="M12 3a9 9 0 0 1 9 9"
				stroke="var(--w-brass)"
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/**
 * Gate první synchronizace: dokud je klient připojený a NEMÁ za sebou první sync,
 * zobrazí spinner místo bliknutí prázdné obrazovky. Offline (nepřipojeno) NEblokuje —
 * vykreslí lokální data, jinak by app při startu bez sítě visela. (Audit: chyběly loading stavy.)
 */
export function SyncGate({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const status = useStatus();
	// Krátká prodleva, ať spinner nebliká, když data dorazí z lokální cache okamžitě.
	const [showAfterDelay, setShowAfterDelay] = useState(false);
	useEffect(() => {
		const id = setTimeout(() => setShowAfterDelay(true), 250);
		return () => clearTimeout(id);
	}, []);

	const firstSyncing = !!status?.connected && !status?.hasSynced;
	if (firstSyncing && showAfterDelay) {
		return (
			<div
				className="grid min-h-full place-items-center"
				style={{ padding: 40 }}
			>
				<div className="flex flex-col items-center" style={{ gap: 12 }}>
					<Spinner size={26} />
					<span className="font-body text-ink-3" style={{ fontSize: 12.5 }}>
						{t("shell.syncing")}
					</span>
				</div>
			</div>
		);
	}
	return <>{children}</>;
}
