import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useBulkSelect } from "../lib/bulkSelect";
import { advanceChainForTask } from "../lib/chainAdvance";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { type RescheduleKey, rescheduleDate } from "../lib/reschedule";
import { useTaskDetail } from "../lib/taskDetail";
import { logTaskActivity } from "../lib/activity";
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

	/**
	 * Re-entrancy pojistka: tlačítka zůstávají aktivní, dokud dávku nedoběhne clear()
	 * (u více úkolů běží sekvenční smyčka déle). Bez guardu dvojklik / druhý klik během
	 * běhu spustí dvě souběžné dávky → duplicitní undo/toasty a u opakované řady tichý
	 * posun výskytu dvakrát (R4). `busy` (ref) blokuje synchronně hned, `running` (state)
	 * jen zneviditelní tlačítka. finally po clear() může běžet na odmountované liště —
	 * v React 19 je setState no-op, ref na zahozené instanci je neškodný.
	 */
	const busy = useRef(false);
	const [running, setRunning] = useState(false);
	const guard = async (fn: () => Promise<void>) => {
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

	const ids = Object.keys(selected);
	const ph = ids.map(() => "?").join(", ");
	const { data: rows } = usePsQuery<TaskRow>(`SELECT * FROM tasks WHERE id IN (${ph})`, ids);
	const tasks = rows ?? [];

	/**
	 * D5 — usePsQuery nemusí mít těsně po výběru (shift-rozsah) načtené všechny
	 * vybrané řádky → akce by chybějící tiše přeskočily a toast by hlásil plný
	 * počet. Každá akce si proto komplet vybraných načte přímo z DB.
	 */
	const loadSelected = () =>
		powerSync.getAll<TaskRow>(`SELECT * FROM tasks WHERE id IN (${ph})`, ids);

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

	// S2 (R2/R5) — „Přiřadit" smí nabídnout jen PRŮNIK členů projektů vybraných
	// úkolů: člen workspace mimo projekt by na serveru spadl na 403 a op by se
	// po checkpointu tiše zahodil (lokálně by akce „vyšla"). Členství čteme
	// z lokální project_members (syncuje se), jména z members workspace.
	const projIds = [...new Set(tasks.map((tk) => tk.project_id).filter((x): x is string => !!x))];
	const projPh = projIds.map(() => "?").join(", ");
	const { data: pmRows } = usePsQuery<{
		project_id: string | null;
		user_id: string | null;
	}>(
		projIds.length
			? `SELECT project_id, user_id FROM project_members WHERE project_id IN (${projPh})`
			: "SELECT '' AS project_id, '' AS user_id WHERE 0",
		projIds,
	);
	const byProj = new Map<string, Set<string>>();
	for (const r of pmRows ?? []) {
		if (!r.project_id || !r.user_id) continue;
		const s = byProj.get(r.project_id) ?? new Set<string>();
		s.add(r.user_id);
		byProj.set(r.project_id, s);
	}
	// úkoly bez projektu neomezují (osobní inbox) — průnik jen přes projekty
	const assignable = projIds.length
		? (team ?? []).filter((m) => projIds.every((pid) => byProj.get(pid)?.has(m.id)))
		: (team ?? []);

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

	/** Aplikuj UPDATE jednoho sloupce na dané úkoly s JEDNÍM undo záznamem.
	 * (Projekt má vlastní bulkProject — kaskáda na podúkoly a denorm child řádky.) */
	const applyColumn = async (targets: TaskRow[], col: "due_date" | "priority", value: unknown) => {
		const prev = targets.map((tk) => ({
			id: tk.id,
			val: (tk as unknown as Record<string, unknown>)[col] ?? null,
		}));
		const write = async (vals: { id: string; val: unknown }[]) => {
			await powerSync.writeTransaction(async (tx) => {
				for (const v of vals) {
					await tx.execute(`UPDATE tasks SET ${col} = ? WHERE id = ?`, [v.val, v.id]);
				}
			});
		};
		const next = prev.map((p) => ({ id: p.id, val: value }));
		await write(next);
		// historie hromadné změny (dřív se logoval jen edit v detailu)
		for (const tk of targets)
			void logTaskActivity(
				tk.id,
				tk.project_id,
				session?.user?.id,
				col,
				String((tk as unknown as Record<string, unknown>)[col] ?? ""),
				String(value ?? ""),
			);
		// undo záznam až PO úspěšném zápisu — selhání nesmí nechat falešný krok v ⌘Z (D9)
		pushUndo({ undo: () => write(prev), redo: () => write(next) });
	};

	const bulkPriority = async (p: number) => {
		const rowsAll = await loadSelected(); // D5 — komplet, ne jen syncnutý výřez
		await applyColumn(rowsAll, "priority", p);
		setMenu(null);
		clear();
		showToast(t("bulk.priToast", { count: rowsAll.length, p }));
	};

	/**
	 * Termín — S4 (R4): hromadný posun by u opakovaného úkolu přepsal kotvu CELÉ
	 * řady bez dotazu „tento / tento a další / celá řada". Opakované úkoly proto
	 * vynecháváme a hlásíme kolik jich bylo (řadu uživatel upraví v detailu).
	 */
	const bulkTerm = async (key: RescheduleKey, day: string) => {
		const rowsAll = await loadSelected(); // D5
		const movable = rowsAll.filter((tk) => !tk.recurrence_rule);
		const skipped = rowsAll.length - movable.length;
		if (movable.length) await applyColumn(movable, "due_date", rescheduleDate(key));
		setMenu(null);
		clear();
		showToast(
			[
				...(movable.length ? [t("bulk.movedToast", { count: movable.length, day })] : []),
				...(skipped ? [t("bulk.recurringSkipped", { count: skipped })] : []),
			].join(" · "),
		);
	};

	/** Tabulky s denormalizovaným project_id, podle kterého PowerSync bucketuje. */
	const CHILD_PROJECT_TABLES = [
		"assignments",
		"comments",
		"task_occurrence_overrides",
		"task_user_colors",
		"reminders",
		"task_activity",
	] as const;

	/**
	 * Přesun do projektu — NE přes bulkColumn: podúkoly musí jet s rodičem
	 * (rekurzivně) a denormalizovaný project_id child řádků se musí přepsat
	 * taky, jinak se rozjedou sync buckety (členové cílového projektu by
	 * dostali úkol bez komentářů/přiřazení a původní by je dál syncovali — R5).
	 */
	const bulkProject = async (value: string, toast: string) => {
		const all = await powerSync.getAll<{
			id: string;
			project_id: string | null;
		}>(
			`WITH RECURSIVE sub(id) AS (
				SELECT id FROM tasks WHERE id IN (${ph})
				UNION SELECT t.id FROM tasks t JOIN sub s ON t.parent_id = s.id
			) SELECT t.id, t.project_id FROM tasks t JOIN sub s ON t.id = s.id`,
			ids,
		);
		const allIds = all.map((r) => r.id);
		const phAll = allIds.map(() => "?").join(", ");
		const prevChild: Record<string, { id: string; project_id: string | null }[]> = {};
		for (const tb of CHILD_PROJECT_TABLES) {
			prevChild[tb] = await powerSync.getAll(
				`SELECT id, project_id FROM ${tb} WHERE task_id IN (${phAll})`,
				allIds,
			);
		}
		const apply = async () => {
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(`UPDATE tasks SET project_id = ? WHERE id IN (${phAll})`, [
					value,
					...allIds,
				]);
				for (const tb of CHILD_PROJECT_TABLES) {
					await tx.execute(`UPDATE ${tb} SET project_id = ? WHERE task_id IN (${phAll})`, [
						value,
						...allIds,
					]);
				}
			});
		};
		const revert = async () => {
			await powerSync.writeTransaction(async (tx) => {
				for (const r of all) {
					await tx.execute("UPDATE tasks SET project_id = ? WHERE id = ?", [r.project_id, r.id]);
				}
				for (const tb of CHILD_PROJECT_TABLES) {
					for (const r of prevChild[tb] ?? []) {
						await tx.execute(`UPDATE ${tb} SET project_id = ? WHERE id = ?`, [r.project_id, r.id]);
					}
				}
			});
		};
		await apply();
		pushUndo({ undo: revert, redo: apply });
		setMenu(null);
		clear();
		showToast(toast);
	};

	/** R9 — done → is_done status projektu (jinak status nech). Zrcadlí resolveStatusForDone
	 * (privátní v tasks.ts) pro směr done=true; bulkDone jen dokončuje, nikdy neodškrtává. */
	const doneStatusFor = async (taskId: string, currentStatusId: string | null) => {
		const sts = await powerSync.getAll<{ id: string; is_done: number | null }>(
			`SELECT s.id, s.is_done FROM statuses s
			 JOIN tasks t ON t.project_id = s.project_id WHERE t.id = ? ORDER BY s.position`,
			[taskId],
		);
		return sts.find((s) => s.is_done)?.id ?? currentStatusId;
	};

	const bulkDone = async () => {
		const uid = session?.user?.id;
		const rowsAll = await loadSelected(); // D5
		const open = rowsAll.filter((tk) => !tk.completed_at);
		// Úkoly s vlastními invarianty (R4 posun opakované řady, R2 shared_all per-osoba)
		// necháme projít toggleTask jednotlivě — jejich dokončení není prostý zápis
		// completed_at a každý si drží vlastní (správný) undo záznam.
		const complex = open.filter(
			(tk) => !!tk.recurrence_rule || tk.assignment_mode === "shared_all",
		);
		const plain = open.filter((tk) => !tk.recurrence_rule && tk.assignment_mode !== "shared_all");
		// Prosté úkoly zabalíme do JEDNOHO undo záznamu (⌘Z vrátí celou dávku najednou,
		// stejně jako bulkDelete/bulkAssign), místo N samostatných z toggleTask.
		if (plain.length) {
			const ts = new Date().toISOString();
			const snaps = await Promise.all(
				plain.map(async (tk) => ({
					id: tk.id,
					prevDone: tk.completed_at,
					prevStatus: tk.status_id,
					nextStatus: await doneStatusFor(tk.id, tk.status_id),
				})),
			);
			const write = (mode: "apply" | "revert") =>
				powerSync.writeTransaction(async (tx) => {
					for (const s of snaps) {
						await tx.execute("UPDATE tasks SET completed_at = ?, status_id = ? WHERE id = ?", [
							mode === "apply" ? ts : s.prevDone,
							mode === "apply" ? s.nextStatus : s.prevStatus,
							s.id,
						]);
					}
				});
			await write("apply");
			// undo záznam až PO úspěšném zápisu (D9)
			pushUndo({ undo: () => write("revert"), redo: () => write("apply") });
			// Postupy (štafeta) posouvá toggleTask fire-and-forget mimo undo — držíme paritu.
			for (const s of snaps) await advanceChainForTask(s.id, true);
		}
		for (const tk of complex) await toggleTask(tk, uid);
		clear();
		showToast(t("bulk.doneToast", { count: open.length }));
	};

	/**
	 * S2 (R2) — shared_all („každý zvlášť") drží per-osoba completed_at
	 * v assignments; DELETE + INSERT jednoho člověka by účasti (a rozpracovaný
	 * stav kolegů) nenávratně smazal. Takové úkoly z hromadného přiřazení
	 * VYNECHÁVÁME a hlásíme kolik a proč; ostatní přejdou na režim single.
	 */
	const bulkAssign = async (uid: string, name: string) => {
		const rowsAll = await loadSelected(); // D5
		const targets = rowsAll.filter((tk) => tk.assignment_mode !== "shared_all");
		const skipped = rowsAll.length - targets.length;
		if (targets.length) {
			const tIds = targets.map((tk) => tk.id);
			const tPh = tIds.map(() => "?").join(", ");
			type AsgRow = Record<string, unknown>;
			const prevAsg = await powerSync.getAll<AsgRow>(
				`SELECT * FROM assignments WHERE task_id IN (${tPh})`,
				tIds,
			);
			const prevModes = targets.map((tk) => ({
				id: tk.id,
				mode: tk.assignment_mode ?? null,
				project: tk.project_id ?? null,
			}));
			const apply = async () => {
				await powerSync.writeTransaction(async (tx) => {
					await tx.execute(`DELETE FROM assignments WHERE task_id IN (${tPh})`, tIds);
					for (const tk of prevModes) {
						await tx.execute(
							"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
							[tk.id, tk.project, uid, new Date().toISOString()],
						);
						await tx.execute("UPDATE tasks SET assignment_mode = 'single' WHERE id = ?", [tk.id]);
					}
				});
			};
			const revert = async () => {
				await powerSync.writeTransaction(async (tx) => {
					await tx.execute(`DELETE FROM assignments WHERE task_id IN (${tPh})`, tIds);
					for (const r of prevAsg) {
						const cols = Object.keys(r).filter((c) => r[c] !== null && r[c] !== undefined);
						await tx.execute(
							`INSERT INTO assignments (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
							cols.map((c) => r[c]),
						);
					}
					for (const tk of prevModes) {
						await tx.execute("UPDATE tasks SET assignment_mode = ? WHERE id = ?", [tk.mode, tk.id]);
					}
				});
			};
			await apply();
			pushUndo({ undo: revert, redo: apply });
		}
		setMenu(null);
		clear();
		showToast(
			[
				...(targets.length ? [t("bulk.assignToast", { count: targets.length, name })] : []),
				...(skipped ? [t("bulk.assignSkippedShared", { count: skipped })] : []),
			].join(" · "),
		);
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
	const wsProjects = projects.filter((p) => !activeWs || p.workspace_id === activeWs);

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
				onClick={() => void guard(bulkDone)}
				disabled={running}
				className={bulkBtnCls}
				style={{ ...bulkBtnStyle, opacity: running ? 0.5 : 1 }}
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
								onClick={() => void guard(() => bulkTerm(o.key, o.label))}
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
									void guard(() =>
										bulkProject(p.id, t("bulk.projToast", { count, name: p.name ?? "" })),
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
								onClick={() => void guard(() => bulkPriority(p))}
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
						{/* prázdný průnik — vybrané úkoly nesdílejí žádného člena projektů */}
						{assignable.length === 0 && (
							<div className="font-body text-ink-3" style={{ fontSize: 12, padding: "7px 11px" }}>
								{t("bulk.assignNone")}
							</div>
						)}
						{assignable.map((m) => (
							<button
								key={m.id}
								type="button"
								onClick={() => void guard(() => bulkAssign(m.id, m.name))}
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
				onClick={() => void guard(bulkDelete)}
				disabled={running}
				className={bulkBtnCls}
				style={{ ...bulkBtnStyle, color: "var(--w-overdue)", opacity: running ? 0.5 : 1 }}
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
