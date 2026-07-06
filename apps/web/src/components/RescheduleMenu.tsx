import { useTranslation } from "@watson/i18n";
import { useEffect, useRef, useState } from "react";
import {
	RESCHEDULE_OPTIONS,
	type RescheduleKey,
	rescheduleDate,
} from "../lib/reschedule";

/**
 * Popover „Přeplánovat na…" — víc voleb než jen dnes (zítra / víkend / příští pondělí /
 * za týden / začátek příštího měsíce / vlastní datum). onPick dostane cílový ISO den.
 */
export function RescheduleMenu({
	anchor,
	onPick,
	onClose,
}: {
	/** Text spouštěče (button); volitelně vlastní přes children není potřeba. */
	anchor: string;
	onPick: (iso: string) => void;
	onClose?: () => void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState("");
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const h = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
				onClose?.();
			}
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [open, onClose]);

	const pick = (key: RescheduleKey) => {
		onPick(rescheduleDate(key));
		setOpen(false);
	};

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="font-display font-semibold text-brass-text hover:underline"
				style={{ fontSize: 12 }}
			>
				{anchor}
			</button>
			{open && (
				<div
					className="absolute right-0 z-30 rounded-xl border border-line bg-card"
					style={{
						top: 26,
						width: 210,
						padding: 6,
						boxShadow: "var(--w-shadow)",
					}}
				>
					{RESCHEDULE_OPTIONS.map((o) => (
						<button
							key={o.key}
							type="button"
							onClick={() => pick(o.key)}
							className="flex w-full items-center justify-between rounded-lg text-left font-body text-ink hover:bg-panel-2"
							style={{ padding: "7px 10px", fontSize: 13 }}
						>
							<span>{t(o.labelKey)}</span>
							<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
								{rescheduleDate(o.key).slice(8, 10)}.
								{+rescheduleDate(o.key).slice(5, 7)}.
							</span>
						</button>
					))}
					<div className="mt-1 border-line border-t pt-1">
						<div
							className="font-display font-bold text-ink-3 uppercase"
							style={{
								fontSize: 9.5,
								letterSpacing: ".05em",
								padding: "4px 10px 2px",
							}}
						>
							{t("reschedule.customDate")}
						</div>
						<div
							className="flex items-center gap-1.5"
							style={{ padding: "2px 8px 4px" }}
						>
							<input
								type="date"
								value={custom}
								onChange={(e) => setCustom(e.target.value)}
								className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-ink outline-none focus:border-brass"
								style={{ fontSize: 12 }}
							/>
							<button
								type="button"
								disabled={!custom}
								onClick={() => {
									if (custom) {
										onPick(custom);
										setOpen(false);
									}
								}}
								className="rounded-md font-display font-bold text-white hover:brightness-105 disabled:opacity-40"
								style={{
									background: "var(--w-brass)",
									padding: "5px 9px",
									fontSize: 12,
								}}
							>
								{t("reschedule.set")}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
