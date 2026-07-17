import { useTranslation } from "@watson/i18n";
import { useState } from "react";
import { useAddTask } from "../lib/addTask";
import { captureBookmarklet } from "../lib/capture";
import { usePwaInstall } from "../lib/pwaInstall";
import { showToast } from "../lib/toast";

async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// Permission může být zablokované, starší synchronní fallback ještě může fungovat.
		}
	}
	const field = document.createElement("textarea");
	field.value = text;
	field.setAttribute("readonly", "");
	field.style.position = "fixed";
	field.style.opacity = "0";
	document.body.appendChild(field);
	field.select();
	const copied = document.execCommand("copy");
	field.remove();
	if (!copied) throw new Error("copy failed");
}

const buttonClass =
	"inline-flex min-h-11 items-center justify-center rounded-[9px] border border-line bg-card px-4 py-2 font-display text-xs font-bold text-ink-2 transition-colors hover:border-brass hover:text-brass-text disabled:cursor-default disabled:opacity-65";

export function PwaInstallCard() {
	const { t } = useTranslation();
	const { state, install } = usePwaInstall();
	const { openCapture } = useAddTask();
	const [installing, setInstalling] = useState(false);

	const onInstall = async () => {
		setInstalling(true);
		const result = await install();
		setInstalling(false);
		if (result === "accepted" || result === "installed") showToast(t("pwa.installAccepted"));
		else if (result === "dismissed") showToast(t("pwa.installDismissed"));
		else if (result === "error") showToast(t("pwa.installError"));
	};

	const onCopyBookmarklet = async () => {
		try {
			await copyText(captureBookmarklet(window.location.origin));
			showToast(t("pwa.bookmarkletCopied"));
		} catch {
			showToast(t("pwa.bookmarkletCopyFailed"));
		}
	};

	return (
		<section
			className="overflow-hidden rounded-[13px] border border-line bg-card"
			aria-labelledby="pwa-settings-title"
		>
			<div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
				<div className="min-w-0 flex-1">
					<h3 id="pwa-settings-title" className="m-0 font-display text-sm font-bold text-ink">
						{t("pwa.settingsTitle")}
					</h3>
					<p className="mb-0 mt-1 max-w-2xl font-body text-xs leading-relaxed text-ink-3">
						{state === "installed" ? t("pwa.installedDesc") : t("pwa.installDesc")}
					</p>
				</div>
				{state === "installed" ? (
					<span className="inline-flex min-h-11 items-center rounded-full bg-success-soft px-4 font-display text-xs font-bold text-success-ink">
						{t("pwa.installed")}
					</span>
				) : state === "available" ? (
					<button type="button" className={buttonClass} disabled={installing} onClick={() => void onInstall()}>
						{installing ? t("pwa.installing") : t("pwa.install")}
					</button>
				) : (
					<span className="max-w-xs font-body text-xs leading-relaxed text-ink-3">
						{t("pwa.installUnavailable")}
					</span>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-4 px-5 py-4">
				<div className="min-w-0 flex-1">
					<h3 className="m-0 font-display text-sm font-bold text-ink">{t("pwa.browserCapture")}</h3>
					<p className="mb-0 mt-1 max-w-2xl font-body text-xs leading-relaxed text-ink-3">
						{t("pwa.browserCaptureDesc")}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<button type="button" className={buttonClass} onClick={onCopyBookmarklet}>
						{t("pwa.copyBookmarklet")}
					</button>
					<button type="button" className={buttonClass} onClick={() => openCapture()}>
						{t("pwa.testCapture")}
					</button>
				</div>
			</div>
		</section>
	);
}
