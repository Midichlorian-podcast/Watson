import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useBulkSelect } from "../lib/bulkSelect";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { type RescheduleKey, rescheduleDate } from "../lib/reschedule";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { deleteTasksWithUndo, pushUndo } from "../lib/undo";
import { useIsMobile } from "../lib/useIsMobile";
import { useWorkspace } from "../lib/workspace";

/**
 * Plovoucí lišta hromadných akcí (prototyp ř. 316–355 + metody 3133–3143):
 * počet vybraných + Hotovo / Termín ▾ / Projekt ▾ / Priorita ▾ / Přiřadit ▾ / Smazat / ×.
 * Dropdowny se otevírají NAHORU (lišta kotví dole). Esc ruší výběr (kaskáda prototypu),
 * pokud není otevřená jiná vrstva.
 */
export function BulkBar() {
	const { count } = useBulkSelect();
	if (count === 0) return null;
	return <Bar />;
}

type MenuKey = "term" | "proj" | "pri" | "assign";

/** Styl tlačítka lišty — prototyp [data-bulkbtn] (CSS ř. 116–117). */
const bulkBtnCls =
	"rounded-lg border border-line bg-card font-display font-semibold text-ink-2 whitespace-nowrap hover:border-brass hover:text-ink";
const bulkBtnStyle: CSSProperties = { fontSize: 12, padding: "6px 11px" };

/** Dropdown nad tlačítkem (prototyp: absolute bottom:40px). */
function Drop({
	children,
	minWidth = 150,
	row = false,
}: {
	children: ReactNode;
	minWidth?: number;
	row?: boolean;
}) {
	return (
		<div
			className="absolute left-0 rounded-[11px] border border-line bg-card"
			style={{
				bottom: 40,
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

const dropItemCls =
	"flex items-center rounded-[7px] text-left font-display font-semibold text-ink hover:bg-panel-2";
const dropItemStyle: CSSProperties = {
	gap: 8,
	fontSize: 12.5,
	padding: "7px 11px",
	whiteSpace: "nowrap",
};

function Bar() {
	const { t } = useTranslation();
	const { selected, count, clear } = useBulkSelect();
	const { data: session } = useSession();
	const { activeWs } = useWorkspace();
	const { openId } = useTaskDetail();
	const projects = useProjects();
	const isMobile = useIsMobile();
	const [menu, setMenu] = useState<MenuKey | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	const ids = Object.keys(selected);
	const ph = ids.map(() => "?").join(", ");
	const { data: rows } = usePsQuery<TaskRow>(
		`SELECT * FROM tasks WHERE id IN (${ph})`,
		ids,
	);
	const tasks = rows ?? [];

	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as { id: string; name: string }[];
		},
	});

	// klik mimo lištu zavírá dropdown (ne výběr)
	useEffect(() => {
		const h = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, []);

	// Esc = zrušit výběr (kaskáda prototypu „…→ výběr") — jen když nic jiného není otevřené.
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (openId || document.querySelector("[data-esc-layer]")) return;
			if (menu) {
				setMenu(null);
				return;
			}
			clear();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [openId, menu, clear]);

	/** Aplikuj UPDATE jednoho sloupce na všechny vybrané s JEDNÍM undo záznamem. */
	const bulkColumn = async (
		col: "due_date" | "project_id" | "priority",
		value: unknown,
		toast: string,
	) => {
		const prev = tasks.map((tk) => ({
			id: tk.id,
			val: (tk as unknown as Record<string, unknown>)[col] ?? null,
		}));
		const write = async (vals: { id: string; val: unknown }[]) => {
			await powerSync.writeTransaction(async (tx) => {
				for (const v of vals) {
					await tx.execute(`UPDATE tasks SET ${col} = ? WHERE id = ?`, [
						v.val,
						v.id,
					]);
				}
			});
		};
		const next = prev.map((p) => ({ id: p.id, val: value }));
		await write(next);
		pushUndo({ undo: () => write(prev), redo: () => write(next) });
		setMenu(null);
		clear();
		showToast(toast);
	};

	const bulkDone = async () => {
		const uid = session?.user?.id;
		// toggleTask drží invarianty (R2 shared_all = jen má účast, R4 posun řady, R9 status).
		for (const tk of tasks) {
			if (!tk.completed_at) await toggleTask(tk, uid);
		}
		clear();
		showToast(t("bulk.doneToast", { count }));
	};

	const bulkAssign = async (uid: string, name: string) => {
		type AsgRow = Record<string, unknown>;
		const prevAsg = await powerSync.getAll<AsgRow>(
			`SELECT * FROM assignments WHERE task_id IN (${ph})`,
			ids,
		);
		const prevModes = tasks.map((tk) => ({
			id: tk.id,
			mode: tk.assignment_mode ?? null,
			project: tk.project_id ?? null,
		}));
		const apply = async () => {
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(
					`DELETE FROM assignments WHERE task_id IN (${ph})`,
					ids,
				);
				for (const tk of prevModes) {
					await tx.execute(
						"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
						[tk.id, tk.project, uid, new Date().toISOString()],
					);
					await tx.execute(
						"UPDATE tasks SET assignment_mode = 'single' WHERE id = ?",
						[tk.id],
					);
				}
			});
		};
		const revert = async () => {
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(
					`DELETE FROM assignments WHERE task_id IN (${ph})`,
					ids,
				);
				for (const r of prevAsg) {
					const cols = Object.keys(r).filter(
						(c) => r[c] !== null && r[c] !== undefined,
					);
					await tx.execute(
						`INSERT INTO assignments (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
						cols.map((c) => r[c]),
					);
				}
				for (const tk of prevModes) {
					await tx.execute(
						"UPDATE tasks SET assignment_mode = ? WHERE id = ?",
						[tk.mode, tk.id],
					);
				}
			});
		};
		await apply();
		pushUndo({ undo: revert, redo: apply });
		setMenu(null);
		clear();
		showToast(t("bulk.assignToast", { count, name }));
	};

	const bulkDelete = async () => {
		await deleteTasksWithUndo(ids);
		clear();
		showToast(t("bulk.deletedToast", { count }));
	};

	const TERMS: { key: RescheduleKey; label: string }[] = [
		{ key: "today", label: t("bulk.today") },
		{ key: "tomorrow", label: t("bulk.tomorrow") },
		{ key: "nextMonday", label: t("bulk.nextWeek") },
	];
	const wsProjects = projects.filter(
		(p) => !activeWs || p.workspace_id === activeWs,
	);

	return (
		<div
			ref={ref}
			className="fixed z-[70] flex flex-wrap items-center justify-center rounded-[14px] border border-line bg-card"
			style={{
				left: "50%",
				// mobil: nad spodní tab lištou (58px), desktop dle prototypu 22px
				bottom: isMobile ? 70 : 22,
				transform: "translateX(-50%)",
				gap: 6,
				padding: "8px 10px",
				maxWidth: "92vw",
				boxShadow: "0 14px 44px rgba(20,20,30,.20)",
			}}
		>
			<span
				className="whitespace-nowrap font-display font-bold text-brass-text"
				style={{ fontSize: 12, padding: "0 6px" }}
			>
				{t("bulk.selected", { count })}
			</span>

			<button
				type="button"
				onClick={() => void bulkDone()}
				className={bulkBtnCls}
				style={bulkBtnStyle}
			>
				{t("bulk.done")}
			</button>

			{/* Termín ▾ */}
			<div className="relative">
				<button
					type="button"
					onClick={() => setMenu(menu === "term" ? null : "term")}
					className={bulkBtnCls}
					style={bulkBtnStyle}
				>
					{t("bulk.term")} ▾
				</button>
				{menu === "term" && (
					<Drop>
						{TERMS.map((o) => (
							<button
								key={o.key}
								type="button"
								onClick={() =>
									void bulkColumn(
										"due_date",
										rescheduleDate(o.key),
										t("bulk.movedToast", { count, day: o.label }),
									)
								}
								className={dropItemCls}
								style={dropItemStyle}
							>
								{o.label}
							</button>
						))}
					</Drop>
				)}
			</div>

			{/* Projekt ▾ */}
			<div className="relative">
				<button
					type="button"
					onClick={() => setMenu(menu === "proj" ? null : "proj")}
					className={bulkBtnCls}
					style={bulkBtnStyle}
				>
					{t("bulk.project")} ▾
				</button>
				{menu === "proj" && (
					<Drop minWidth={200}>
						{wsProjects.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() =>
									void bulkColumn(
										"project_id",
										p.id,
										t("bulk.projToast", { count, name: p.name ?? "" }),
									)
								}
								className={dropItemCls}
								style={dropItemStyle}
							>
								<span
									className="shrink-0 rounded-full"
									style={{
										width: 8,
										height: 8,
										background: p.color ?? "var(--w-ink-3)",
									}}
								/>
								{p.name}
							</button>
						))}
					</Drop>
				)}
			</div>

			{/* Priorita ▾ */}
			<div className="relative">
				<button
					type="button"
					onClick={() => setMenu(menu === "pri" ? null : "pri")}
					className={bulkBtnCls}
					style={bulkBtnStyle}
				>
					{t("bulk.priority")} ▾
				</button>
				{menu === "pri" && (
					<Drop row>
						{[1, 2, 3, 4].map((p) => (
							<button
								key={p}
								type="button"
								onClick={() =>
									void bulkColumn(
										"priority",
										p,
										t("bulk.priToast", { count, p }),
									)
								}
								className="rounded-lg border border-line font-display font-bold text-ink hover:border-brass"
								style={{ fontSize: 12, padding: "6px 10px" }}
							>
								P{p}
							</button>
						))}
					</Drop>
				)}
			</div>

			{/* Přiřadit ▾ */}
			<div className="relative">
				<button
					type="button"
					onClick={() => setMenu(menu === "assign" ? null : "assign")}
					className={bulkBtnCls}
					style={bulkBtnStyle}
				>
					{t("bulk.assign")} ▾
				</button>
				{menu === "assign" && (
					<Drop minWidth={190}>
						{(team ?? []).map((m) => (
							<button
								key={m.id}
								type="button"
								onClick={() => void bulkAssign(m.id, m.name)}
								className={dropItemCls}
								style={{ ...dropItemStyle, padding: "6px 10px" }}
							>
								<span
									className="inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 font-bold"
									style={{ width: 22, height: 22, fontSize: 8.5 }}
								>
									{m.name
										.split(" ")
										.map((x) => x[0])
										.slice(0, 2)
										.join("")
										.toUpperCase()}
								</span>
								{m.name}
							</button>
						))}
					</Drop>
				)}
			</div>

			<button
				type="button"
				onClick={() => void bulkDelete()}
				className={bulkBtnCls}
				style={{ ...bulkBtnStyle, color: "var(--w-overdue)" }}
			>
				{t("bulk.delete")}
			</button>
			<button
				type="button"
				onClick={clear}
				title={t("bulk.clearTitle")}
				className={bulkBtnCls}
				style={{ ...bulkBtnStyle, padding: "6px 9px" }}
			>
				×
			</button>
		</div>
	);
}
