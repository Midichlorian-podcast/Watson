import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo } from "react";
import type { BulkPreview, BulkSkipReason } from "../lib/bulkCommands";
import { useFocusTrap } from "../lib/useFocusTrap";

const reasonKey: Record<BulkSkipReason, string> = {
	already_applied: "bulk.previewSkipAlreadyApplied",
	already_complete: "bulk.previewSkipAlreadyComplete",
	recurring_requires_scope: "bulk.previewSkipRecurring",
	shared_all_requires_individual: "bulk.previewSkipSharedAll",
	workflow_step_requires_individual: "bulk.previewSkipWorkflow",
	blocked_by_dependency: "bulk.previewSkipBlocked",
};

export function BulkPreviewDialog({
	label,
	preview,
	running,
	onCancel,
	onConfirm,
}: {
	label: string;
	preview: BulkPreview;
	running: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation();
	const trapRef = useFocusTrap<HTMLDivElement>(true);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !running) onCancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onCancel, running]);
	const groupedSkips = useMemo(() => {
		const counts = new Map<BulkSkipReason, number>();
		for (const item of preview.skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
		return [...counts.entries()];
	}, [preview.skipped]);

	return (
		<div className="fixed inset-0 z-[85] grid place-items-center p-2.5" data-esc-layer>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={running ? undefined : onCancel}
				className="absolute inset-0 bg-black/35"
			/>
			<div
				ref={trapRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="bulk-preview-title"
				className="relative max-h-[calc(100dvh-20px)] w-full max-w-[480px] overflow-auto rounded-[16px] border border-line bg-card shadow-2xl"
			>
				<div className="border-line border-b px-4 py-3.5">
					<div id="bulk-preview-title" className="font-display font-bold text-ink" style={{ fontSize: 16 }}>
						{t("bulk.previewTitle")}
					</div>
					<div className="mt-1 font-body text-ink-3" style={{ fontSize: 12.5 }}>
						{label}
					</div>
				</div>
				<div className="space-y-3 px-4 py-3.5">
					<div className="grid grid-cols-3 gap-2">
						<Metric value={preview.selectedCount} label={t("bulk.previewSelected")} />
						<Metric value={preview.applyCount} label={t("bulk.previewWillChange")} />
						<Metric value={preview.skippedCount} label={t("bulk.previewSkipped")} />
					</div>
					{preview.treeCount > preview.selectedCount && (
						<Notice tone="neutral">
							{t("bulk.previewCascade", { count: preview.treeCount - preview.selectedCount })}
						</Notice>
					)}
					{preview.warnings.map((warning) => (
						<Notice key={warning} tone="warning">
							{t(`bulk.previewWarning.${warning}`)}
						</Notice>
					))}
					{preview.conflicts.map((conflict) => (
						<Notice key={conflict.code} tone="danger">
							{t(`bulk.previewConflict.${conflict.code}`, { count: conflict.taskIds.length })}
						</Notice>
					))}
					{groupedSkips.length > 0 && (
						<div className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
							<div className="font-display font-bold text-ink-2" style={{ fontSize: 12 }}>
								{t("bulk.previewWhySkipped")}
							</div>
							<ul className="mt-1.5 space-y-1 font-body text-ink-3" style={{ fontSize: 12 }}>
								{groupedSkips.map(([reason, count]) => (
									<li key={reason}>• {t(reasonKey[reason], { count })}</li>
								))}
							</ul>
						</div>
					)}
					{preview.items.length > 0 && (
						<div>
							<div className="font-display font-bold text-ink-2" style={{ fontSize: 12 }}>
								{t("bulk.previewAffected")}
							</div>
							<ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl border border-line">
								{preview.items.slice(0, 6).map((item) => (
									<li key={item.id} className="truncate px-3 py-2 font-body text-ink-2" style={{ fontSize: 12.5 }}>
										{item.name}
									</li>
								))}
							</ul>
							{preview.items.length > 6 && (
								<div className="mt-1 font-body text-ink-3" style={{ fontSize: 11.5 }}>
									{t("bulk.previewAndMore", { count: preview.items.length - 6 })}
								</div>
							)}
						</div>
					)}
				</div>
				<div className="sticky bottom-0 flex justify-end gap-2 border-line border-t bg-card px-4 py-3">
					<button
						type="button"
						onClick={onCancel}
						disabled={running}
						className="min-h-11 rounded-lg border border-line px-4 font-display font-semibold text-ink-2 disabled:opacity-50"
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={!preview.canExecute || running}
						className="min-h-11 rounded-lg bg-brass px-4 font-display font-bold text-white disabled:opacity-50"
					>
						{running ? t("bulk.previewApplying") : t("bulk.previewConfirm")}
					</button>
				</div>
			</div>
		</div>
	);
}

function Metric({ value, label }: { value: number; label: string }) {
	return (
		<div className="rounded-xl border border-line bg-panel-2 px-2 py-2.5 text-center">
			<div className="font-display font-bold text-ink" style={{ fontSize: 18 }}>{value}</div>
			<div className="font-body text-ink-3" style={{ fontSize: 10.5 }}>{label}</div>
		</div>
	);
}

function Notice({ children, tone }: { children: string; tone: "neutral" | "warning" | "danger" }) {
	const style = tone === "danger"
		? { borderColor: "var(--w-overdue)", color: "var(--w-overdue)" }
		: tone === "warning"
			? { borderColor: "var(--w-brass)", color: "var(--w-brass-text)" }
			: undefined;
	return (
		<div className="rounded-xl border border-line bg-panel-2 px-3 py-2.5 font-body text-ink-2" style={{ fontSize: 12, ...style }}>
			{children}
		</div>
	);
}
