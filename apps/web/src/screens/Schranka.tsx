import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useMemo, useState } from "react";
import { inboxProjectIds } from "../lib/inbox";
import { filterByQuery, useListSearch } from "../lib/listSearch";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";
import { useWorkspace } from "../lib/workspace";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) =>
	`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function triageDate(kind: "today" | "tomorrow" | "nextWeek"): string {
	const d = new Date();
	if (kind === "tomorrow") d.setDate(d.getDate() + 1);
	else if (kind === "nextWeek") {
		// nejbližší pondělí (alespoň zítra)
		const delta = (8 - d.getDay()) % 7 || 7;
		d.setDate(d.getDate() + delta);
	}
	return isoOf(d);
}

/** Schránka — inbox triage: nezařazené (undated) úkoly v inbox projektech + naplánovat/přesun + undo. */
export function Schranka() {
	const { t } = useTranslation();
	const projects = useProjects();
	const { open } = useTaskDetail();
	const { activeWs } = useWorkspace();
	const { q: searchQ } = useListSearch();
	const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);

	const inboxIds = useMemo(() => inboxProjectIds(projects), [projects]);
	// Cílové projekty pro přeřazení — jen aktivní prostor (prototyp wsProjs, ř. 3086).
	const targetProjects = useMemo(
		() =>
			projects.filter(
				(p) =>
					!inboxIds.has(p.id) && (!activeWs || p.workspace_id === activeWs),
			),
		[projects, inboxIds, activeWs],
	);

	const { data: tasks } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE completed_at IS NULL AND due_date IS NULL AND parent_id IS NULL ORDER BY created_at DESC",
	);
	const items = useMemo(
		() =>
			filterByQuery(
				(tasks ?? []).filter(
					(tk) => tk.project_id && inboxIds.has(tk.project_id),
				),
				searchQ,
			),
		[tasks, inboxIds, searchQ],
	);

	const toggle = (tk: TaskRow) => void toggleTask(tk);

	const schedule = async (
		tk: TaskRow,
		kind: "today" | "tomorrow" | "nextWeek",
	) => {
		await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
			triageDate(kind),
			tk.id,
		]);
		setUndo({ id: tk.id, label: t("inbox.scheduled") });
	};

	const reassign = (tk: TaskRow, projectId: string) =>
		void powerSync.execute("UPDATE tasks SET project_id = ? WHERE id = ?", [
			projectId,
			tk.id,
		]);

	const doUndo = async () => {
		if (!undo) return;
		await powerSync.execute("UPDATE tasks SET due_date = NULL WHERE id = ?", [
			undo.id,
		]);
		setUndo(null);
	};

	return (
		<div
			className="mx-auto max-w-[820px]"
			style={{ padding: "20px 22px 90px" }}
		>
			<div className="mb-1 flex items-center gap-2.5">
				<h1
					className="font-display font-extrabold text-ink"
					style={{ fontSize: 17 }}
				>
					{t("inbox.heading")}
				</h1>
				<span className="font-mono text-ink-3" style={{ fontSize: 12 }}>
					{items.length}
				</span>
			</div>
			<p
				className="mb-4 max-w-[58ch] font-body text-ink-3"
				style={{ fontSize: 13 }}
			>
				{t("inbox.subtitle")}
			</p>

			{items.length === 0 ? (
				<div className="text-center" style={{ padding: "54px 20px" }}>
					<div
						className="mb-1 font-display font-bold text-ink"
						style={{ fontSize: 15 }}
					>
						{t("inbox.empty")}
					</div>
					<div className="font-body text-ink-3" style={{ fontSize: 13 }}>
						{t("inbox.emptyHint")}
					</div>
				</div>
			) : (
				items.map((tk) => (
					<div
						key={tk.id}
						className="mb-2.5 flex items-start gap-3 rounded-[13px] border border-line bg-card"
						style={{ padding: "13px 15px", boxShadow: "var(--w-shadow-sm)" }}
					>
						<button
							type="button"
							onClick={() => toggle(tk)}
							aria-label={t("common.done")}
							className="mt-0.5 h-[19px] w-[19px] shrink-0 rounded-full border-[1.7px] border-line hover:border-brass"
						/>
						<div className="min-w-0 flex-1">
							<button
								type="button"
								onClick={() => open(tk.id)}
								className="mb-2 block text-left font-body text-ink hover:text-brass-text"
								style={{ fontSize: 14 }}
							>
								{tk.name}
							</button>
							<div className="flex flex-wrap items-center gap-1.5">
								<select
									value={tk.project_id ?? ""}
									onChange={(e) => reassign(tk, e.target.value)}
									className="max-w-[170px] rounded-lg border border-line bg-panel-2 font-body text-ink-2 outline-none"
									style={{ padding: "5px 9px", fontSize: 12 }}
								>
									{tk.project_id && inboxIds.has(tk.project_id) && (
										<option value={tk.project_id}>
											{projects.find((p) => p.id === tk.project_id)?.name ??
												t("nav.inbox")}
										</option>
									)}
									{targetProjects.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</select>
								<span
									className="mx-0.5 bg-line"
									style={{ width: 1, height: 18 }}
								/>
								{(["today", "tomorrow", "nextWeek"] as const).map((k) => (
									<button
										key={k}
										type="button"
										onClick={() => void schedule(tk, k)}
										className="rounded-lg border border-line font-display font-semibold text-ink-2 hover:border-brass hover:text-brass-text"
										style={{ padding: "5px 11px", fontSize: 12 }}
									>
										{t(`inbox.${k}`)}
									</button>
								))}
							</div>
						</div>
						<button
							type="button"
							onClick={() => open(tk.id)}
							aria-label={t("detail.description")}
							className="mt-0.5 flex shrink-0 text-ink-3 hover:text-ink"
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 16 16"
								fill="currentColor"
								aria-hidden
							>
								<circle cx="8" cy="3.5" r="1.4" />
								<circle cx="8" cy="8" r="1.4" />
								<circle cx="8" cy="12.5" r="1.4" />
							</svg>
						</button>
					</div>
				))
			)}

			{undo && (
				<div
					className="fixed bottom-6 left-1/2 flex items-center gap-3 rounded-full border border-line bg-navy px-4 py-2.5 text-white"
					style={{
						transform: "translateX(-50%)",
						boxShadow: "var(--w-shadow)",
						zIndex: 40,
					}}
				>
					<span className="font-display font-semibold" style={{ fontSize: 13 }}>
						{undo.label}
					</span>
					<button
						type="button"
						onClick={() => void doUndo()}
						className="font-display font-bold text-brass hover:underline"
						style={{ fontSize: 13 }}
					>
						{t("inbox.undo")}
					</button>
				</div>
			)}
		</div>
	);
}
