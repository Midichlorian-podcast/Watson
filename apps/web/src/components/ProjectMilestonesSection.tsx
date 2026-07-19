import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import {
	PROJECT_MILESTONE_CONDITIONS,
	type ProjectMilestoneCondition,
} from "@watson/shared";
import { useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import type { ProjectMilestoneRow } from "../lib/powersync/AppSchema";
import {
	evaluateProjectMilestone,
	type MilestoneTaskSnapshot,
	projectCalendarDay,
} from "../lib/projectMilestones";
import { showToast } from "../lib/toast";

type Draft = {
	id: string | null;
	title: string;
	conditionType: ProjectMilestoneCondition;
	taskId: string;
	targetCount: string;
	dueDate: string;
};
const emptyDraft = (): Draft => ({
	id: null,
	title: "",
	conditionType: "all_tasks_completed",
	taskId: "",
	targetCount: "1",
	dueDate: "",
});

export default function ProjectMilestonesSection({
	projectId,
	enabled,
	onEnabledChange,
	canEdit,
	canManage,
}: {
	projectId: string;
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	canEdit: boolean;
	canManage: boolean;
}) {
	const { t } = useTranslation();
	const { data: milestones } = usePsQuery<ProjectMilestoneRow>(
		"SELECT * FROM project_milestones WHERE project_id = ? ORDER BY position, created_at, id",
		[projectId],
	);
	const { data: taskRows } = usePsQuery<MilestoneTaskSnapshot>(
		"SELECT id, name, kind, completed_at FROM tasks WHERE project_id = ? ORDER BY completed_at IS NOT NULL, name",
		[projectId],
	);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const today = useMemo(() => projectCalendarDay(new Date()), []);
	const tasks = taskRows ?? [];
	const rows = milestones ?? [];
	const validDraft =
		draft !== null &&
		draft.title.trim().length > 0 &&
		(draft.conditionType !== "task_completed" || Boolean(draft.taskId)) &&
		(draft.conditionType !== "completed_count" ||
			(Number.isInteger(Number(draft.targetCount)) &&
				Number(draft.targetCount) >= 1 &&
				Number(draft.targetCount) <= 100_000));

	const save = async () => {
		if (!draft || !validDraft || busy) return;
		if (draft.conditionType === "task_completed" && !draft.taskId) return;
		setBusy(true);
		const payload = {
			title: draft.title.trim(),
			conditionType: draft.conditionType,
			taskId: draft.conditionType === "task_completed" ? draft.taskId : null,
			targetCount:
				draft.conditionType === "completed_count" ? Number(draft.targetCount) : null,
			dueDate: draft.dueDate || null,
			position: draft.id
				? (rows.find((row) => row.id === draft.id)?.position ?? 0)
				: rows.length,
		};
		const version = draft.id ? rows.find((row) => row.id === draft.id)?.updated_at : null;
		if (draft.id && !version) {
			showToast(t("projects.milestoneStale"));
			setBusy(false);
			return;
		}
		try {
			const response = await fetch(
				draft.id
					? `${API_URL}/api/project-milestones/${draft.id}`
					: `${API_URL}/api/projects/${projectId}/milestones`,
				{
					method: draft.id ? "PATCH" : "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(
						draft.id
							? { ...payload, expectedUpdatedAt: version }
							: { id: crypto.randomUUID(), ...payload },
					),
				},
			);
			if (!response.ok) {
				const data = (await response.json().catch(() => null)) as { error?: string } | null;
				if (data?.error === "stale_project_milestone") {
					showToast(t("projects.milestoneStale"));
					return;
				}
				throw new Error("milestone_save");
			}
			setDraft(null);
			showToast(t("projects.milestoneSaved"));
		} catch {
			showToast(t("projects.milestoneSaveError"));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (row: ProjectMilestoneRow) => {
		if (confirmDelete !== row.id) {
			setConfirmDelete(row.id);
			return;
		}
		setBusy(true);
		if (!row.updated_at) {
			showToast(t("projects.milestoneStale"));
			setBusy(false);
			return;
		}
		try {
			const response = await fetch(`${API_URL}/api/project-milestones/${row.id}`, {
				method: "DELETE",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					confirm: row.title ?? "",
					expectedUpdatedAt: row.updated_at,
				}),
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => null)) as { error?: string } | null;
				if (data?.error === "stale_project_milestone") {
					showToast(t("projects.milestoneStale"));
					return;
				}
				throw new Error("milestone_delete");
			}
			setConfirmDelete(null);
			showToast(t("projects.milestoneDeleted"));
		} catch {
			showToast(t("projects.milestoneDeleteError"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mt-4 border-line border-t pt-4" data-project-milestones>
			<label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-ink">
				<input
					type="checkbox"
					checked={enabled}
					disabled={!canManage}
					onChange={(event) => onEnabledChange(event.target.checked)}
					className="h-4 w-4 accent-[var(--w-brass)]"
				/>
				<span className="font-display font-semibold text-xs uppercase tracking-[0.06em]">
					{t("projects.milestonesEnabled")}
				</span>
			</label>
			<p className="mb-2 text-ink-3 text-xs leading-relaxed">
				{t("projects.milestonesHelp")}
			</p>

			{enabled && (
				<>
					<div className="space-y-2">
						{rows.map((row) => {
							const progress = evaluateProjectMilestone(
								row as Parameters<typeof evaluateProjectMilestone>[0],
								tasks,
								today,
							);
							const taskName = tasks.find((task) => task.id === row.task_id)?.name;
							return (
								<div key={row.id} className="rounded-xl border border-line bg-panel-2 p-3">
									<div className="flex items-start gap-2">
										<span
											className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px]"
											style={{
												background:
													progress.state === "met"
														? "var(--w-success-soft)"
														: progress.state === "missed"
															? "var(--w-overdue-soft)"
															: "var(--w-brass-soft)",
												color:
													progress.state === "met"
														? "var(--w-success-ink)"
														: progress.state === "missed"
															? "var(--w-overdue)"
															: "var(--w-brass-text)",
											}}
										>
											{progress.state === "met" ? "✓" : progress.state === "missed" ? "!" : "·"}
										</span>
										<div className="min-w-0 flex-1">
											<div className="truncate font-display font-semibold text-ink text-sm">{row.title}</div>
											<div className="mt-0.5 text-ink-3 text-xs">
												{row.condition_type === "task_completed"
													? taskName ?? t("projects.milestoneMissingTask")
													: t("projects.milestoneProgress", {
														current: progress.current,
														target: progress.target,
													})}
												{row.due_date ? ` · ${row.due_date}` : ""}
											</div>
										</div>
									</div>
									{canEdit && <div className="mt-2 flex gap-2">
										<button
											type="button"
											onClick={() =>
												setDraft({
													id: row.id,
												title: row.title ?? "",
													conditionType: row.condition_type as ProjectMilestoneCondition,
													taskId: row.task_id ?? "",
													targetCount: String(row.target_count ?? 1),
													dueDate: row.due_date ?? "",
												})
											}
											className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-2 text-xs hover:bg-card"
										>
											{t("common.edit")}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => void remove(row)}
											className="min-h-11 rounded-lg px-3 font-display font-semibold text-overdue text-xs hover:bg-card"
										>
											{confirmDelete === row.id
												? t("projects.milestoneDeleteConfirm")
												: t("common.delete")}
										</button>
									</div>}
								</div>
							);
						})}
					</div>

					{canEdit && (draft ? (
						<div className="mt-2 space-y-2 rounded-xl border border-brass bg-brass-soft p-3">
							<input
								value={draft.title}
								onChange={(event) => setDraft({ ...draft, title: event.target.value })}
								placeholder={t("projects.milestoneTitle")}
								className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-ink text-sm outline-none focus:border-brass"
							/>
							<select
								value={draft.conditionType}
								onChange={(event) =>
									setDraft({ ...draft, conditionType: event.target.value as ProjectMilestoneCondition })
								}
								className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-ink text-sm"
							>
								{PROJECT_MILESTONE_CONDITIONS.map((condition) => (
									<option key={condition} value={condition}>
										{t(`projects.milestoneCondition_${condition}`)}
									</option>
								))}
							</select>
							{draft.conditionType === "task_completed" && (
								<select
									value={draft.taskId}
									onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}
									className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-ink text-sm"
								>
									<option value="">{t("projects.milestoneChooseTask")}</option>
									{tasks.filter((task) => task.kind !== "meeting").map((task) => (
										<option key={task.id} value={task.id}>{task.name}</option>
									))}
								</select>
							)}
							{draft.conditionType === "completed_count" && (
								<input
									type="number"
									min={1}
									max={100000}
									value={draft.targetCount}
									onChange={(event) => setDraft({ ...draft, targetCount: event.target.value })}
									className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-ink text-sm"
								/>
							)}
							<label className="block text-ink-3 text-xs">
								{t("projects.milestoneDueOptional")}
								<input
									type="date"
									value={draft.dueDate}
									onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
									className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-ink text-sm"
								/>
							</label>
							<div className="flex gap-2">
								<button
									type="button"
									disabled={busy || !validDraft}
									onClick={() => void save()}
									className="min-h-11 flex-1 rounded-lg bg-brass px-3 font-display font-semibold text-sm text-white disabled:opacity-50"
								>
									{t("common.save")}
								</button>
								<button type="button" onClick={() => setDraft(null)} className="min-h-11 rounded-lg px-3 text-ink text-sm">
									{t("common.cancel")}
								</button>
							</div>
						</div>
					) : (
						<button
							type="button"
							onClick={() => setDraft(emptyDraft())}
							className="mt-2 min-h-11 w-full rounded-lg border border-dashed border-line px-3 font-display font-semibold text-ink-2 text-sm hover:border-brass"
						>
							+ {t("projects.milestoneAdd")}
						</button>
					))}
				</>
			)}
		</div>
	);
}
