import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useMemo } from "react";
import { Board } from "../components/Board";
import { Calendar } from "../components/CalendarLazy";
import { TaskItem } from "../components/TaskItem";
import { useSession } from "../lib/auth-client";
import { useFlowSteps } from "../lib/flowSteps";
import { inboxProjectIds, isInboxTask } from "../lib/inbox";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { useViewMode } from "../lib/viewMode";
import { NOT_MEETING } from "../lib/tasks";

/**
 * Oblíbené — rychlé filtry ze sidebaru: Priorita 1 / Přiřazeno mně (jen reálná přiřazení,
 * prototyp ř. 3150) + pohledy Seznam/Nástěnka/Kalendář (showViewSwitcher zahrnuje oblibene).
 */
export function Oblibene({ mode }: { mode: "p1" | "me" }) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const meId = session?.user?.id;
	const projects = useProjects();
	const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
	const inboxIds = useMemo(() => inboxProjectIds(projects), [projects]);
	const flowSteps = useFlowSteps();
	const { view } = useViewMode();

	const { data: tasks } = usePsQuery<TaskRow>(
		`SELECT * FROM tasks WHERE completed_at IS NULL AND ${NOT_MEETING} ORDER BY priority, due_date IS NULL, due_date`,
	);
	const { data: assignments } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");
	const mineSet = useMemo(() => {
		const s = new Set<string>();
		for (const a of assignments ?? []) if (a.user_id === meId && a.task_id) s.add(a.task_id);
		return s;
	}, [assignments, meId]);

	const shown = useMemo(
		() =>
			(tasks ?? [])
				// Pravidlo viditelnosti podúkolů: bez termínu žijí jen v detailu rodiče.
				.filter((tk) => !tk.parent_id || tk.due_date)
				// Netriážované úkoly Schránky do Oblíbených/počtů nepatří (R8, jako Dnes/Úkoly).
				.filter((tk) => !isInboxTask(tk, inboxIds))
				.filter((tk) => (mode === "p1" ? tk.priority === 1 : mineSet.has(tk.id))),
		[tasks, mode, mineSet, inboxIds],
	);

	return (
		<div className="mx-auto max-w-[1080px]" style={{ padding: "10px 22px 90px" }}>
			<div className="mb-4 flex items-center gap-2.5" style={{ paddingTop: 10 }}>
				<span
					className="shrink-0"
					style={{
						width: 9,
						height: 9,
						borderRadius: mode === "p1" ? 2 : "50%",
						background: mode === "p1" ? "var(--w-brass)" : "#2a6fdb",
					}}
				/>
				<h1 className="font-display font-extrabold text-ink" style={{ fontSize: 17 }}>
					{mode === "p1" ? t("nav.priority1") : t("nav.assignedToMe")}
				</h1>
				<span className="font-mono text-ink-3" style={{ fontSize: 12 }}>
					{shown.length}
				</span>
			</div>

			{view === "calendar" ? (
				<Calendar tasks={shown} />
			) : view === "board" ? (
				<Board tasks={shown} />
			) : shown.length === 0 ? (
				<p
					className="text-center font-body text-ink-3"
					style={{ padding: "80px 20px", fontSize: 13.5 }}
				>
					{t("today.emptyClean")}
				</p>
			) : (
				<ul className="flex flex-col gap-0">
					{shown.map((tk) => (
						<TaskItem
							key={tk.id}
							task={tk}
							project={projMap.get(tk.project_id ?? "")}
							flow={flowSteps.get(tk.id)}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
