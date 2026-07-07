import { useTranslation } from "@watson/i18n";
import { useEffect, useState } from "react";

/**
 * S3 — když server odmítne zápis (oprávnění/validace), connector op zahodí a další sync
 * vrátí lokální optimistickou změnu. Tady to uživateli oznámíme (ne silent).
 */
export function WriteRejectedToast() {
	const { t } = useTranslation();
	const [show, setShow] = useState(false);

	useEffect(() => {
		let id: ReturnType<typeof setTimeout>;
		const h = () => {
			setShow(true);
			clearTimeout(id);
			id = setTimeout(() => setShow(false), 6000);
		};
		window.addEventListener("watson:write-rejected", h);
		return () => {
			window.removeEventListener("watson:write-rejected", h);
			clearTimeout(id);
		};
	}, []);

	if (!show) return null;
	return (
		<div
			className="-translate-x-1/2 fixed bottom-4 left-1/2 z-50 flex items-center gap-3 rounded-xl border border-overdue bg-overdue-soft px-4 py-2.5 text-overdue text-sm"
			style={{ boxShadow: "var(--w-shadow)" }}
			role="alert"
		>
			{t("sync.writeRejected")}
			<button
				type="button"
				onClick={() => setShow(false)}
				aria-label={t("common.close")}
				className="font-semibold"
			>
				✕
			</button>
		</div>
	);
}
