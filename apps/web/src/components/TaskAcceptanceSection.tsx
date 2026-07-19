import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import type { TaskAcceptanceRow } from "../lib/powersync/AppSchema";
import { showToast } from "../lib/toast";

type Assignee = { userId: string; name: string };
type AcceptanceStatus = "pending" | "accepted" | "declined" | "cancelled";

export default function TaskAcceptanceSection({
	taskId,
	required,
	creatorId,
	assignees,
	currentUserId,
	taskCompleted,
}: {
	taskId: string;
	required: boolean;
	creatorId: string | null;
	assignees: Assignee[];
	currentUserId: string | null;
	taskCompleted: boolean;
}) {
	const { t } = useTranslation();
	const { data: rows } = usePsQuery<TaskAcceptanceRow>(
		"SELECT * FROM task_acceptances WHERE task_id = ? ORDER BY requested_at, id",
		[taskId],
	);
	const expected = useMemo(
		() => assignees.filter((assignee) => assignee.userId !== creatorId),
		[assignees, creatorId],
	);
	const mine = rows?.find((row) => row.assignee_id === currentUserId && row.status !== "cancelled");
	const mineId = mine?.id ?? null;
	const mineStatus = mine?.status ?? null;
	const mineNote = mine?.note ?? null;
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState<AcceptanceStatus | null>(null);
	const [optimistic, setOptimistic] = useState<{
		id: string;
		status: "accepted" | "declined";
		note: string | null;
	} | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: rozepsanou poznámku neresetuje vzdálený update stejného řádku
	useEffect(() => {
		if (!mineId) return;
		setNote(mineNote ?? "");
		setOptimistic((current) => (current?.id === mineId ? current : null));
	}, [mineId]);
	useEffect(() => {
		if (mineId && optimistic?.id === mineId && mineStatus === optimistic.status) {
			setOptimistic(null);
			setNote(mineNote ?? "");
		}
	}, [mineId, mineStatus, mineNote, optimistic]);

	if ((!required || expected.length === 0) && !(rows ?? []).some((row) => row.status !== "cancelled"))
		return null;

	const respond = async (status: "accepted" | "declined") => {
		if (!mine?.updated_at || busy) return;
		setBusy(status);
		try {
			const response = await fetch(`${API_URL}/api/task-acceptances/${mine.id}/respond`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					expectedUpdatedAt: mine.updated_at,
					status,
					note: note.trim() || null,
				}),
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				showToast(
					body?.error === "stale_task_acceptance"
						? t("detail.acceptanceStale")
						: body?.error === "task_acceptance_locked"
							? t("detail.acceptanceLocked")
							: t("detail.acceptanceError"),
				);
				return;
			}
			setOptimistic({ id: mine.id, status, note: note.trim() || null });
			showToast(
				status === "accepted" ? t("detail.acceptanceAcceptedToast") : t("detail.acceptanceDeclinedToast"),
			);
		} catch {
			showToast(t("detail.acceptanceError"));
		} finally {
			setBusy(null);
		}
	};

	return (
		<section className="mt-5" aria-labelledby={`task-acceptance-${taskId}`}>
			<div
				id={`task-acceptance-${taskId}`}
				className="font-display font-bold text-ink-3 uppercase"
				style={{ fontSize: 11, letterSpacing: ".06em", marginBottom: 7 }}
			>
				{t("detail.acceptanceTitle")}
			</div>
			<div className="rounded-xl border border-line bg-panel-2 p-3">
				<p className="mb-2 font-body text-ink-3 text-xs leading-relaxed">
					{t("detail.acceptanceHelp")}
				</p>
				<ul className="space-y-2">
					{expected.map((assignee) => {
						const row = rows?.find(
							(item) => item.assignee_id === assignee.userId && item.status !== "cancelled",
						);
						const optimisticRow = row?.id === optimistic?.id ? optimistic : null;
						const displayStatus = optimisticRow?.status ?? row?.status ?? "syncing";
						const displayNote = optimisticRow ? optimisticRow.note : row?.note;
						return (
							<li key={assignee.userId} className="rounded-lg border border-line bg-card px-3 py-2.5">
								<div className="flex min-h-6 items-center gap-2">
									<span className="min-w-0 flex-1 truncate font-display font-semibold text-ink text-sm">
										{assignee.name}
									</span>
									<span
										className="shrink-0 rounded-full px-2 py-1 font-mono text-[10px]"
										style={{
											background:
												displayStatus === "accepted"
													? "var(--w-success-soft)"
													: displayStatus === "declined"
														? "var(--w-overdue-soft)"
														: "var(--w-brass-soft)",
											color:
												displayStatus === "accepted"
													? "var(--w-success-ink)"
													: displayStatus === "declined"
														? "var(--w-overdue)"
														: "var(--w-brass-text)",
										}}
									>
										{t(`detail.acceptanceStatus_${displayStatus}`)}
									</span>
								</div>
								{displayNote && assignee.userId !== currentUserId && (
									<p className="mt-1 whitespace-pre-wrap font-body text-ink-2 text-xs leading-relaxed">
										{displayNote}
									</p>
								)}
								{assignee.userId === currentUserId && row && !taskCompleted && (
									<div className="mt-2 border-line border-t pt-2">
										<label className="block font-body text-ink-3 text-xs">
											{t("detail.acceptanceNote")}
											<textarea
												value={note}
												onChange={(event) => setNote(event.target.value)}
												maxLength={1000}
												placeholder={t("detail.acceptanceNotePlaceholder")}
												className="mt-1 min-h-20 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-ink text-sm outline-none focus:border-brass"
											/>
										</label>
										<div className="mt-2 flex flex-wrap gap-2" aria-live="polite">
											<button
												type="button"
												disabled={busy !== null}
												onClick={() => void respond("accepted")}
												className="min-h-11 rounded-lg px-4 py-2 font-display font-semibold text-sm text-white disabled:opacity-55"
												style={{ background: "var(--w-success-ink)" }}
											>
												{busy === "accepted" ? t("common.saving") : t("detail.acceptanceAccept")}
											</button>
											<button
												type="button"
												disabled={busy !== null}
												onClick={() => void respond("declined")}
												className="min-h-11 rounded-lg border border-line bg-card px-4 py-2 font-display font-semibold text-ink-2 text-sm hover:border-overdue disabled:opacity-55"
											>
												{busy === "declined" ? t("common.saving") : t("detail.acceptanceDecline")}
											</button>
										</div>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}
