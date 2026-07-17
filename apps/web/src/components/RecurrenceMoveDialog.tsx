import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	executeRecurrenceMove,
	previewRecurrenceMove,
	RecurrenceApiError,
	type RecurrencePreview,
	type RecurrencePreviewInput,
	undoRecurrenceMove,
} from "../lib/recurrenceCommands";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";

function scheduleLabel(
	schedule: { date: string; time: string | null; timeZone: string | null },
	allDayLabel: string,
) {
	const date = new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(`${schedule.date}T12:00:00`));
	return schedule.time
		? `${date} · ${schedule.time}${schedule.timeZone ? ` (${schedule.timeZone})` : ""}`
		: `${date} · ${allDayLabel}`;
}

export function RecurrenceMoveDialog({
	taskId,
	input,
	onClose,
}: {
	taskId: string;
	input: RecurrencePreviewInput;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [preview, setPreview] = useState<RecurrencePreview | null>(null);
	const [scope, setScope] = useState<RecurrencePreviewInput["scope"]>(input.scope);
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const runningRef = useRef(false);
	const scopedInput = useMemo(() => ({ ...input, scope }), [input, scope]);
	const dialogRef = useOverlayLayer<HTMLDivElement>(true, () => {
		if (!runningRef.current) onClose();
	});

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError(null);
		void previewRecurrenceMove(taskId, scopedInput)
			.then((next) => {
				if (active) setPreview(next);
			})
			.catch((reason: unknown) => {
				if (!active) return;
				setError(
					reason instanceof RecurrenceApiError
						? reason.code
						: "recurrence_command_failed",
				);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [taskId, scopedInput]);

	const confirm = async () => {
		if (!preview?.canExecute || runningRef.current) return;
		runningRef.current = true;
		setRunning(true);
		setError(null);
		try {
			const result = await executeRecurrenceMove(taskId, scopedInput, preview.previewHash);
			onClose();
			showToast(t("calendar.recurrenceMoved"), {
				label: t("calendar.recurrenceUndo"),
				onClick: () => {
					void undoRecurrenceMove(taskId, result.batchId)
						.then(() => showToast(t("calendar.recurrenceUndone")))
						.catch(() => showToast(t("calendar.recurrenceUndoFailed")));
				},
			});
		} catch (reason) {
			const code = reason instanceof RecurrenceApiError ? reason.code : "recurrence_command_failed";
			setError(code);
			if (code === "preview_stale") {
				try {
					setPreview(await previewRecurrenceMove(taskId, scopedInput));
				} catch {
					// Ponecháme konkrétní stale chybu; uživatel může dialog bezpečně zavřít.
				}
			}
		} finally {
			runningRef.current = false;
			setRunning(false);
		}
	};

	const warningLabel = (code: string) => {
		const known: Record<string, string> = {
			target_contains_series_occurrence: t("calendar.recurrenceWarningSeriesTarget"),
			target_contains_rescheduled_occurrence: t("calendar.recurrenceWarningMovedTarget"),
			availability_warning: t("calendar.recurrenceWarningAvailability"),
			dst_time_adjusted: t("calendar.recurrenceWarningDst"),
			no_schedule_change: t("calendar.recurrenceNoChange"),
			earlier_occurrences_preserved: t("calendar.recurrenceWarningPrefixPreserved"),
			previous_series_segments_preserved: t("calendar.recurrenceWarningPreviousSegments"),
			series_availability_first_occurrence_only: t(
				"calendar.recurrenceWarningSeriesAvailability",
			),
		};
		return known[code] ?? code;
	};
	const errorLabel = (code: string) => {
		const known: Record<string, string> = {
			preview_stale: t("calendar.recurrenceErrorStale"),
			invalid_or_nonexistent_local_time: t("calendar.recurrenceErrorDst"),
			recurrence_conflict: t("calendar.recurrenceErrorConflict"),
			occurrence_not_in_series: t("calendar.recurrenceErrorMissing"),
			recurrence_command_failed: t("calendar.recurrenceErrorGeneric"),
		};
		return known[code] ?? t("calendar.recurrenceErrorGeneric");
	};

	return (
		<div
			className="fixed inset-0 grid place-items-center p-3"
			style={{ zIndex: "var(--w-layer-critical)" }}
			data-esc-layer
		>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={running ? undefined : onClose}
				className="absolute inset-0 bg-black/40"
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="recurrence-move-title"
				className="relative max-h-[calc(100dvh-24px)] w-full max-w-[520px] overflow-auto rounded-2xl border border-line bg-card shadow-2xl"
			>
				<header className="border-line border-b px-5 py-4">
					<h2 id="recurrence-move-title" className="font-display font-extrabold text-ink text-lg">
						{t("calendar.recurrenceMoveTitle")}
					</h2>
					<p className="mt-1 text-ink-3 text-sm">{t("calendar.recurrenceMoveDesc")}</p>
				</header>

				<div className="space-y-3 px-5 py-4">
					<fieldset disabled={running} className="space-y-2">
						<legend className="font-display font-bold text-ink-3 text-xs uppercase tracking-wide">
							{t("calendar.recurrenceScopeLegend")}
						</legend>
						<div className="grid gap-2 sm:grid-cols-3">
							{(
								[
									["this_occurrence", t("calendar.recurrenceScopeThis")],
									["this_and_future", t("calendar.recurrenceScopeFuture")],
									["all", t("calendar.recurrenceScopeAll")],
								] as const
							).map(([value, label]) => (
								<label
									key={value}
									className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm"
									style={{
										borderColor: scope === value ? "var(--w-brass)" : "var(--w-line)",
										background: scope === value ? "var(--w-brass-soft)" : "var(--w-card)",
									}}
								>
									<input
										type="radio"
										name="recurrence-scope"
										value={value}
										checked={scope === value}
										onChange={() => setScope(value)}
									/>
									<span className="font-display font-semibold text-ink">{label}</span>
								</label>
							))}
						</div>
						<p className="text-ink-3 text-sm">
							{t(
								scope === "this_occurrence"
									? "calendar.recurrenceScopeThisDesc"
									: scope === "this_and_future"
										? "calendar.recurrenceScopeFutureDesc"
										: "calendar.recurrenceScopeAllDesc",
							)}
						</p>
					</fieldset>
					{loading && (
						<div role="status" className="rounded-xl bg-panel-2 px-4 py-4 text-ink-2 text-sm">
							{t("calendar.recurrenceChecking")}
						</div>
					)}
					{preview && (
						<>
							<div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
								<ScheduleCard
									label={t("calendar.recurrenceBefore")}
									value={scheduleLabel(preview.current, t("calendar.allDay"))}
								/>
								<span className="text-center font-display font-bold text-brass-text" aria-hidden>
									→
								</span>
								<ScheduleCard
									label={t("calendar.recurrenceAfter")}
									value={scheduleLabel(preview.proposed, t("calendar.allDay"))}
								/>
							</div>
							{preview.seriesImpact && (
								<div className="rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-ink-2 text-sm">
									{preview.seriesImpact.preservedPrefixOccurrences > 0
										? t("calendar.recurrenceImpactPrefix", {
												count: preview.seriesImpact.preservedPrefixOccurrences,
											})
										: t("calendar.recurrenceImpactSeries", {
												date: preview.seriesImpact.nextSeriesAnchor ?? "",
											})}
								</div>
							)}
							{preview.warnings.map((warning) => (
								<Notice key={warning} tone="warning">
									{warningLabel(warning)}
								</Notice>
							))}
							{preview.conflicts.map((conflict) => (
								<Notice key={conflict.code} tone="danger">
									{conflict.code === "availability_conflict"
										? t("calendar.recurrenceConflictAvailability")
										: conflict.code === "series_has_future_exceptions"
											? t("calendar.recurrenceConflictFutureExceptions")
							: conflict.code === "deadline_before_series_anchor"
								? t("calendar.recurrenceConflictDeadline")
								: conflict.code === "series_history_overlap"
									? t("calendar.recurrenceConflictHistoryOverlap")
									: conflict.code === "historical_segment_scope_unsupported"
										? t("calendar.recurrenceConflictHistoricalScope")
								: t("calendar.recurrenceErrorConflict")}
								</Notice>
							))}
							{preview.availability.conflicts.length > 0 && (
								<ul className="space-y-1.5 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-ink-2 text-sm">
									{preview.availability.conflicts.map((conflict) => (
										<li key={`${conflict.blockId}:${conflict.assigneeId}`}>
											<span className="font-semibold">{conflict.assigneeName}</span>
											{conflict.label ? ` · ${conflict.label}` : ""}
										</li>
									))}
								</ul>
							)}
						</>
					)}
					{error && (
						<Notice tone="danger">{errorLabel(error)}</Notice>
					)}
				</div>

				<footer className="sticky bottom-0 flex justify-end gap-2 border-line border-t bg-card px-5 py-3.5">
					<button
						type="button"
						disabled={running}
						onClick={onClose}
						className="min-h-11 rounded-xl border border-line px-4 font-display font-semibold text-ink-2 disabled:opacity-50"
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						disabled={!preview?.canExecute || running || loading}
						onClick={() => void confirm()}
						className="min-h-11 rounded-xl bg-brass px-4 font-display font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
					>
						{running ? t("common.saving") : t("calendar.recurrenceConfirm")}
					</button>
				</footer>
			</div>
		</div>
	);
}

function ScheduleCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-h-[84px] rounded-xl border border-line bg-panel-2 px-3 py-2.5">
			<div className="font-display font-bold text-ink-3 text-xs uppercase tracking-wide">
				{label}
			</div>
			<div className="mt-1.5 font-display font-semibold text-ink text-sm">{value}</div>
		</div>
	);
}

function Notice({ children, tone }: { children: string; tone: "warning" | "danger" }) {
	return (
		<div
			role={tone === "danger" ? "alert" : "status"}
			className="rounded-xl border bg-panel-2 px-3 py-2.5 text-sm"
			style={{
				borderColor: tone === "danger" ? "var(--w-overdue)" : "var(--w-brass)",
				color: tone === "danger" ? "var(--w-overdue)" : "var(--w-brass-text)",
			}}
		>
			{children}
		</div>
	);
}
