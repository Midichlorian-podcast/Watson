import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { useEffect, useRef } from "react";
import { useAddTask } from "../lib/addTask";
import { capturePrefill } from "../lib/capture";

/** One-shot ingress for OS Share Target and the browser bookmarklet. */
export function CaptureIngress() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const search = useSearch({ from: "/zachytit" });
	const { openCapture } = useAddTask();
	const consumed = useRef(false);
	useEffect(() => {
		if (consumed.current) return;
		consumed.current = true;
		openCapture(capturePrefill(search));
		void navigate({ to: "/", search: {}, replace: true });
	}, [navigate, openCapture, search]);
	return (
		<div className="grid min-h-[40vh] place-items-center p-6 font-body text-sm text-ink-3" role="status">
			{t("pwa.preparingCapture")}
		</div>
	);
}
