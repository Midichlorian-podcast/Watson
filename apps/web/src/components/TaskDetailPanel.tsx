import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAddTask } from "../lib/addTask";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { USER_COLORS } from "../lib/colors";
import { initials } from "../lib/format";
import { parseOccId, recurrenceKind } from "../lib/occurrences";
import { rescheduleDate } from "../lib/reschedule";
import type { TaskRow } from "../lib/powersync/AppSchema";

/** Řádek historie z API /api/tasks/:id/activity (task_activity se nesyncuje). */
type ActivityEntry = {
	id: string;
	field: string | null;
	old_value: string | null;
	new_value: string | null;
	user_id: string | null;
	created_at: string | null;
	user_name?: string | null;
};
import { powerSync } from "../lib/powersync/db";
import { enablePush, notificationPermission } from "../lib/push";
import { useProject } from "../lib/projects";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useRowMeta } from "../lib/rowMeta";
import { useTaskDetail } from "../lib/taskDetail";
import {
	occLabel,
	rowDue,
	setOccurrenceOverride,
	todayISO,
	toggleTask,
} from "../lib/tasks";
import { showToast } from "../lib/toast";
import { deleteTaskWithUndo } from "../lib/undo";
import { useOpenMailThread } from "../mail/state";

type Pri = 1 | 2 | 3 | 4;
type Member = { id: string; name: string; email: string; image: string | null };
type AssignMode = "single" | "shared_any" | "shared_all";

/** Relativní čas komentáře („dnes 8:05" / „12. 6."). */
function whenLabel(iso: string | null, t: (k: string) => string) {
	if (!iso) return "";
	const d = new Date(iso);
	const now = new Date();
	const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
	if (d.toDateString() === now.toDateString())
		return `${t("today.todayLower")} ${hm}`;
	return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

/** Historie úprav — mapa DB sloupce → i18n popisek pole. */
const ACT_FIELD_KEY: Record<string, string> = {
	name: "detail.actName",
	description: "detail.actDesc",
	due_date: "detail.actDue",
	start_date: "detail.actTime",
	duration_min: "detail.actTime",
	deadline: "detail.actDeadline",
	priority: "detail.actPriority",
	assignment_mode: "detail.actAssign",
	status_id: "detail.actStatus",
	project_id: "detail.actProject",
	completed: "detail.actCompleted",
	created: "detail.actCreated",
};
function actFieldLabel(field: string, t: (k: string) => string) {
	return t(ACT_FIELD_KEY[field] ?? "detail.actField");
}
/** Lidsky čitelná hodnota pole pro log (priorita → P2, datum → 8.7. 14:00…). */
function fmtActVal(field: string, val: unknown): string | null {
	if (val == null || val === "") return null;
	if (field === "priority") return `P${val}`;
	if (field === "duration_min") return `${val} min`;
	if (field === "due_date" || field === "start_date" || field === "deadline") {
		const d = new Date(String(val));
		if (Number.isNaN(d.getTime())) return String(val);
		const date = `${d.getDate()}. ${d.getMonth() + 1}.`;
		const hm =
			d.getHours() || d.getMinutes()
				? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
				: "";
		return date + hm;
	}
	return String(val);
}

/** Patch sloupců úkolu lokálně (PowerSync upload → generický write-path). */
async function patch(id: string, data: Record<string, unknown>) {
	const cols = Object.keys(data);
	if (cols.length === 0) return;
	const sets = cols.map((c) => `${c} = ?`).join(", ");
	await powerSync.execute(`UPDATE tasks SET ${sets} WHERE id = ?`, [
		...cols.map((c) => data[c]),
		id,
	]);
}

/** Sekční nadpis (prototyp ř. 1024: 11px bold uppercase tracking .06em). */
function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div
			className="font-display font-bold text-ink-3 uppercase"
			style={{ fontSize: 11, letterSpacing: ".06em", margin: "20px 0 7px" }}
		>
			{children}
		</div>
	);
}

/** Brass checkbox (17px čtverec r5 pro položky / kruh pro osoby) s SVG fajfkou. */
function BrassCheck({
	done,
	onClick,
	round,
	size = 17,
	doneLabel,
	undoneLabel,
}: {
	done: boolean;
	onClick: () => void;
	round?: boolean;
	size?: number;
	/** aria pro „hotovo" (klik → odškrtne). Lokalizované, předává konzument. */
	doneLabel: string;
	/** aria pro „nehotovo" (klik → dokončí). */
	undoneLabel: string;
}) {
	return (
		<button
			type="button"
			aria-label={done ? doneLabel : undoneLabel}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			className="grid shrink-0 place-items-center hover:border-brass"
			style={{
				width: size,
				height: size,
				borderRadius: round ? "50%" : 5,
				border: done ? "none" : "2px solid var(--w-line)",
				background: done ? "var(--w-brass)" : "transparent",
			}}
		>
			{done && (
				<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
					<path
						d="M2 5.7 L4.3 8 L9 2.7"
						stroke="#fff"
						strokeWidth="1.7"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
		</button>
	);
}

export function TaskDetailPanel() {
	const { openId, close } = useTaskDetail();
	if (!openId) return null;
	// key = remount při ↑↓/j/k přepnutí úkolu → reset lokálního stavu (prototyp ř. 2223: taskMenu:null)
	return <Panel key={openId} id={openId} onClose={close} />;
}

function Panel({ id, onClose }: { id: string; onClose: () => void }) {
	const { t } = useTranslation();
	const { open, navIds } = useTaskDetail();
	const { openAdd } = useAddTask();
	const { metaOf } = useRowMeta();
	const { data: session } = useSession();
	const qc = useQueryClient();
	const navigate = useNavigate();
	// Chip „Z mailu" — otevře propojené vlákno v mail modulu (handoff mailTh).
	const openMailThread = useOpenMailThread();

	// Výskyt řady: virtuální id `base@ISO` → base úkol + banner + per-výskyt akce.
	const occ = parseOccId(id);
	const realId = occ?.taskId ?? id;

	// Esc zavře detail (jen když nad ním není vyšší vrstva); ↑/↓ (j/k) přepíná úkoly.
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (document.querySelector("[data-esc-layer]")) return;
				onClose();
				return;
			}
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el &&
				(el.tagName === "INPUT" ||
					el.tagName === "TEXTAREA" ||
					el.isContentEditable);
			if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
			const i = navIds.indexOf(id);
			if (i < 0) return;
			if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
				if (i < navIds.length - 1) {
					e.preventDefault();
					open(navIds[i + 1] ?? id);
				}
			} else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
				if (i > 0) {
					e.preventDefault();
					open(navIds[i - 1] ?? id);
				}
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, navIds, id, open]);

	const { data: rows } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE id = ? LIMIT 1",
		[realId],
	);
	const task = rows?.[0];
	// Přístupnost: uzamkni fokus do modalu, dokud je otevřený; vrať fokus po zavření.
	const trapRef = useFocusTrap<HTMLDivElement>(!!task);
	// R6 — vlastní barva úkolu (per-user overlay; syncuje se jen moje barva).
	const { data: colorRows } = usePsQuery<{ id: string; color: string | null }>(
		"SELECT id, color FROM task_user_colors WHERE task_id = ? LIMIT 1",
		[realId],
	);
	const userColor = colorRows?.[0]?.color ?? null;
	const setUserColor = async (color: string | null) => {
		const uid = session?.user?.id;
		if (!uid || !task) return;
		// Ptáme se na existující řádek AŽ TEĎ (ne ze stavu) — jinak rychlé překliky
		// vloží duplikát, který server odmítne na unique (task_id, user_id).
		const existing = await powerSync.getAll<{ id: string }>(
			"SELECT id FROM task_user_colors WHERE task_id = ? AND user_id = ? LIMIT 1",
			[realId, uid],
		);
		if (existing[0]) {
			await powerSync.execute(
				"UPDATE task_user_colors SET color = ?, updated_at = ? WHERE id = ?",
				[color, new Date().toISOString(), existing[0].id],
			);
		} else {
			await powerSync.execute(
				"INSERT INTO task_user_colors (id, task_id, project_id, user_id, color, created_at) VALUES (uuid(), ?, ?, ?, ?, ?)",
				[realId, task.project_id, uid, color, new Date().toISOString()],
			);
		}
	};
	const { data: subs } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at",
		[realId],
	);
	// Rodič (vrstvení podúkolů — odkaz „↑ V úkolu").
	const { data: parentRows } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE id = ? LIMIT 1",
		[task?.parent_id ?? ""],
	);
	const parent = task?.parent_id ? parentRows?.[0] : undefined;
	const { data: depthRows } = usePsQuery<{ depth: number }>(
		`WITH RECURSIVE anc(id, parent_id, lvl) AS (
       SELECT id, parent_id, 1 FROM tasks WHERE id = ?
       UNION ALL SELECT t.id, t.parent_id, anc.lvl + 1 FROM tasks t JOIN anc ON t.id = anc.parent_id
     ) SELECT max(lvl) AS depth FROM anc`,
		[realId],
	);
	const depth = depthRows?.[0]?.depth ?? 1;

	const project = useProject(task?.project_id ?? undefined);
	const { data: comments } = usePsQuery<{
		id: string;
		body: string | null;
		author_id: string | null;
		created_at: string | null;
	}>(
		"SELECT id, body, author_id, created_at FROM comments WHERE task_id = ? ORDER BY created_at",
		[realId],
	);
	const { data: assignRows } = usePsQuery<{
		id: string;
		user_id: string | null;
		completed_at: string | null;
	}>("SELECT id, user_id, completed_at FROM assignments WHERE task_id = ?", [
		realId,
	]);
	const { data: reminders } = usePsQuery<{
		id: string;
		type: string;
		remind_at: string | null;
		offset_min: number | null;
		channel: string;
	}>(
		"SELECT id, type, remind_at, offset_min, channel FROM reminders WHERE task_id = ? AND user_id = ? ORDER BY created_at",
		[realId, session?.user?.id ?? ""],
	);
	// Historie úprav (audit log) — čte se z API (task_activity je insert-only, nesyncuje se).
	const { data: activity } = useQuery({
		queryKey: ["taskActivity", realId],
		enabled: !!realId,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/tasks/${realId}/activity`, {
				credentials: "include",
			});
			if (!r.ok) return [] as ActivityEntry[];
			return ((await r.json()).activity ?? []) as ActivityEntry[];
		},
	});
	const { data: statusRows } = usePsQuery<{
		name: string | null;
		is_done: number | null;
		position: number | null;
	}>(
		"SELECT s.name, s.is_done, s.position FROM statuses s JOIN tasks tk ON tk.status_id = s.id WHERE tk.id = ? LIMIT 1",
		[realId],
	);
	const { data: occRows } = usePsQuery<{
		id: string;
		done: number | null;
		skipped: number | null;
	}>(
		"SELECT id, done, skipped FROM task_occurrence_overrides WHERE task_id = ? AND occ_date = ? LIMIT 1",
		[realId, occ?.iso ?? ""],
	);
	const occOverride = occ ? occRows?.[0] : undefined;

	/** Popisek offsetu připomínky (10 min / 1 h / 1 den). */
	const fmtOffset = (min: number) =>
		min % 1440 === 0
			? `${min / 1440} ${t("detail.remDayUnit")}`
			: min % 60 === 0
				? `${min / 60} ${t("quickadd.unitHour")}`
				: `${min} ${t("quickadd.unitMin")}`;

	const addReminder = async (opts: {
		type: "relative" | "time";
		offsetMin?: number;
		remindAt?: string;
	}) => {
		if (!task) return;
		const uid = session?.user?.id;
		if (!uid) return;
		await powerSync.execute(
			"INSERT INTO reminders (id, task_id, project_id, user_id, type, remind_at, offset_min, channel, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, 'push', ?)",
			[
				realId,
				task.project_id,
				uid,
				opts.type,
				opts.remindAt ?? null,
				opts.offsetMin ?? null,
				new Date().toISOString(),
			],
		);
		void enablePush(); // vyžádá povolení notifikací v momentě záměru
	};

	const removeReminder = (rid: string) =>
		powerSync.execute("DELETE FROM reminders WHERE id = ?", [rid]);

	const projectId = task?.project_id ?? undefined;
	const { data: team } = useQuery({
		queryKey: ["projMembers", projectId],
		enabled: !!projectId,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/projects/${projectId}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as Member[];
		},
	});

	const [name, setName] = useState("");
	const [desc, setDesc] = useState("");
	const [descOpen, setDescOpen] = useState(false);
	const [subText, setSubText] = useState("");
	const [cmtText, setCmtText] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
	const [assignOpen, setAssignOpen] = useState(false);
	// Vlastnosti (priorita/termín/deadline/čas/trvání/barva) rovnou viditelné —
	// kompletní přehledné menu i pro podúkoly (dřív schované za klikem na chip).
	const [editOpen, setEditOpen] = useState(true);
	const [histOpen, setHistOpen] = useState(false);
	// V3 save-UX: čas posledního uložení (zpětná vazba „Uloženo ✓ HH:MM").
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (task) {
			setName(task.name ?? "");
			setDesc(task.description ?? "");
		}
	}, [task]);

	if (!task) return null;
	const done = occ ? Boolean(occOverride?.done) : Boolean(task.completed_at);
	const cmts = comments ?? [];
	const asg = assignRows ?? [];
	const members = team ?? [];
	const memberOf = (uid: string | null) => members.find((m) => m.id === uid);
	const acts = activity ?? [];

	// Zápis jednoho záznamu do historie úprav.
	const logActivity = async (
		field: string,
		oldVal: string | null,
		newVal: string | null,
	) => {
		const uid = session?.user?.id;
		if (!task || !uid) return;
		await powerSync.execute(
			"INSERT INTO task_activity (id, task_id, project_id, user_id, field, old_value, new_value, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?)",
			[
				realId,
				task.project_id,
				uid,
				field,
				oldVal,
				newVal,
				new Date().toISOString(),
			],
		);
		// task_activity se nesyncuje (insert-only) → po zápisu refetchni historii z API.
		void qc.invalidateQueries({ queryKey: ["taskActivity", realId] });
	};

	// V3: patch úkolu + zápis do historie + „Uloženo ✓" + cílené Zpět (revert bez logu).
	const patchLog = async (data: Record<string, unknown>) => {
		if (!task) return;
		const cur = task as unknown as Record<string, unknown>;
		const changed = Object.entries(data).filter(
			([k, v]) => String(cur[k] ?? "") !== String(v ?? ""),
		);
		if (changed.length === 0) return;
		const oldData = Object.fromEntries(
			changed.map(([k]) => [k, cur[k] ?? null]),
		);
		for (const [k, v] of changed)
			await logActivity(k, fmtActVal(k, cur[k]), fmtActVal(k, v));
		await patch(realId, data);
		setSavedAt(Date.now());
		const first = changed[0]?.[0] ?? "";
		showToast(`${actFieldLabel(first, t)} · ${t("detail.saved")}`, {
			label: t("detail.undo"),
			onClick: () => void patch(realId, oldData),
		});
	};

	const mode = (task.assignment_mode ?? "single") as AssignMode;
	const assignedDone = asg.filter((a) => a.completed_at).length;
	const hasReminder = (reminders?.length ?? 0) > 0;
	const status = statusRows?.[0];
	// „Po termínu": u výskytu z ISO výskytu (prototyp makeOcc ř. 2652), jinak z base due_date
	const overdue = occ
		? !done && occ.iso.slice(0, 10) < todayISO()
		: !done && !!task.due_date && task.due_date.slice(0, 10) < todayISO();

	const toggleDone = () => {
		if (occ) {
			void setOccurrenceOverride(realId, task.project_id, occ.iso, {
				done: !done,
			});
			return;
		}
		// historie: zaznamenej dokončení / obnovení (bez toastu/Zpět — má vlastní akci)
		void logActivity("completed", done ? "1" : null, done ? null : "1");
		void toggleTask(task, session?.user?.id);
	};
	const skipOcc = () => {
		if (!occ) return;
		void setOccurrenceOverride(realId, task.project_id, occ.iso, {
			skipped: true,
		}).then(() => {
			showToast(`${t("detail.occSkipped")} · ${occLabel(occ.iso)}`);
			onClose();
		});
	};

	const toggleAssign = async (uid: string) => {
		const existing = asg.find((a) => a.user_id === uid);
		if (existing)
			await powerSync.execute("DELETE FROM assignments WHERE id = ?", [
				existing.id,
			]);
		else
			await powerSync.execute(
				"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
				[realId, task.project_id, uid, new Date().toISOString()],
			);
	};
	const togglePersonDone = (a: { id: string; completed_at: string | null }) =>
		void powerSync.execute(
			"UPDATE assignments SET completed_at = ? WHERE id = ?",
			[a.completed_at ? null : new Date().toISOString(), a.id],
		);

	// Rychlé přidání (checklist styl) — dědí JEN projekt (žádné atributy rodiče),
	// priorita základní P4; Enter přidá a nechá focus.
	const addSub = async () => {
		if (!subText.trim() || depth >= 3) return;
		await powerSync.execute(
			"INSERT INTO tasks (id, project_id, parent_id, name, priority, created_at) VALUES (uuid(), ?, ?, ?, 4, ?)",
			[task.project_id, realId, subText.trim(), new Date().toISOString()],
		);
		setSubText("");
	};
	const addCmt = async () => {
		if (!cmtText.trim()) return;
		await powerSync.execute(
			"INSERT INTO comments (id, task_id, project_id, author_id, body, created_at) VALUES (uuid(), ?, ?, ?, ?, ?)",
			[
				realId,
				task.project_id,
				session?.user?.id ?? null,
				cmtText.trim(),
				new Date().toISOString(),
			],
		);
		setCmtText("");
	};

	/** Duplikace včetně podúkolů (rekurzivně) a přiřazení (prototyp kopíruje celý objekt). */
	const duplicate = async () => {
		const now = new Date().toISOString();
		const copyOne = async (
			srcId: string,
			newParentId: string | null,
			suffix: string,
		) => {
			const nid = crypto.randomUUID();
			await powerSync.execute(
				`INSERT INTO tasks (id, project_id, section_id, parent_id, name, description, priority, color,
          due_date, start_date, deadline, duration_min, days, recurrence, recurrence_rule,
          recurrence_basis, assignment_mode, created_at)
         SELECT ?, project_id, section_id, ?, name || ?, description, priority, color,
          due_date, start_date, deadline, duration_min, days, recurrence, recurrence_rule,
          recurrence_basis, assignment_mode, ? FROM tasks WHERE id = ?`,
				[nid, newParentId, suffix, now, srcId],
			);
			await powerSync.execute(
				`INSERT INTO assignments (id, task_id, project_id, user_id, created_at)
         SELECT uuid(), ?, project_id, user_id, ? FROM assignments WHERE task_id = ?`,
				[nid, now, srcId],
			);
			const kids = await powerSync.getAll<{ id: string }>(
				"SELECT id FROM tasks WHERE parent_id = ?",
				[srcId],
			);
			for (const k of kids) await copyOne(k.id, nid, "");
			return nid;
		};
		const nid = await copyOne(
			realId,
			task?.parent_id ?? null,
			` ${t("detail.copySuffix")}`,
		);
		setMenuOpen(false);
		open(nid);
	};
	const copyLink = () => {
		void navigator.clipboard.writeText(
			`${location.origin}/ukoly?ukol=${realId}`,
		);
		setMenuOpen(false);
		showToast(t("detail.linkCopied"));
	};
	const del = () => {
		void deleteTaskWithUndo(realId); // mazání s undo (⌘Z)
		onClose();
	};

	// Watson hint (prototyp ř. 2930).
	const hint = overdue
		? t("detail.hintOverdue")
		: mode === "shared_all"
			? t("detail.hintAll")
			: t("detail.hintAny");

	const due = rowDue(task, t);
	// Text opakování (prototyp seriesRepeat ř. 2933): rich label z parseru přednostně,
	// krátký výběrový label („Denně") mapovat přes recurrence_rule.kind na „Opakuje se …".
	const repKind = recurrenceKind(task.recurrence_rule);
	const shortRepeatLabels = new Set([
		t("addmodal.repDaily"),
		t("addmodal.repWeekly"),
		t("addmodal.repBiweekly"),
		t("addmodal.repMonthly"),
		t("addmodal.repYearly"),
	]);
	const repeatByKind: Record<string, string> = {
		daily: t("detail.repeatsDaily"),
		weekly: t("detail.repeatsWeekly"),
		biweekly: t("detail.repeatsBiweekly"),
		monthly: t("detail.repeatsMonthly"),
		"monthly-nth": t("detail.repeatsMonthly"),
		"monthly-day": t("detail.repeatsMonthly"),
		yearly: t("detail.repeatsYearly"),
	};
	const seriesRepeat =
		(task.recurrence && !shortRepeatLabels.has(task.recurrence)
			? task.recurrence
			: repKind
				? repeatByKind[repKind]
				: null) ?? t("detail.recurringTask");

	return (
		<>
			{/* backdrop + vycentrovaná karta (rozhodnutí uživatele 2026-07-02 — místo pravého panelu) */}
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0 z-[70]"
				style={{ background: "rgba(10,14,20,.42)" }}
			/>
			<div
				className="pointer-events-none fixed inset-0 z-[71] flex items-start justify-center"
				style={{ paddingTop: "6vh" }}
			>
				<div
					ref={trapRef}
					tabIndex={-1}
					role="dialog"
					aria-modal="true"
					className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-line bg-card outline-none"
					style={{
						width: 560,
						maxWidth: "94vw",
						maxHeight: "86vh",
						boxShadow: "var(--w-shadow)",
						animation: "wPop .18s ease",
					}}
				>
					{/* header: tečka + projekt + ⋯ + × (ř. 977–991) */}
					<div
						className="flex items-center border-line border-b"
						style={{ gap: 9, padding: "13px 18px" }}
					>
						<span
							className="shrink-0 rounded-full"
							style={{
								width: 9,
								height: 9,
								background: project?.color ?? "var(--w-ink-3)",
							}}
						/>
						<span
							className="min-w-0 flex-1 truncate font-display font-semibold"
							style={{ fontSize: 13, color: "var(--w-ink-2)" }}
						>
							{project?.name ?? ""}
						</span>
						{/* V3: nenápadná zpětná vazba „Uloženo ✓ HH:MM" po úpravě */}
						{savedAt && (
							<span
								className="shrink-0 font-body"
								style={{ fontSize: 11, color: "var(--w-success-ink)" }}
							>
								{t("detail.saved")} ✓{" "}
								{new Date(savedAt).toLocaleTimeString("cs", {
									hour: "2-digit",
									minute: "2-digit",
								})}
							</span>
						)}
						<div className="relative">
							<button
								type="button"
								onClick={() => setMenuOpen((o) => !o)}
								aria-label={t("detail.moreActions")}
								className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="currentColor"
									aria-hidden
								>
									<circle cx="8" cy="3.5" r="1.4" />
									<circle cx="8" cy="8" r="1.4" />
									<circle cx="8" cy="12.5" r="1.4" />
								</svg>
							</button>
							{menuOpen && (
								<div
									className="absolute border border-line bg-card"
									style={{
										top: 32,
										right: 0,
										width: 210,
										borderRadius: 11,
										boxShadow: "var(--w-shadow)",
										padding: 5,
										zIndex: 10,
										animation: "wPop .14s ease",
									}}
								>
									<MenuItem icon="duplikovat" onClick={() => void duplicate()}>
										{t("detail.duplicate")}
									</MenuItem>
									<MenuItem icon="odkaz" onClick={copyLink}>
										{t("detail.copyLink")}
									</MenuItem>
									<div
										style={{
											height: 1,
											background: "var(--w-line)",
											margin: "4px 6px",
										}}
									/>
									<MenuItem icon="smazat" danger onClick={del}>
										{t("detail.delete")}
									</MenuItem>
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("common.cancel")}
							className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
						>
							<Icon name="zavrit" size={16} />
						</button>
					</div>

					{/* body */}
					<div
						className="min-h-0 flex-1 overflow-y-auto"
						style={{ padding: "0 18px 18px" }}
					>
						{/* vrstvení: odkaz na rodičovský úkol */}
						{parent && (
							<button
								type="button"
								onClick={() => open(parent.id)}
								className="mt-3 inline-flex items-center font-display font-semibold text-ink-3 hover:text-brass-text"
								style={{ gap: 6, fontSize: 12 }}
							>
								↑ {t("detail.inTask")}:{" "}
								<span className="text-ink-2">{parent.name}</span>
							</button>
						)}

						{/* checkbox + název (ř. 993–997) */}
						<div
							className="flex items-start"
							style={{ gap: 11, marginTop: 16 }}
						>
							<button
								type="button"
								onClick={toggleDone}
								aria-label={done ? t("today.doneSection") : t("common.done")}
								className="grid shrink-0 place-items-center rounded-full hover:border-brass"
								style={{
									width: 22,
									height: 22,
									marginTop: 2,
									border: done ? "none" : "2px solid var(--w-line)",
									background: done ? "var(--w-brass)" : "transparent",
								}}
							>
								{done && (
									<svg
										width="12"
										height="12"
										viewBox="0 0 11 11"
										fill="none"
										aria-hidden
									>
										<path
											d="M2 5.7 L4.3 8 L9 2.7"
											stroke="#fff"
											strokeWidth="1.7"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								)}
							</button>
							<input
								ref={nameRef}
								value={name}
								onChange={(e) => setName(e.target.value)}
								onBlur={() =>
									name.trim() &&
									name !== task.name &&
									void patchLog({ name: name.trim() })
								}
								className="w-full bg-transparent font-display text-ink outline-none"
								style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.25 }}
							/>
						</div>

						{/* banner výskytu POD názvem (prototyp: název ř. 993–997, banner ř. 999–1008) */}
						{occ && (
							<div
								className="border border-line bg-panel-2"
								style={{
									margin: "14px 0 0",
									padding: "11px 13px",
									borderRadius: 11,
								}}
							>
								<div className="flex items-center" style={{ gap: 8 }}>
									<span
										className="font-display font-bold uppercase"
										style={{
											fontSize: 11,
											letterSpacing: ".05em",
											color: "var(--w-brass-text)",
										}}
									>
										↻ {t("detail.occSeries")}
									</span>
									<span
										className="font-mono"
										style={{ fontSize: 12, color: "var(--w-ink-2)" }}
									>
										{occLabel(occ.iso)}
									</span>
								</div>
								<div
									className="font-body text-ink-3"
									style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}
								>
									{seriesRepeat}. {t("detail.occHint")}
								</div>
								<button
									type="button"
									onClick={() => open(realId)}
									className="mt-1.5 font-display font-semibold hover:underline"
									style={{ fontSize: 12, color: "var(--w-brass-text)" }}
								>
									{t("detail.editSeries")}
								</button>
							</div>
						)}

						{/* řádek chipů (ř. 1010–1016) — klik otevře editaci polí */}
						<div
							className="flex flex-wrap"
							style={{ gap: 8, margin: "16px 0 0" }}
						>
							<button
								type="button"
								onClick={() => setEditOpen((o) => !o)}
								className="cursor-pointer font-display font-semibold"
								style={{
									fontSize: 11.5,
									padding: "4px 10px",
									borderRadius: 999,
									background: "var(--w-card)",
									border: `1px solid ${task.priority === 1 ? "var(--w-ink-3)" : "var(--w-line)"}`,
									color:
										task.priority === 1
											? "var(--w-ink)"
											: task.priority === 4
												? "var(--w-ink-3)"
												: "var(--w-ink-2)",
								}}
							>
								{t("detail.priority")} P{task.priority ?? 4}
							</button>
							{due && (
								<button
									type="button"
									onClick={() => setEditOpen((o) => !o)}
									className="cursor-pointer font-mono"
									style={{
										fontSize: 11.5,
										padding: "5px 10px",
										borderRadius: 999,
										background: "var(--w-panel-2)",
										// u výskytu barva z occ overdue (makeOcc ř. 2652), ne z base úkolu
										color: (occ ? overdue : due.overdue)
											? "var(--w-overdue)"
											: "var(--w-ink-2)",
									}}
								>
									{occ ? occLabel(occ.iso) : due.label}
								</button>
							)}
							{status?.name && (status.position ?? 0) > 0 && (
								<span
									className="font-display font-semibold"
									style={{
										fontSize: 11.5,
										padding: "4px 10px",
										borderRadius: 999,
										background: (status.name ?? "")
											.toLowerCase()
											.includes("kontrol")
											? "var(--w-panel-2)"
											: "var(--w-success-soft)",
										color: (status.name ?? "").toLowerCase().includes("kontrol")
											? "var(--w-ink-2)"
											: "var(--w-success-ink)",
									}}
								>
									{status.name}
								</span>
							)}
							{task.recurrence && (
								<span
									className="font-display font-semibold"
									style={{
										fontSize: 11.5,
										padding: "4px 10px",
										borderRadius: 999,
										background: "var(--w-panel-2)",
										color: "var(--w-ink-2)",
									}}
								>
									↻ {t("detail.recurringPill")}
								</span>
							)}
							{hasReminder && (
								<span
									className="font-display font-semibold"
									style={{
										fontSize: 11.5,
										padding: "4px 10px",
										borderRadius: 999,
										background: "var(--w-panel-2)",
										color: "var(--w-ink-2)",
									}}
								>
									{t("detail.reminder")}
								</span>
							)}
							{/* propojení Mail ↔ úkol — mosazný chip „Z mailu · … → otevřít vlákno"
							    (handoff: úkol nese mailTh + mailLabel; screenshot 22 / archiv) */}
							{task.mail_th && (
								<button
									type="button"
									onClick={() => {
										openMailThread?.(task.mail_th ?? "");
										onClose();
										void navigate({ to: "/mail" });
									}}
									className="cursor-pointer font-display font-semibold hover:brightness-105"
									style={{
										fontSize: 11.5,
										padding: "4px 10px",
										borderRadius: 999,
										background: "var(--w-brass-soft)",
										border: "1px solid var(--w-brass)",
										color: "var(--w-brass-text)",
									}}
								>
									✉ {t("detail.fromMail")} · {task.mail_label ?? ""} →
								</button>
							)}
						</div>

						{/* rozbalená editace polí (aditivní — klik na chip) */}
						{editOpen && !occ && (
							<>
								<SectionLabel>{t("detail.properties")}</SectionLabel>
								<div
									className="border border-line bg-panel-2"
									style={{
										borderRadius: 11,
										padding: "11px 13px",
									}}
								>
									<div className="flex items-center" style={{ gap: 8 }}>
										<span
											className="w-14 shrink-0 font-body text-ink-3"
											style={{ fontSize: 11.5 }}
										>
											{t("detail.priority")}
										</span>
										{([1, 2, 3, 4] as Pri[]).map((p) => (
											<button
												key={p}
												type="button"
												onClick={() => void patchLog({ priority: p })}
												className="font-display font-semibold"
												style={{
													fontSize: 12,
													padding: "5px 13px",
													borderRadius: 9,
													border: `1px solid ${task.priority === p ? "var(--w-brass)" : "var(--w-line)"}`,
													background:
														task.priority === p
															? "var(--w-brass-soft)"
															: "transparent",
													color:
														task.priority === p
															? "var(--w-brass-text)"
															: "var(--w-ink-2)",
												}}
											>
												P{p}
											</button>
										))}
									</div>
									<div
										className="flex flex-wrap items-center"
										style={{ gap: 8, marginTop: 9 }}
									>
										{(
											[
												["due_date", t("detail.due")],
												["deadline", t("detail.deadline")],
											] as const
										).map(([col, label]) => (
											<label
												key={col}
												className="flex items-center"
												style={{ gap: 6 }}
											>
												<span
													className="font-body text-ink-3"
													style={{ fontSize: 11.5 }}
												>
													{label}
												</span>
												<input
													type="date"
													value={
														task[col] ? (task[col] ?? "").slice(0, 10) : ""
													}
													onChange={(e) =>
														void patchLog({ [col]: e.target.value || null })
													}
													className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-ink-2 text-xs outline-none focus:border-brass"
												/>
											</label>
										))}
										{/* rychlý posun termínu (prototyp data-qsbtn v detailu) */}
										{(
											[
												["tomorrow", t("bulk.tomorrow")],
												["nextMonday", t("qsched.nextWeekShort")],
											] as const
										).map(([key, label]) => (
											<button
												key={key}
												type="button"
												onClick={() =>
													void patchLog({ due_date: rescheduleDate(key) })
												}
												className="cursor-pointer whitespace-nowrap rounded-md border border-line bg-card font-mono text-ink-3 hover:border-brass hover:text-brass-text"
												style={{ fontSize: 9.5, padding: "3px 7px" }}
											>
												{label}
											</button>
										))}
										{/* čas + trvání (parita s AddTask — funguje i pro podúkoly) */}
										<label className="flex items-center" style={{ gap: 6 }}>
											<span
												className="font-body text-ink-3"
												style={{ fontSize: 11.5 }}
											>
												{t("detail.time")}
											</span>
											<input
												type="time"
												value={
													task.start_date && task.start_date.length >= 16
														? task.start_date.slice(11, 16)
														: ""
												}
												onChange={(e) => {
													const _n = new Date();
													const base =
														task.due_date?.slice(0, 10) ??
														`${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, "0")}-${String(_n.getDate()).padStart(2, "0")}`;
													void patchLog({
														start_date: e.target.value
															? `${base}T${e.target.value}:00`
															: null,
														// čas bez termínu → nastavit i termín (jinak by blok neměl den)
														...(e.target.value && !task.due_date
															? { due_date: base }
															: {}),
													});
												}}
												className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-ink-2 text-xs outline-none focus:border-brass"
											/>
										</label>
										<label className="flex items-center" style={{ gap: 6 }}>
											<span
												className="font-body text-ink-3"
												style={{ fontSize: 11.5 }}
											>
												{t("detail.duration")}
											</span>
											<input
												type="number"
												min={0}
												max={10080}
												step={5}
												value={task.duration_min ?? ""}
												onChange={(e) => {
													const n = Number.parseInt(e.target.value, 10);
													void patchLog({
														duration_min: Number.isNaN(n) ? null : n,
													});
												}}
												className="rounded-lg border border-line bg-card px-2 py-1 text-right font-mono text-ink-2 text-xs outline-none focus:border-brass"
												style={{ width: 64 }}
											/>
											<span
												className="font-body text-ink-3"
												style={{ fontSize: 11 }}
											>
												{t("addmodal.min")}
											</span>
										</label>
									</div>
									<div
										className="flex flex-wrap items-center"
										style={{ gap: 6, marginTop: 9 }}
									>
										<button
											type="button"
											onClick={() => void setUserColor(null)}
											aria-label={t("detail.clearColor")}
											className="grid place-items-center border border-line bg-card"
											style={{ width: 20, height: 20, borderRadius: 6 }}
										>
											<svg
												width="12"
												height="12"
												viewBox="0 0 14 14"
												aria-hidden
											>
												<line
													x1="3"
													y1="11"
													x2="11"
													y2="3"
													stroke="var(--w-ink-3)"
													strokeWidth="1.3"
												/>
											</svg>
										</button>
										{USER_COLORS.map((c) => (
											<button
												key={c}
												type="button"
												onClick={() => void setUserColor(c)}
												aria-label={c}
												style={{
													width: 20,
													height: 20,
													borderRadius: 6,
													background: c,
													boxShadow:
														userColor === c
															? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)"
															: undefined,
												}}
											/>
										))}
									</div>
								</div>
							</>
						)}

						{/* Watson hint (ř. 1018–1021) */}
						<div
							className="flex items-start"
							style={{
								gap: 9,
								margin: "18px 0 0",
								padding: "12px 14px",
								background: "var(--w-brass-soft)",
								borderRadius: 11,
							}}
						>
							<span
								className="flex shrink-0 items-center justify-center rounded-full"
								style={{
									width: 18,
									height: 18,
									border: "1.6px solid var(--w-brass)",
									color: "var(--w-brass-text)",
									fontWeight: 800,
									fontSize: 10,
								}}
							>
								W
							</span>
							<span
								className="font-body"
								style={{
									fontSize: 13,
									color: "var(--w-ink-2)",
									lineHeight: 1.5,
								}}
							>
								{hint}
							</span>
						</div>

						{/* POPIS (ř. 1023–1026) */}
						{task.description || descOpen ? (
							<>
								<SectionLabel>{t("detail.description")}</SectionLabel>
								{descOpen ? (
									<textarea
										// biome-ignore lint/a11y/noAutofocus: přepnutí do editace popisu
										autoFocus
										value={desc}
										onChange={(e) => setDesc(e.target.value)}
										onBlur={() => {
											setDescOpen(false);
											if (desc !== (task.description ?? ""))
												void patchLog({ description: desc || null });
										}}
										rows={3}
										className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-ink text-sm outline-none focus:border-brass"
									/>
								) : (
									<button
										type="button"
										onClick={() => setDescOpen(true)}
										className="w-full text-left font-body"
										style={{
											fontSize: 13.5,
											color: "var(--w-ink-2)",
											lineHeight: 1.55,
										}}
									>
										{task.description}
									</button>
								)}
							</>
						) : (
							<button
								type="button"
								onClick={() => setDescOpen(true)}
								className="mt-4 inline-flex items-center font-body text-ink-3 hover:text-brass-text"
								style={{ gap: 5, fontSize: 12 }}
							>
								{t("addmodal.addDesc")}
							</button>
						)}

						{/* PODÚKOLY — reálné úkoly vrstvené na sebe (rozhodnutí 2026-07-02): plnohodnotný
              řádek s prioritním okrajem, počty vlastních podúkolů a klikem do vlastního detailu. */}
						<SectionLabel>
							{t("detail.subtasks")}
							{(subs?.length ?? 0) > 0 &&
								` · ${(subs ?? []).filter((s) => s.completed_at).length}/${subs?.length}`}
						</SectionLabel>
						<ul>
							{(subs ?? []).map((s) => {
								const sd = Boolean(s.completed_at);
								const sMeta = metaOf(s);
								const sDue = rowDue(s, t);
								return (
									// biome-ignore lint/a11y/useKeyWithClickEvents: klik = otevřít detail podúkolu
									<li
										key={s.id}
										onClick={() => open(s.id)}
										className="flex cursor-pointer items-center border-line border-b hover:bg-panel-2"
										style={{
											gap: 10,
											padding: "8px 4px 8px 9px",
											borderRadius: "0 6px 6px 0",
											boxShadow: sd
												? undefined
												: `inset 3px 0 0 var(--w-p${s.priority ?? 4})`,
											opacity: sd ? 0.55 : 1,
										}}
									>
										<BrassCheck
											round
											size={18}
											done={sd}
											doneLabel={t("detail.ariaMarkUndone")}
											undoneLabel={t("detail.ariaComplete")}
											// toggleTask = jednotná sémantika R9/advance/opakování (ne přímý patch)
											onClick={() => void toggleTask(s)}
										/>
										<span
											className="min-w-0 flex-1 truncate font-display font-semibold"
											style={{
												fontSize: 13.5,
												color: sd ? "var(--w-ink-3)" : "var(--w-ink)",
												textDecoration: sd ? "line-through" : "none",
											}}
										>
											{s.name}
										</span>
										{sMeta.checklist && (
											<span
												className="shrink-0 font-mono text-ink-3"
												style={{ fontSize: 11 }}
											>
												⚏ {sMeta.checklist.done}/{sMeta.checklist.total}
											</span>
										)}
										{sDue && (
											<span
												className="shrink-0 font-mono"
												style={{
													fontSize: 11.5,
													color: sDue.overdue
														? "var(--w-overdue)"
														: "var(--w-ink-3)",
												}}
											>
												{sDue.label}
											</span>
										)}
										<span
											className="shrink-0 text-ink-3"
											style={{ fontSize: 12 }}
										>
											›
										</span>
									</li>
								);
							})}
						</ul>
						{depth < 3 ? (
							<div className="mt-2 flex items-center" style={{ gap: 8 }}>
								{/* rychlé přidání (checklist) — Enter přidá další, dědí prioritu rodiče */}
								<input
									value={subText}
									onChange={(e) => setSubText(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && void addSub()}
									placeholder={t("detail.addSubtask")}
									className="min-w-0 flex-1 rounded-lg border border-line border-dashed bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brass"
								/>
								{/* plné přidání s atributy — otevře modal s parent_id (termín/deadline/…) */}
								<button
									type="button"
									onClick={() =>
										openAdd({
											parentId: realId,
											projectId: task.project_id ?? undefined,
											parentName: task.name ?? undefined,
										})
									}
									title={t("detail.addSubtaskFull")}
									aria-label={t("detail.addSubtaskFull")}
									className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-3 hover:border-brass hover:text-brass-text"
								>
									<svg
										width="16"
										height="16"
										viewBox="0 0 16 16"
										fill="none"
										aria-hidden
									>
										<path
											d="M8 3.5 V12.5 M3.5 8 H12.5"
											stroke="currentColor"
											strokeWidth="1.6"
											strokeLinecap="round"
										/>
									</svg>
								</button>
							</div>
						) : (
							<p className="mt-2 text-ink-3 text-xs">{t("detail.maxDepth")}</p>
						)}

						{/* PŘIŘAZENÍ (R2) — jen přiřazení + „+ Přiřadit" popover (ř. 1050–1059) */}
						<SectionLabel>{t("detail.assignment")}</SectionLabel>
						{/* popisek režimu NAD seznamem (prototyp ř. 1040 assignAll / ř. 1051 assignAny) */}
						{asg.length > 0 && mode !== "single" && (
							<div
								className="font-body text-ink-3"
								style={{ fontSize: 12, marginBottom: 8 }}
							>
								{mode === "shared_all"
									? t("detail.assignAllHint", {
											done: assignedDone,
											total: asg.length,
										})
									: t("detail.assignAnyHint")}
							</div>
						)}
						<ul>
							{asg.map((a) => {
								const m = memberOf(a.user_id);
								const pdone = Boolean(a.completed_at);
								return (
									<li
										key={a.id}
										className="flex items-center"
										style={{ gap: 10, padding: "5px 0" }}
									>
										{mode === "shared_all" && (
											<BrassCheck
												round
												size={18}
												done={pdone}
												doneLabel={t("detail.ariaMarkUndone")}
												undoneLabel={t("detail.ariaComplete")}
												onClick={() => togglePersonDone(a)}
											/>
										)}
										<span
											className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
											style={{
												width: 24,
												height: 24,
												fontSize: 10,
												color: "#fff",
												background: "var(--w-avatar)",
											}}
										>
											{initials(m?.name ?? "?")}
										</span>
										<span style={{ fontSize: 13, color: "var(--w-ink)" }}>
											{m?.name ?? "—"}
										</span>
										<button
											type="button"
											onClick={() => a.user_id && void toggleAssign(a.user_id)}
											aria-label={t("common.cancel")}
											className="ml-auto text-ink-3 hover:text-overdue"
											style={{ fontSize: 13 }}
										>
											✕
										</button>
									</li>
								);
							})}
						</ul>
						<div className="relative">
							<button
								type="button"
								onClick={() => setAssignOpen((o) => !o)}
								className="mt-1 inline-flex items-center font-display font-semibold text-ink-3 hover:border-brass hover:text-brass-text"
								style={{
									gap: 5,
									fontSize: 12,
									padding: "5px 10px",
									borderRadius: 9,
									border: "1px dashed var(--w-line)",
								}}
							>
								+ {t("detail.assignBtn")}
							</button>
							{assignOpen && (
								<div
									className="absolute border border-line bg-card"
									style={{
										top: 34,
										left: 0,
										width: 240,
										borderRadius: 11,
										boxShadow: "var(--w-shadow)",
										padding: 6,
										zIndex: 10,
										animation: "wPop .14s ease",
									}}
								>
									{members.map((m) => {
										const assigned = asg.some((a) => a.user_id === m.id);
										return (
											<button
												key={m.id}
												type="button"
												onClick={() => void toggleAssign(m.id)}
												className="flex w-full items-center rounded-lg text-left hover:bg-panel-2"
												style={{ gap: 9, padding: "6px 8px" }}
											>
												<span
													className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
													style={{
														width: 24,
														height: 24,
														fontSize: 10,
														color: "#fff",
														background: "var(--w-avatar)",
														opacity: assigned ? 1 : 0.5,
													}}
												>
													{initials(m.name)}
												</span>
												<span
													className="flex-1"
													style={{ fontSize: 13, color: "var(--w-ink)" }}
												>
													{m.name}
												</span>
												{assigned && (
													<svg
														width="13"
														height="13"
														viewBox="0 0 14 14"
														fill="none"
														aria-hidden
													>
														<path
															d="M3 7.4 L6 10 L11 4"
															stroke="var(--w-brass-text)"
															strokeWidth="1.6"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</button>
										);
									})}
									{asg.length >= 2 && (
										<div
											className="flex border-line border-t"
											style={{ gap: 5, marginTop: 5, paddingTop: 6 }}
										>
											{(
												[
													["shared_any", t("detail.assignAny")],
													["shared_all", t("detail.assignAll")],
												] as const
											).map(([m2, l]) => (
												<button
													key={m2}
													type="button"
													onClick={() => void patchLog({ assignment_mode: m2 })}
													className="font-display font-semibold"
													style={{
														fontSize: 11.5,
														padding: "5px 10px",
														borderRadius: 8,
														border: `1px solid ${mode === m2 ? "var(--w-brass)" : "var(--w-line)"}`,
														background:
															mode === m2
																? "var(--w-brass-soft)"
																: "transparent",
														color:
															mode === m2
																? "var(--w-brass-text)"
																: "var(--w-ink-2)",
													}}
												>
													{l}
												</button>
											))}
										</div>
									)}
								</div>
							)}
						</div>
						{/* PŘIPOMÍNKY — relativní (před termínem) / absolutní; doručení Web Push. */}
						<SectionLabel>{t("detail.reminders")}</SectionLabel>
						<div style={{ marginBottom: 4 }}>
							{(reminders ?? []).map((r) => (
								<div
									key={r.id}
									className="flex items-center justify-between"
									style={{ padding: "4px 0", fontSize: 12.5 }}
								>
									<span
										className="inline-flex items-center"
										style={{ gap: 6, color: "var(--w-ink-2)" }}
									>
										<span aria-hidden>🔔</span>
										{r.type === "relative" && r.offset_min != null
											? `${fmtOffset(r.offset_min)} ${t("detail.remBefore")}`
											: r.remind_at
												? `${t("detail.remAt")} ${new Date(r.remind_at).toLocaleString()}`
												: t("detail.reminder")}
									</span>
									<button
										type="button"
										onClick={() => void removeReminder(r.id)}
										aria-label={t("common.cancel")}
										className="text-ink-3 hover:text-overdue"
										style={{ fontSize: 13 }}
									>
										✕
									</button>
								</div>
							))}
							<div
								className="flex flex-wrap items-center"
								style={{
									gap: 6,
									marginTop: (reminders?.length ?? 0) > 0 ? 6 : 2,
								}}
							>
								{[10, 30, 60, 1440].map((min) => {
									const noBase = !task.due_date && !task.start_date;
									return (
										<button
											key={min}
											type="button"
											disabled={noBase}
											onClick={() =>
												void addReminder({ type: "relative", offsetMin: min })
											}
											title={noBase ? t("detail.remNoDue") : undefined}
											className="font-display font-semibold text-ink-2 hover:border-brass hover:text-brass-text"
											style={{
												fontSize: 11.5,
												padding: "5px 9px",
												borderRadius: 8,
												border: "1px solid var(--w-line)",
												opacity: noBase ? 0.45 : 1,
												cursor: noBase ? "not-allowed" : "pointer",
											}}
										>
											{fmtOffset(min)} {t("detail.remBefore")}
										</button>
									);
								})}
								<input
									type="datetime-local"
									onChange={(e) => {
										if (e.target.value)
											void addReminder({
												type: "time",
												remindAt: new Date(e.target.value).toISOString(),
											});
										e.target.value = "";
									}}
									aria-label={t("detail.remAt")}
									className="rounded-[7px] border border-line bg-panel-2 font-mono text-ink outline-none"
									style={{ fontSize: 11, padding: "4px 6px" }}
								/>
							</div>
							{notificationPermission() === "denied" && (
								<div
									className="font-body text-overdue"
									style={{ fontSize: 11, marginTop: 6 }}
								>
									{t("detail.remPushDenied")}
								</div>
							)}
						</div>

						{/* KOMENTÁŘE · N (ř. 1062–1071) */}
						<SectionLabel>
							{t("detail.comments")} · {cmts.length}
						</SectionLabel>
						{cmts.map((cm) => {
							const m = memberOf(cm.author_id);
							return (
								<div
									key={cm.id}
									className="flex"
									style={{ gap: 9, marginBottom: 11 }}
								>
									<span
										className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
										style={{
											width: 26,
											height: 26,
											fontSize: 10,
											color: "#fff",
											background: "var(--w-avatar)",
										}}
									>
										{initials(m?.name ?? "?")}
									</span>
									<div className="min-w-0">
										<div
											className="font-display font-semibold"
											style={{ fontSize: 12.5, color: "var(--w-ink)" }}
										>
											{m?.name ?? "—"}{" "}
											<span
												className="font-body"
												style={{ fontSize: 11, color: "var(--w-ink-3)" }}
											>
												· {whenLabel(cm.created_at, t)}
											</span>
										</div>
										<div
											className="font-body"
											style={{
												fontSize: 13,
												color: "var(--w-ink-2)",
												marginTop: 2,
											}}
										>
											{cm.body}
										</div>
									</div>
								</div>
							);
						})}
						<input
							value={cmtText}
							onChange={(e) => setCmtText(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && void addCmt()}
							placeholder={t("detail.addComment")}
							className="w-full border border-line bg-panel-2 font-body text-ink outline-none focus:border-brass"
							style={{ borderRadius: 9, padding: "8px 11px", fontSize: 13 }}
						/>
						{/* HISTORIE ÚPRAV · N — sbalitelné, nenápadné, na rozkliknutí (audit) */}
						{acts.length > 0 && (
							<div style={{ marginTop: 22 }}>
								<button
									type="button"
									onClick={() => setHistOpen((o) => !o)}
									className="flex w-full items-center font-display font-bold text-ink-3 uppercase hover:text-ink-2"
									style={{ fontSize: 11, letterSpacing: ".06em", gap: 6 }}
								>
									<span
										style={{
											display: "inline-block",
											transform: histOpen ? "rotate(90deg)" : "none",
											transition: "transform .15s",
										}}
									>
										›
									</span>
									{t("detail.history")} · {acts.length}
								</button>
								{histOpen && (
									<div style={{ marginTop: 11 }}>
										{acts.map((a) => {
											const m = memberOf(a.user_id);
											const field = a.field ?? "";
											const verb =
												field === "completed"
													? a.new_value
														? t("detail.actMarkedDone")
														: t("detail.actMarkedUndone")
													: `${t("detail.actChanged")} ${actFieldLabel(field, t)}`;
											const diff =
												field !== "completed" && a.new_value
													? a.old_value
														? `${a.old_value} → ${a.new_value}`
														: `→ ${a.new_value}`
													: null;
											return (
												<div
													key={a.id}
													className="flex"
													style={{ gap: 8, marginBottom: 10 }}
												>
													<span
														className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
														style={{
															width: 21,
															height: 21,
															fontSize: 8.5,
															color: "#fff",
															background: "var(--w-avatar)",
														}}
													>
														{initials(m?.name ?? "?")}
													</span>
													<div className="min-w-0" style={{ fontSize: 12 }}>
														<span
															className="font-display font-semibold text-ink"
															style={{ fontSize: 12 }}
														>
															{m?.name ?? "—"}
														</span>{" "}
														<span
															className="font-body text-ink-2"
															style={{ fontSize: 12 }}
														>
															{verb}
														</span>
														<span
															className="font-body text-ink-3"
															style={{ fontSize: 11 }}
														>
															{" · "}
															{whenLabel(a.created_at, t)}
														</span>
														{diff && (
															<div
																className="truncate font-mono text-ink-3"
																style={{ fontSize: 11, marginTop: 1 }}
															>
																{diff}
															</div>
														)}
													</div>
												</div>
											);
										})}
									</div>
								)}
							</div>
						)}
					</div>

					{/* footer akce (ř. 1073–1077) */}
					<div
						className="flex border-line border-t"
						style={{ gap: 9, padding: "13px 18px" }}
					>
						<button
							type="button"
							onClick={toggleDone}
							className="flex-1 cursor-pointer border-none font-display font-bold"
							style={{
								fontSize: 13,
								color: "#fff",
								background: "var(--w-brass)",
								borderRadius: 10,
								padding: 10,
							}}
						>
							{done ? t("detail.markUndone") : t("detail.markDone")}
						</button>
						{occ && (
							<button
								type="button"
								onClick={skipOcc}
								className="cursor-pointer border border-line bg-panel-2 font-display font-semibold text-ink-2"
								style={{ fontSize: 13, borderRadius: 10, padding: "10px 14px" }}
							>
								{t("detail.skip")}
							</button>
						)}
						<button
							type="button"
							onClick={onClose}
							className="cursor-pointer border border-line bg-panel-2 font-display font-semibold text-ink-2"
							style={{ fontSize: 13, borderRadius: 10, padding: "10px 14px" }}
						>
							{t("detail.close")}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

function MenuItem({
	icon,
	danger,
	onClick,
	children,
}: {
	icon: "duplikovat" | "odkaz" | "smazat";
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	// typografie dle prototypu ř. 983–986: font-body 13px, barva ink (delete overdue)
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center rounded-lg text-left font-body ${
				danger ? "hover:bg-overdue-soft" : "hover:bg-panel-2"
			}`}
			style={{
				gap: 9,
				padding: "8px 10px",
				fontSize: 13,
				color: danger ? "var(--w-overdue)" : "var(--w-ink)",
			}}
		>
			<Icon name={icon} size={15} />
			{children}
		</button>
	);
}
