import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import {
	type BulkAction,
	type BulkPreview,
	executeBulkCommand,
	previewBulkCommand,
	undoBulkCommand,
} from "../lib/bulkCommands";
import { useBulkSelect } from "../lib/bulkSelect";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { type RescheduleKey, rescheduleDate } from "../lib/reschedule";
import { useTaskDetail } from "../lib/taskDetail";
import { showToast } from "../lib/toast";
import { deleteTasksWithUndo, pushUndo } from "../lib/undo";
import { useIsMobile } from "../lib/useIsMobile";
import { useWorkspace } from "../lib/workspace";
import { BulkPreviewDialog } from "./BulkPreviewDialog";

/** Hromadné akce používají vždy serverový preview → potvrzení → atomický command. */
export function BulkBar() {
	const { count } = useBulkSelect();
	if (count === 0) return null;
	return <Bar />;
}

type MenuKey = "term" | "proj" | "pri" | "assign" | "more";
type Pending = {
	action: BulkAction;
	label: string;
	preview: BulkPreview;
	success: (count: number) => string;
};

const bulkBtnCls =
	"min-h-11 rounded-lg border border-line bg-card font-display font-semibold text-ink-2 whitespace-nowrap hover:border-brass hover:text-ink disabled:opacity-50";
const bulkBtnStyle: CSSProperties = { fontSize: 12, padding: "6px 11px" };
const dropItemCls =
	"flex min-h-11 items-center rounded-[7px] text-left font-display font-semibold text-ink hover:bg-panel-2";
const dropItemStyle: CSSProperties = {
	gap: 8,
	fontSize: 12.5,
	padding: "7px 11px",
	whiteSpace: "nowrap",
};

function Drop({
	children,
	minWidth = 150,
	row = false,
	align = "left",
}: {
	children: ReactNode;
	minWidth?: number;
	row?: boolean;
	align?: "left" | "right";
}) {
	return (
		<div
			className="absolute rounded-[11px] border border-line bg-card"
			style={{
				bottom: 52,
				left: align === "left" ? 0 : undefined,
				right: align === "right" ? 0 : undefined,
				minWidth: row ? undefined : minWidth,
				maxHeight: 260,
				overflow: "auto",
				padding: 5,
				display: "flex",
				flexDirection: row ? "row" : "column",
				gap: row ? 4 : 0,
				boxShadow: "0 10px 30px rgba(20,20,30,.16)",
			}}
		>
			{children}
		</div>
	);
}

function Bar() {
	const { t } = useTranslation();
	const { selected, count, clear } = useBulkSelect();
	const { activeWs } = useWorkspace();
	const { openId } = useTaskDetail();
	const projects = useProjects();
	const isMobile = useIsMobile();
	const [menu, setMenu] = useState<MenuKey | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	const busy = useRef(false);
	const [running, setRunning] = useState(false);
	const ids = Object.keys(selected);
	const placeholders = ids.map(() => "?").join(", ");
	const { data: taskRows } = usePsQuery<TaskRow>(
		`SELECT * FROM tasks WHERE id IN (${placeholders})`,
		ids,
	);
	const tasks = taskRows ?? [];

	const runGuarded = async (fn: () => Promise<void>) => {
		if (busy.current) return;
		busy.current = true;
		setRunning(true);
		try {
			await fn();
		} finally {
			busy.current = false;
			setRunning(false);
		}
	};

	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const response = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!response.ok) throw new Error("members");
			return (await response.json()).members as { id: string; name: string }[];
		},
	});

	const projectIds = [
		...new Set(tasks.map((task) => task.project_id).filter((id): id is string => Boolean(id))),
	];
	const projectPlaceholders = projectIds.map(() => "?").join(", ");
	const { data: projectMemberRows } = usePsQuery<{
		project_id: string | null;
		user_id: string | null;
	}>(
		projectIds.length
			? `SELECT project_id, user_id FROM project_members WHERE project_id IN (${projectPlaceholders})`
			: "SELECT '' AS project_id, '' AS user_id WHERE 0",
		projectIds,
	);
	const membersByProject = new Map<string, Set<string>>();
	for (const row of projectMemberRows ?? []) {
		if (!row.project_id || !row.user_id) continue;
		const members = membersByProject.get(row.project_id) ?? new Set<string>();
		members.add(row.user_id);
		membersByProject.set(row.project_id, members);
	}
	const assignable = projectIds.length
		? (team ?? []).filter((member) =>
				projectIds.every((projectId) => membersByProject.get(projectId)?.has(member.id)),
			)
		: (team ?? []);

	useEffect(() => {
		const onOutside = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) setMenu(null);
		};
		document.addEventListener("mousedown", onOutside);
		return () => document.removeEventListener("mousedown", onOutside);
	}, []);

	useEffect(() => {
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || pending) return;
			if (openId || document.querySelector("[data-esc-layer]")) return;
			if (menu) setMenu(null);
			else clear();
		};
		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, [clear, menu, openId, pending]);

	const prepare = (
		action: BulkAction,
		label: string,
		success: Pending["success"],
	) =>
		void runGuarded(async () => {
			setMenu(null);
			try {
				const preview = await previewBulkCommand(ids, action);
				setPending({ action, label, preview, success });
			} catch {
				showToast(t("bulk.previewLoadFailed"));
			}
		});

	const confirm = () => {
		if (!pending) return;
		void runGuarded(async () => {
			try {
				if (pending.action.kind === "delete") {
					const deleted = await deleteTasksWithUndo(ids);
					if (!deleted) return;
				} else {
					const action = pending.action;
					let result = await executeBulkCommand(ids, action, pending.preview.previewHash);
					let batchId = result.batchId;
					pushUndo({
						undo: async () => {
							try {
								await undoBulkCommand(batchId);
							} catch (error) {
								showToast(t("bulk.previewUndoFailed"));
								throw error;
							}
						},
						redo: async () => {
							const fresh = await previewBulkCommand(ids, action);
							if (!fresh.canExecute) throw new Error("bulk_nothing_to_redo");
							result = await executeBulkCommand(ids, action, fresh.previewHash);
							batchId = result.batchId;
						},
					});
				}
				const message = pending.success(pending.preview.applyCount);
				setPending(null);
				clear();
				showToast(message);
			} catch {
				showToast(t("bulk.previewApplyFailed"));
			}
		});
	};

	const terms: { key: RescheduleKey; label: string }[] = [
		{ key: "today", label: t("bulk.today") },
		{ key: "tomorrow", label: t("bulk.tomorrow") },
		{ key: "nextMonday", label: t("bulk.nextWeek") },
	];
	const workspaceProjects = projects.filter((project) => !activeWs || project.workspace_id === activeWs);

	return (
		<>
			<div
				ref={ref}
				className="fixed z-[70] flex flex-wrap items-center justify-center rounded-[14px] border border-line bg-card"
				style={{
					left: "50%",
					bottom: isMobile ? 70 : 22,
					transform: "translateX(-50%)",
					gap: 6,
					padding: "8px 10px",
					width: isMobile ? "calc(100vw - 16px)" : undefined,
					maxWidth: "92vw",
					boxShadow: "0 14px 44px rgba(20,20,30,.20)",
				}}
			>
				<span className="whitespace-nowrap px-1.5 font-display font-bold text-brass-text" style={{ fontSize: 12 }}>
					{t("bulk.selected", { count })}
				</span>
				<button
					type="button"
					disabled={running}
					onClick={() =>
						prepare(
							{ kind: "complete" },
							t("bulk.done"),
							(changed) => t("bulk.doneToast", { count: changed }),
						)
					}
					className={bulkBtnCls}
					style={bulkBtnStyle}
				>
					{t("bulk.done")}
				</button>
				{isMobile && (
					<div className="relative">
						<button
							type="button"
							disabled={running}
							aria-expanded={menu === "more"}
							onClick={() => setMenu(menu === "more" ? null : "more")}
							className={bulkBtnCls}
							style={bulkBtnStyle}
						>
							{t("bulk.moreActions")} ▾
						</button>
						{menu === "more" && (
							<Drop minWidth={180} align="right">
								{([
									["term", t("bulk.term")],
									["proj", t("bulk.project")],
									["pri", t("bulk.priority")],
									["assign", t("bulk.assign")],
								] as const).map(([key, label]) => (
									<button
										key={key}
										type="button"
										onClick={() => setMenu(key)}
										className={dropItemCls}
										style={dropItemStyle}
									>
										{label} ›
									</button>
								))}
								<button
									type="button"
									onClick={() =>
										prepare(
											{ kind: "delete" },
											t("bulk.delete"),
											(changed) => t("bulk.deletedToast", { count: changed }),
										)
									}
									className={dropItemCls}
									style={{ ...dropItemStyle, color: "var(--w-overdue)" }}
								>
									{t("bulk.delete")}
								</button>
							</Drop>
						)}
					</div>
				)}

				<div className={isMobile ? (menu === "term" ? "static" : "hidden") : "relative"}>
					<button type="button" aria-expanded={menu === "term"} onClick={() => setMenu(menu === "term" ? null : "term")} className={isMobile ? "hidden" : bulkBtnCls} style={bulkBtnStyle}>
						{t("bulk.term")} ▾
					</button>
					{menu === "term" && (
						<Drop>
							{terms.map((term) => (
								<button
									key={term.key}
									type="button"
									onClick={() =>
										prepare(
											{ kind: "reschedule", dueDate: rescheduleDate(term.key) },
											`${t("bulk.term")} · ${term.label}`,
											(changed) => t("bulk.movedToast", { count: changed, day: term.label }),
										)
									}
									className={dropItemCls}
									style={dropItemStyle}
								>
									{term.label}
								</button>
							))}
						</Drop>
					)}
				</div>

				<div className={isMobile ? (menu === "proj" ? "static" : "hidden") : "relative"}>
					<button type="button" aria-expanded={menu === "proj"} onClick={() => setMenu(menu === "proj" ? null : "proj")} className={isMobile ? "hidden" : bulkBtnCls} style={bulkBtnStyle}>
						{t("bulk.project")} ▾
					</button>
					{menu === "proj" && (
						<Drop minWidth={200}>
							{workspaceProjects.map((project) => (
								<button
									key={project.id}
									type="button"
									onClick={() =>
										prepare(
											{ kind: "move", projectId: project.id },
											`${t("bulk.project")} · ${project.name}`,
											(changed) => t("bulk.projToast", { count: changed, name: project.name ?? "" }),
										)
									}
									className={dropItemCls}
									style={dropItemStyle}
								>
									<span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color ?? "var(--w-ink-3)" }} />
									{project.name}
								</button>
							))}
						</Drop>
					)}
				</div>

				<div className={isMobile ? (menu === "pri" ? "static" : "hidden") : "relative"}>
					<button type="button" aria-expanded={menu === "pri"} onClick={() => setMenu(menu === "pri" ? null : "pri")} className={isMobile ? "hidden" : bulkBtnCls} style={bulkBtnStyle}>
						{t("bulk.priority")} ▾
					</button>
					{menu === "pri" && (
						<Drop row>
							{[1, 2, 3, 4].map((priority) => (
								<button
									key={priority}
									type="button"
									onClick={() =>
										prepare(
											{ kind: "priority", priority },
											`${t("bulk.priority")} · P${priority}`,
											(changed) => t("bulk.priToast", { count: changed, p: priority }),
										)
									}
									className="min-h-11 rounded-lg border border-line px-3 font-display font-bold text-ink hover:border-brass"
								>
									P{priority}
								</button>
							))}
						</Drop>
					)}
				</div>

				<div className={isMobile ? (menu === "assign" ? "static" : "hidden") : "relative"}>
					<button type="button" aria-expanded={menu === "assign"} onClick={() => setMenu(menu === "assign" ? null : "assign")} className={isMobile ? "hidden" : bulkBtnCls} style={bulkBtnStyle}>
						{t("bulk.assign")} ▾
					</button>
					{menu === "assign" && (
						<Drop minWidth={190}>
							{assignable.length === 0 && (
								<div className="px-3 py-2 font-body text-ink-3" style={{ fontSize: 12 }}>{t("bulk.assignNone")}</div>
							)}
							{assignable.map((member) => (
								<button
									key={member.id}
									type="button"
									onClick={() =>
										prepare(
											{ kind: "assign", userId: member.id },
											`${t("bulk.assign")} · ${member.name}`,
											(changed) => t("bulk.assignToast", { count: changed, name: member.name }),
										)
									}
									className={dropItemCls}
									style={dropItemStyle}
								>
									<span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 font-bold" style={{ fontSize: 8.5 }}>
										{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
									</span>
									{member.name}
								</button>
							))}
						</Drop>
					)}
				</div>

				<button
					type="button"
					disabled={running}
					onClick={() =>
						prepare(
							{ kind: "delete" },
							t("bulk.delete"),
							(changed) => t("bulk.deletedToast", { count: changed }),
						)
					}
					className={isMobile ? "hidden" : bulkBtnCls}
					style={{ ...bulkBtnStyle, color: "var(--w-overdue)" }}
				>
					{t("bulk.delete")}
				</button>
				<button type="button" onClick={clear} title={t("bulk.clearTitle")} className={bulkBtnCls} style={{ ...bulkBtnStyle, padding: "6px 10px" }}>
					×
				</button>
			</div>
			{pending && (
				<BulkPreviewDialog
					label={pending.label}
					preview={pending.preview}
					running={running}
					onCancel={() => setPending(null)}
					onConfirm={confirm}
				/>
			)}
		</>
	);
}
