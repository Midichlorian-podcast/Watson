import { useEffect, useState } from "react";
import { useIsMobile } from "./useIsMobile";

/**
 * Sdílený akční toast (flowToast prototypu, ř. 1082–1084): navy pilulka dole uprostřed
 * s brass tečkou, ~2,8 s. Event-based, ať jde volat i mimo React strom (lib/tasks.ts).
 * Volitelná akce (např. „Zpět") — cílené vrácení poslední změny (V3 save-UX).
 */
const EVT = "watson:toast";

export interface ToastAction {
	label: string;
	onClick: () => void;
}
interface ToastDetail {
	message: string;
	action?: ToastAction;
}

export function showToast(message: string, action?: ToastAction) {
	window.dispatchEvent(
		new CustomEvent<ToastDetail>(EVT, { detail: { message, action } }),
	);
}

export function ActionToast() {
	const isMobile = useIsMobile();
	const [toast, setToast] = useState<ToastDetail | null>(null);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>;
		const h = (e: Event) => {
			setToast((e as CustomEvent<ToastDetail>).detail);
			clearTimeout(timer);
			// s akcí necháme déle (5 s), ať se dá kliknout na „Zpět"
			const ttl = (e as CustomEvent<ToastDetail>).detail.action ? 5000 : 2800;
			timer = setTimeout(() => setToast(null), ttl);
		};
		window.addEventListener(EVT, h);
		return () => {
			window.removeEventListener(EVT, h);
			clearTimeout(timer);
		};
	}, []);
	if (!toast) return null;
	return (
		// z-90 = nejvyšší „feedback" vrstva — toast musí být vidět i nad mail
		// overlayi (62–81) a modály; dřív z-60 mizel pod oknem Nové zprávy
		<div
			data-action-toast
			role="status"
			aria-live="polite"
			className="-translate-x-1/2 fixed bottom-6 left-1/2 z-[90] flex items-center font-display font-semibold"
			style={{
				gap: 8,
				bottom: isMobile ? "calc(70px + env(safe-area-inset-bottom))" : 24,
				maxWidth: "calc(100vw - 24px)",
				background: "var(--w-navy)",
				color: "#fff",
				fontSize: 12.5,
				lineHeight: 1.35,
				textAlign: "center",
				padding: "9px 15px",
				borderRadius: 999,
				boxShadow: "var(--w-shadow)",
				animation: "wPop .18s ease",
			}}
		>
			<span
				className="shrink-0 rounded-full"
				style={{ width: 6, height: 6, background: "var(--w-sidebar-accent)" }}
			/>
			{toast.message}
			{toast.action && (
				<button
					type="button"
					onClick={() => {
						toast.action?.onClick();
						setToast(null);
					}}
					className="font-display font-bold"
					style={{ marginLeft: 4, color: "var(--w-sidebar-accent)" }}
				>
					{toast.action.label}
				</button>
			)}
		</div>
	);
}
