import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CalendarWidget } from "../components/CalendarWidget";
import { PeekPanel, type PeekTarget } from "../components/PeekPanel";
import { useSession } from "../lib/auth-client";
import { LoadingNote, SyncStamp, useAllReady } from "../lib/dataState";
import { useEmployeeHub } from "../lib/employee";
import { useFlowSteps } from "../lib/flowSteps";
import { initials } from "../lib/format";
import { inboxProjectIds, isInboxTask } from "../lib/inbox";
import { useAllMembers, useFlowsOverview, useGoalsOverview } from "../lib/overview";
import type { ListItemRow, ListRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjectsWithState } from "../lib/projects";
import { storageGet, storageSet } from "../lib/storage";
import { useTaskDetail } from "../lib/taskDetail";
import { startMinOf, todayISO, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { pushUndo } from "../lib/undo";
import { buildWaitingRoom, type WaitingRoomEntry } from "../lib/waitingRoom";
import { isLeadership, useWorkspaces } from "../lib/workspace";
import { useMailDigest, useOpenMailThread } from "../mail/state";

/**
 * Přehled — domovská syntéza celé appky (prototyp ř. 698–835 + prehledView ř. 3850–3888):
 * chipy firem (filtr), pruh „Watsonova syntéza dne" s akcemi, karty Dnes / Cíle v ohrožení /
 * Vázne v postupech / Dění týmu v gridu. Karty Pošta a Nejbližší akce se připojí
 * s Mail modulem a Seznamy (další várky handoffu).
 */

const cardCls = "overflow-hidden rounded-[14px] border border-line bg-card";
const cardStyle: CSSProperties = { boxShadow: "var(--w-shadow-sm)" };

function CardHead({
	title,
	footLabel,
	onFoot,
}: {
	title: string;
	footLabel?: string;
	onFoot?: () => void;
}) {
	return (
		<div className="flex items-center" style={{ gap: 8, padding: "13px 16px 9px" }}>
			<span className="flex-1 font-display font-bold text-ink" style={{ fontSize: 13.5 }}>
				{title}
			</span>
			{footLabel && onFoot && (
				<button
					type="button"
					onClick={onFoot}
					className="min-h-11 rounded-md px-2 font-display font-semibold text-brass-text hover:bg-panel-2 hover:underline"
					style={{ fontSize: 11.5 }}
				>
					{footLabel}
				</button>
			)}
			{footLabel && !onFoot && (
				<span className="font-display font-semibold text-ink-3" style={{ fontSize: 11.5 }}>
					{footLabel}
				</span>
			)}
		</div>
	);
}

function Bar({ pct, color }: { pct: number; color?: string }) {
	return (
		<div className="overflow-hidden rounded-full bg-panel-2" style={{ height: 5 }}>
			<div
				style={{
					height: "100%",
					width: `${Math.min(100, pct)}%`,
					background: color ?? "var(--w-brass)",
					borderRadius: "inherit",
				}}
			/>
		</div>
	);
}

export function Prehled() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { vstup } = useSearch({ from: "/prehled" });
	const { open } = useTaskDetail();
	const { data: session } = useSession();
	const { data: workspaces } = useWorkspaces();
	const employeeHub = useEmployeeHub();
	const leadershipWorkspaceIds = useMemo(
		() =>
			new Set(
				(workspaces ?? [])
					.filter(
						(workspace) =>
							!workspace.isPersonal &&
							(workspace.role === "admin" || workspace.role === "manager"),
					)
					.map((workspace) => workspace.id),
			),
		[workspaces],
	);
	const leadership = isLeadership(workspaces);
	const surface = vstup === "provoz" && !leadership ? "tym" : (vstup ?? "overview");
	useEffect(() => {
		if (vstup !== "provoz" || leadership) return;
		void navigate({ to: "/prehled", search: { vstup: "tym" }, replace: true });
	}, [leadership, navigate, vstup]);
	const { projects, isLoading: projLoading } = useProjectsWithState();
	const flowSteps = useFlowSteps();
	const goalsAll = useGoalsOverview(t);
	const flowsAll = useFlowsOverview();
	const members = useAllMembers();
	// Digest pošty z mail modulu (bez filtru firmy — seed světy se liší, viz state.tsx).
	const digest = useMailDigest();
	const openMailThread = useOpenMailThread();
	// ovFirm — filtr firmy (prototyp: null = Vše)
	const [firm, setFirm] = useState<string | null>(null);
	useEffect(() => {
		if (surface === "provoz" && firm && !leadershipWorkspaceIds.has(firm)) setFirm(null);
	}, [firm, leadershipWorkspaceIds, surface]);
	// peek — náhled položky na místě (feedback: neodvádět z Přehledu pryč)
	const [peek, setPeek] = useState<PeekTarget | null>(null);
	// ovLayout (prototyp prop prehledLayout: Mřížka | Ranní feed) — per-user volba
	const [layout, setLayout] = useState<"grid" | "feed">(() =>
		storageGet("watson.ovLayout") === "feed" ? "feed" : "grid",
	);
	const [communicationFilter, setCommunicationFilter] = useState<"all" | "mentions" | "tasks">(
		"all",
	);
	const [waitingSide, setWaitingSide] = useState<"on_me" | "for_others">("on_me");
	const switchLayout = (v: "grid" | "feed") => {
		setLayout(v);
		storageSet("watson.ovLayout", v);
	};

	// kind IS NOT 'meeting' — KPI/přehled počítá úkoly; porady nezkreslují čísla
	const { data: allTasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE kind IS NOT 'meeting'",
	);
	// Seznamy (checklisty) — karta „Nejbližší akce" (prototyp akce, ř. 3863).
	const { data: allLists, isLoading: listsLoading } = usePsQuery<ListRow>(
		"SELECT * FROM lists WHERE archived = 0 OR archived IS NULL ORDER BY created_at DESC",
	);
	const { data: allListItems, isLoading: itemsLoading } = usePsQuery<ListItemRow>(
		"SELECT id, list_id, done FROM list_items",
	);
	// pro feed „kdo dokončil" — první přiřazený, fallback tvůrce (jako Velín)
	const { data: assignments, isLoading: asgLoading } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");
	const { data: dependencies, isLoading: dependenciesLoading } = usePsQuery<{
		id: string;
		blocking_task_id: string | null;
		blocked_task_id: string | null;
	}>("SELECT id, blocking_task_id, blocked_task_id FROM task_dependencies");
	const { data: waitingChainSteps, isLoading: waitingChainStepsLoading } = usePsQuery<{
		id: string;
		chain_id: string | null;
		task_id: string | null;
		position: number | null;
		step_state: string | null;
	}>("SELECT id, chain_id, task_id, position, step_state FROM chain_steps");
	const { data: allComments, isLoading: commentsLoading } = usePsQuery<{
		id: string;
		task_id: string;
		parent_id: string | null;
		author_id: string | null;
		body: string;
		created_at: string | null;
	}>("SELECT id, task_id, parent_id, author_id, body, created_at FROM comments");
	const { data: allMentions, isLoading: mentionsLoading } = usePsQuery<{
		comment_id: string;
		user_id: string;
	}>("SELECT comment_id, user_id FROM mentions");
	// CC-P0-01: 0 / „vše odbaveno" se smí tvrdit až po doběhnutí všech dotazů —
	// undefined běžícího dotazu není autoritativní prázdno.
	const ready = useAllReady(
		projLoading,
		tasksLoading,
		listsLoading,
		itemsLoading,
		asgLoading,
		dependenciesLoading,
		waitingChainStepsLoading,
		commentsLoading,
		mentionsLoading,
	);
	const waitingReady = useAllReady(
		projLoading,
		tasksLoading,
		asgLoading,
		dependenciesLoading,
		waitingChainStepsLoading,
	);

	const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
	const firms = useMemo(
		() =>
			(workspaces ?? []).filter(
				(workspace) =>
					!workspace.isPersonal &&
					(surface !== "provoz" || leadershipWorkspaceIds.has(workspace.id)),
			),
		[leadershipWorkspaceIds, surface, workspaces],
	);

	const view = useMemo(() => {
		const tdy = todayISO();
		const inboxIds = inboxProjectIds(projects);
		const wsOfTask = (tk: TaskRow) =>
			tk.project_id ? (projById.get(tk.project_id)?.workspace_id ?? null) : null;
		const fOk = (tk: TaskRow) => {
			const workspaceId = wsOfTask(tk);
			if (surface === "provoz" && (!workspaceId || !leadershipWorkspaceIds.has(workspaceId))) {
				return false;
			}
			return !firm || workspaceId === firm;
		};
		// otevřené úkoly bez inboxu, bez podúkolů bez termínu, bez spících kroků (Dnes pravidla)
		const openT = (allTasks ?? []).filter((tk) => {
			if (tk.completed_at || isInboxTask(tk, inboxIds)) return false;
			if (tk.parent_id && !tk.due_date) return false;
			const fs = flowSteps.get(tk.id);
			return !(fs && (fs.state === "waiting" || fs.state === "dormant"));
		});
		// deterministické řazení — bez něj po UPDATE řádku (např. přejmenování
		// v detailu) přeskočí pořadí SQL výsledku a úkol „zmizí" z top-6 výřezu
		const ovd = openT
			.filter((tk) => fOk(tk) && !!tk.due_date && tk.due_date.slice(0, 10) < tdy)
			.sort(
				(a, b) =>
					(a.due_date ?? "").localeCompare(b.due_date ?? "") ||
					(a.priority ?? 4) - (b.priority ?? 4) ||
					(a.name ?? "").localeCompare(b.name ?? ""),
			);
		const tdyRows = openT
			.filter((tk) => fOk(tk) && tk.due_date?.slice(0, 10) === tdy)
			.sort(
				(a, b) =>
					(a.priority ?? 4) - (b.priority ?? 4) ||
					(a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"),
			);
		const wd = (iso: string) =>
			new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(
				new Date(`${iso}T00:00:00`),
			);
		const dnes = ovd
			.concat(tdyRows)
			.slice(0, 6)
			.map((tk) => {
				const isOver = !!tk.due_date && tk.due_date.slice(0, 10) < tdy;
				const due = isOver
					? `${t("today.duePastLower")} · ${wd(tk.due_date?.slice(0, 10) ?? tdy)}`
					: startMinOf(tk) !== null
						? `${String(Math.floor((startMinOf(tk) ?? 0) / 60)).padStart(2, "0")}:${String(
								(startMinOf(tk) ?? 0) % 60,
							).padStart(2, "0")}`
						: "";
				return {
					id: tk.id,
					name: tk.name ?? "",
					color: tk.project_id ? (projById.get(tk.project_id)?.color ?? null) : null,
					p1: (tk.priority ?? 4) === 1,
					isOver,
					due,
					row: tk,
				};
			});
		const dnesMore = Math.max(0, ovd.length + tdyRows.length - 6);

		const risk = goalsAll
			.filter((g) => {
				if (g.status !== "risk" && g.status !== "over") return false;
				if (surface === "provoz" && (!g.wsId || !leadershipWorkspaceIds.has(g.wsId))) {
					return false;
				}
				const gw = (workspaces ?? []).find((w) => w.id === g.wsId);
				if (firm) {
					if (gw?.isPersonal) return false;
					if (g.wsId !== firm) return false;
				}
				return true;
			})
			.slice(0, 3);

		const stuck = flowsAll
			.filter((f) => {
				const workspaceId = f.projectId
					? (projById.get(f.projectId)?.workspace_id ?? f.wsId)
					: f.wsId;
				if (!f.stuck) return false;
				if (
					surface === "provoz" &&
					(!workspaceId || !leadershipWorkspaceIds.has(workspaceId))
				) {
					return false;
				}
				return !firm || workspaceId === firm;
			})
			.slice(0, 2);

		// Nejbližší akce — aktivní seznamy s progresem (prototyp akce, slice 3)
		const itemsByList = new Map<string, { total: number; done: number }>();
		for (const it of allListItems ?? []) {
			if (!it.list_id) continue;
			const s = itemsByList.get(it.list_id) ?? { total: 0, done: 0 };
			s.total++;
			if (it.done) s.done++;
			itemsByList.set(it.list_id, s);
		}
		const akce = (allLists ?? [])
			.filter((l) => !firm || l.workspace_id === firm)
			.slice(0, 3)
			.map((l) => {
				const s = itemsByList.get(l.id) ?? { total: 0, done: 0 };
				return {
					id: l.id,
					name: l.name ?? "",
					event: l.event ?? "",
					pct: s.total ? Math.round((s.done / s.total) * 100) : 0,
					label: `${s.done}/${s.total}`,
				};
			});

		const userId = session?.user?.id ?? null;
		const taskById = new Map((allTasks ?? []).map((task) => [task.id, task]));
		const commentById = new Map((allComments ?? []).map((comment) => [comment.id, comment]));
		const assignedTaskIds = new Set(
			(assignments ?? [])
				.filter((assignment) => assignment.user_id === userId && assignment.task_id)
				.map((assignment) => assignment.task_id as string),
		);
		const mentionedCommentIds = new Set(
			(allMentions ?? [])
				.filter((mention) => mention.user_id === userId)
				.map((mention) => mention.comment_id),
		);
		const communication = (allComments ?? [])
			.map((comment) => {
				const task = taskById.get(comment.task_id);
				if (!task || !fOk(task) || !userId) return null;
				const mentioned = mentionedCommentIds.has(comment.id);
				const parent = comment.parent_id ? commentById.get(comment.parent_id) : null;
				const repliesToMe = parent?.author_id === userId;
				const concernsMyTask = assignedTaskIds.has(task.id) || task.created_by === userId;
				if (!mentioned && !repliesToMe && !concernsMyTask) return null;
				if (comment.author_id === userId && !mentioned) return null;
				const author = comment.author_id ? (members.get(comment.author_id) ?? "") : "";
				return {
					id: comment.id,
					taskId: task.id,
					taskName: task.name ?? "",
					body: comment.body,
					author,
					initials: author ? initials(author) : "?",
					kind: mentioned ? ("mention" as const) : repliesToMe ? ("reply" as const) : ("task" as const),
					createdAt: comment.created_at ?? "",
				};
			})
			.filter((item): item is NonNullable<typeof item> => Boolean(item))
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

		const waitingAll = userId
			? buildWaitingRoom({
					currentUserId: userId,
					tasks: (allTasks ?? []).map((task) => ({
						id: task.id,
						name: task.name,
						project_id: task.project_id,
						priority: task.priority,
						due_date: task.due_date,
						completed_at: task.completed_at,
					})),
					assignments: assignments ?? [],
					dependencies: dependencies ?? [],
					chainSteps: waitingChainSteps ?? [],
				})
			: { onMe: [], forOthers: [] };
		const waiting = {
			onMe: waitingAll.onMe.filter((entry) => {
				const task = taskById.get(entry.taskId);
				return Boolean(task && fOk(task));
			}),
			forOthers: waitingAll.forOthers.filter((entry) => {
				const task = taskById.get(entry.taskId);
				return Boolean(task && fOk(task));
			}),
		};

		// Dění týmu: dnes dokončené (kdo = první přiřazený, fallback tvůrce) + aktivní kroky postupů
		const feed: { key: string; ini: string; txt: string; t: string }[] = [];
		// completed_at je UTC ISO → formátovat lokálně (slice by ukázal čas o 2 h jinak)
		const hhmm = (iso: string | null) =>
			iso && iso.length >= 16
				? new Intl.DateTimeFormat(i18n.language, {
						hour: "2-digit",
						minute: "2-digit",
					}).format(new Date(iso))
				: "";
		// completed_at je UTC ISO → převod na LOKÁLNÍ den (en-CA = YYYY-MM-DD),
		// jinak úkol dokončený těsně po půlnoci spadne do včerejška/zítřka
		const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
		(allTasks ?? [])
			.filter((tk) => fOk(tk) && tk.completed_at && localDay(tk.completed_at) === tdy)
			.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
			.slice(0, 3)
			.forEach((tk) => {
				const uid = (assignments ?? []).find((a) => a.task_id === tk.id)?.user_id ?? tk.created_by;
				const who = uid ? (members.get(uid) ?? "") : "";
				feed.push({
					key: `d${tk.id}`,
					ini: who ? initials(who) : "✓",
					txt: t("prehled.feedDone", {
						who: who.split(" ")[0] || "—",
						name: tk.name ?? "",
					}),
					t: hhmm(tk.completed_at),
				});
			});
		flowsAll
			.filter((f) => {
				const workspaceId = f.projectId
					? (projById.get(f.projectId)?.workspace_id ?? f.wsId)
					: f.wsId;
				if (!f.hasNow) return false;
				if (
					surface === "provoz" &&
					(!workspaceId || !leadershipWorkspaceIds.has(workspaceId))
				) {
					return false;
				}
				return !firm || workspaceId === firm;
			})
			.slice(0, 2)
			.forEach((f) => {
				feed.push({
					key: `f${f.id}`,
					ini: f.nowWho ? initials(f.nowWho.split(", ")[0] ?? "") : "→",
					txt: t("prehled.feedFlow", { flow: f.name, name: f.nowName }),
					t: "",
				});
			});

		// Watsonova syntéza — max 3 věty (prototyp parts)
		const parts: string[] = [];
		if (ovd.length) {
			const first = ovd[0]?.name ?? "";
			parts.push(
				t("prehled.synOverdue", {
					count: ovd.length,
					name: first.length > 44 ? `${first.slice(0, 42)}…` : first,
				}),
			);
		}
		// urgentní vlákna v poště (prototyp: p1/p2 max 2 jména)
		const urgM = (digest?.items ?? []).filter((x) => x.flag === "p1" || x.flag === "p2");
		if (urgM.length) {
			const names = urgM
				.slice(0, 2)
				.map((x) => `„${x.subj.length > 36 ? `${x.subj.slice(0, 34)}…` : x.subj}“`)
				.join(", ");
			parts.push(
				t(urgM.length === 1 ? "prehled.synMailOne" : "prehled.synMailMany", {
					names,
				}),
			);
		}
		const r0 = risk[0];
		if (r0)
			parts.push(
				t("prehled.synRisk", {
					name: r0.name,
					label: r0.label,
					elapsed: r0.elapsed,
				}),
			);
		const a0 = akce[0];
		if (parts.length < 3 && a0)
			parts.push(t("prehled.synChecklist", { name: a0.name, pct: a0.pct }));

		return {
			ovd,
			dnes,
			dnesMore,
			risk,
			stuck,
			akce,
			communication,
			waiting,
			feed: feed.slice(0, 5),
			syn: parts.slice(0, 3).join(" ") || t("prehled.synCalm"),
		};
	}, [
		allTasks,
		allLists,
		allListItems,
		allComments,
		allMentions,
		assignments,
		dependencies,
		waitingChainSteps,
		digest,
		projects,
		projById,
		flowSteps,
		goalsAll,
		flowsAll,
		members,
		session?.user?.id,
		firm,
		leadershipWorkspaceIds,
		surface,
		workspaces,
		t,
		i18n.language,
	]);

	// „Přeplánovat zpožděné" — všechny zpožděné na dnes, jedním undo záznamem (prototyp reschedule)
	// Pojistka proti dvojkliku: bez ní dva rychlé kliky vyrobí 2 undo záznamy a 2 toasty.
	const reschedulingRef = useRef(false);
	const rescheduleOverdue = async () => {
		if (reschedulingRef.current) return;
		reschedulingRef.current = true;
		try {
			await doReschedule();
		} finally {
			reschedulingRef.current = false;
		}
	};
	const doReschedule = async () => {
		const tdy = todayISO();
		// S4 (R4) — opakované úkoly VYNECHAT: posun due_date by přepsal kotvu celé
		// řady bez dotazu „tento / tento a další / celá řada" (uprav řadu v detailu).
		const movable = view.ovd.filter((tk) => !tk.recurrence_rule);
		const skipped = view.ovd.length - movable.length;
		const rows = movable.map((tk) => ({ id: tk.id, prev: tk.due_date }));
		if (!rows.length) {
			if (skipped) showToast(t("bulk.recurringSkipped", { count: skipped }));
			return;
		}
		const write = async (vals: { id: string; val: string | null }[]) => {
			await powerSync.writeTransaction(async (tx) => {
				for (const v of vals)
					await tx.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [v.val, v.id]);
			});
		};
		await write(rows.map((r) => ({ id: r.id, val: tdy })));
		pushUndo({
			undo: () => write(rows.map((r) => ({ id: r.id, val: r.prev }))),
			redo: () => write(rows.map((r) => ({ id: r.id, val: tdy }))),
		});
		showToast(
			[
				t("prehled.rescheduledToast", { count: rows.length }),
				...(skipped ? [t("bulk.recurringSkipped", { count: skipped })] : []),
			].join(" · "),
		);
	};

	const todayLabel = useMemo(() => {
		const d = new Date();
		const wd = new Intl.DateTimeFormat(i18n.language, {
			weekday: "short",
		}).format(d);
		return `${wd} ${d.getDate()}. ${d.getMonth() + 1}.`;
	}, [i18n.language]);
	const communicationRows = view.communication
		.filter((item) =>
			communicationFilter === "mentions"
				? item.kind === "mention"
				: communicationFilter === "tasks"
					? item.kind !== "mention"
					: true,
		)
		.slice(0, 6);
	const waitingRows = (waitingSide === "on_me" ? view.waiting.onMe : view.waiting.forOthers).slice(
		0,
		6,
	);
	const waitingPeople = (ids: string[], excludeCurrent = false) => {
		const names = ids
			.filter((id) => !excludeCurrent || id !== session?.user?.id)
			.map((id) => members.get(id))
			.filter((name): name is string => Boolean(name));
		if (names.length > 0) return names.join(", ");
		if (excludeCurrent && ids.includes(session?.user?.id ?? "")) return t("prehled.waitingYou");
		return t("prehled.waitingUnassigned");
	};
	const communicationTime = (iso: string) => {
		if (!iso) return "";
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return "";
		return date.toDateString() === new Date().toDateString()
			? new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(date)
			: new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "numeric" }).format(date);
	};
	const employee = employeeHub.data?.linked ? employeeHub.data.status : null;
	const employeeUnread = employee?.notifications.filter((item) => !item.isRead).length ?? 0;
	const employeeNextDeadline = employee?.deadlines.countdowns[0] ?? null;
	const surfaceSummary = (() => {
		if (surface === "overview") return view.syn;
		if (surface === "tym") {
			const attention = view.communication.length;
			const waiting = view.waiting.onMe.length + view.waiting.forOthers.length;
			const parts = [
				...(attention > 0
					? [t("prehled.teamSynCommunication", { count: attention })]
					: []),
				...(waiting > 0 ? [t("prehled.teamSynWaiting", { count: waiting })] : []),
			];
			return parts.join(" ") || t("prehled.teamSynCalm");
		}
		const parts = [
			...(view.risk.length > 0
				? [t("prehled.operationsSynRisk", { count: view.risk.length })]
				: []),
			...(view.stuck.length > 0
				? [t("prehled.operationsSynFlows", { count: view.stuck.length })]
				: []),
			...(view.waiting.onMe.length + view.waiting.forOthers.length > 0
				? [
						t("prehled.operationsSynWaiting", {
							count: view.waiting.onMe.length + view.waiting.forOthers.length,
						}),
					]
				: []),
		];
		return parts.join(" ") || t("prehled.operationsSynCalm");
	})();

	const overviewActions: { key: string; label: string; onClick: () => void }[] = [
		...(view.ovd.length
			? [
					{
						key: "a1",
						label: t("prehled.actReschedule"),
						onClick: () => void rescheduleOverdue(),
					},
				]
			: []),
		{
			key: "a2",
			label: t("prehled.actMail"),
			onClick: () => void navigate({ to: "/mail" }),
		},
		...(view.risk.length
			? [
					{
						key: "a3",
						label: t("prehled.actGoals"),
						onClick: () => void navigate({ to: "/cile" }),
					},
				]
			: []),
	];
	const synActions: { key: string; label: string; onClick: () => void }[] =
		surface === "overview"
			? overviewActions
			: surface === "tym"
				? [
						{
							key: "team-reports",
							label: t("prehled.openReports"),
							onClick: () => void navigate({ to: "/reporty" }),
						},
						{
							key: "team-flows",
							label: t("prehled.openFlows"),
							onClick: () => void navigate({ to: "/postupy" }),
						},
					]
				: [
						{
							key: "operations-command",
							label: t("prehled.openCommandCenter"),
							onClick: () => void navigate({ to: "/velin" }),
						},
						{
							key: "operations-goals",
							label: t("prehled.openGoals"),
							onClick: () => void navigate({ to: "/cile" }),
						},
						{
							key: "operations-flows",
							label: t("prehled.openFlows"),
							onClick: () => void navigate({ to: "/postupy" }),
						},
					];

	return (
		<div className="mx-auto" style={{ maxWidth: 1120, padding: "18px 22px 90px" }}>
			<section
				aria-labelledby="overview-surface-title"
				className="mb-3 flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-card px-4 py-3"
				style={{ boxShadow: "var(--w-shadow-sm)" }}
			>
				<div className="min-w-[220px] flex-1">
					<h1 id="overview-surface-title" className="m-0 font-display text-base font-bold text-ink">
						{t(`prehled.surfaceTitle.${surface}`)}
					</h1>
					<p className="mt-1 mb-0 font-body text-xs leading-relaxed text-ink-3">
						{t(`prehled.surfaceDescription.${surface}`)}
					</p>
				</div>
				<nav
					aria-label={t("nav.personalizedEntries")}
					className="flex max-w-full flex-wrap rounded-xl border border-line bg-panel-2 p-[3px]"
				>
					<button
						type="button"
						onClick={() => void navigate({ to: "/prehled", search: {} })}
						aria-pressed={surface === "overview"}
						className="min-h-11 rounded-lg px-3 font-display text-xs font-semibold"
						style={{
							background: surface === "overview" ? "var(--w-card)" : "transparent",
							color: surface === "overview" ? "var(--w-ink)" : "var(--w-ink-3)",
							boxShadow: surface === "overview" ? "var(--w-shadow-sm)" : undefined,
						}}
					>
						{t("nav.overview")}
					</button>
					<button
						type="button"
						onClick={() => void navigate({ to: "/", search: {} })}
						className="min-h-11 rounded-lg px-3 font-display text-xs font-semibold text-ink-3 hover:text-ink"
					>
						{t("nav.myDay")}
					</button>
					<button
						type="button"
						onClick={() => void navigate({ to: "/prehled", search: { vstup: "tym" } })}
						aria-pressed={surface === "tym"}
						className="min-h-11 rounded-lg px-3 font-display text-xs font-semibold"
						style={{
							background: surface === "tym" ? "var(--w-card)" : "transparent",
							color: surface === "tym" ? "var(--w-ink)" : "var(--w-ink-3)",
							boxShadow: surface === "tym" ? "var(--w-shadow-sm)" : undefined,
						}}
					>
						{t("nav.teamEntry")}
					</button>
					{leadership && (
						<button
							type="button"
							onClick={() =>
								void navigate({ to: "/prehled", search: { vstup: "provoz" } })
							}
							aria-pressed={surface === "provoz"}
							className="min-h-11 rounded-lg px-3 font-display text-xs font-semibold"
							style={{
								background: surface === "provoz" ? "var(--w-card)" : "transparent",
								color: surface === "provoz" ? "var(--w-ink)" : "var(--w-ink-3)",
								boxShadow: surface === "provoz" ? "var(--w-shadow-sm)" : undefined,
							}}
						>
							{t("nav.operationsEntry")}
						</button>
					)}
				</nav>
			</section>
			{/* chipy firem (prototyp data-ovchip) */}
			<div className="flex flex-wrap items-center" style={{ gap: 8, marginBottom: 14 }}>
				<FirmChip label={t("prehled.chipAll")} on={!firm} onClick={() => setFirm(null)} />
				{firms.map((w) => (
					<FirmChip
						key={w.id}
						label={w.name}
						dot={w.color ?? "var(--w-ink-3)"}
						on={firm === w.id}
						onClick={() => setFirm(firm === w.id ? null : w.id)}
					/>
				))}
				<div className="flex-1" />
				{/* přepínač layoutu (prototyp prop prehledLayout: Mřížka | Ranní feed) */}
				<div className="flex rounded-lg border border-line bg-panel-2" style={{ padding: 2 }}>
					{(
						[
							["grid", t("prehled.layoutGrid")],
							["feed", t("prehled.layoutFeed")],
						] as const
					).map(([k, label]) => (
						<button
							key={k}
							type="button"
							onClick={() => switchLayout(k)}
							className="rounded-md font-display font-semibold"
							style={{
								fontSize: 10.5,
								padding: "3px 9px",
								minHeight: 24,
								background: layout === k ? "var(--w-card)" : "transparent",
								color: layout === k ? "var(--w-ink)" : "var(--w-ink-3)",
								boxShadow: layout === k ? "var(--w-shadow-sm)" : undefined,
							}}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* Watsonova syntéza dne */}
			<div
				className="flex items-start"
				style={{
					gap: 12,
					background: "var(--w-brass-soft)",
					border: "1px solid rgba(198,138,62,.32)",
					borderRadius: 14,
					padding: "15px 18px",
					marginBottom: 14,
				}}
			>
				<span
					className="shrink-0 rounded-full"
					style={{ width: 9, height: 9, background: "var(--w-brass)", marginTop: 6 }}
				/>
				<div className="min-w-0 flex-1">
					<div
						className="font-display font-bold text-brass-text uppercase"
						style={{ fontSize: 10.5, letterSpacing: ".07em", marginBottom: 4 }}
					>
						{t(`prehled.surfaceSynthesis.${surface}`)} · {todayLabel} <SyncStamp />
					</div>
					<div
						className="font-body text-ink"
						style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "82ch" }}
					>
						{ready ? surfaceSummary : t("common.loadingData")}
					</div>
					{ready && synActions.length > 0 && (
						<div className="flex flex-wrap" style={{ gap: 8, marginTop: 11 }}>
							{synActions.map((a) => (
								<button
									key={a.key}
									type="button"
									onClick={a.onClick}
									className="rounded-lg border border-line bg-card font-display font-semibold text-ink-2 hover:border-brass hover:text-ink"
									style={{ fontSize: 12, padding: "5px 12px" }}
								>
									{a.label}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* karty — Mřížka / Ranní feed (prototyp data-ovlay, CSS ř. 118–119) */}
			<div
				style={
					layout === "feed"
						? {
								display: "flex",
								flexDirection: "column",
								gap: 14,
								maxWidth: 680,
								margin: "0 auto",
							}
						: {
								// min(100%, 330px): na úzkém telefonu (~360px) klesne track na
								// šířku kontejneru místo 330px → nevznikne horizontální scroll
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))",
								gap: 14,
								alignItems: "start",
							}
				}
			>
				{/* Dnes */}
				{surface === "overview" && (
					<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardToday")}
						footLabel={
							view.dnesMore > 0
								? t("prehled.moreInToday", { count: view.dnesMore })
								: t("prehled.openToday")
						}
						onFoot={() => void navigate({ to: "/" })}
					/>
					{!ready && <LoadingNote />}
					{ready && view.dnes.length === 0 && (
						<div
							className="font-body text-ink-3"
							style={{ padding: "8px 16px 16px", fontSize: 12.5 }}
						>
							{t("prehled.emptyToday")}
						</div>
					)}
					{view.dnes.map((r) => (
						<OvRow key={r.id} label={r.name} onClick={() => open(r.id)}>
							<button
								type="button"
								aria-label={t("detail.ariaComplete")}
								onClick={(e) => {
									e.stopPropagation();
									void toggleTask(r.row, session?.user?.id);
								}}
								className="pointer-events-auto relative z-[3] grid shrink-0 place-items-center rounded-full border-[1.6px] border-line bg-card text-transparent hover:border-brass"
								style={{ width: 17, height: 17 }}
							>
								<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
									<path
										d="M1.5 5.5 L4 8 L8.5 2.5"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
							<span
								className="shrink-0 rounded-full"
								style={{
									width: 8,
									height: 8,
									background: r.color ?? "var(--w-ink-3)",
								}}
							/>
							<span className="min-w-0 flex-1 truncate font-body text-ink" style={{ fontSize: 13 }}>
								{r.name}
							</span>
							{r.p1 && (
								<span
									className="shrink-0 font-mono"
									style={{
										fontSize: 10,
										color: "var(--w-overdue)",
										border: "1px solid var(--w-overdue)",
										borderRadius: 5,
										padding: "0 5px",
									}}
								>
									P1
								</span>
							)}
							<span
								className="shrink-0 font-mono"
								style={{
									fontSize: 11,
									color: r.isOver ? "var(--w-overdue)" : "var(--w-ink-3)",
								}}
							>
								{r.due}
							</span>
						</OvRow>
					))}
					</div>
				)}

				{/* Zaměstnanecký stav — jen při skutečně spárovaném LuckyOS účtu. */}
				{surface === "overview" && employee && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("employee.dashboardTitle")}
							footLabel={t("employee.dashboardOpen")}
							onFoot={() => void navigate({ to: "/zamestnanec" })}
						/>
						<div className="px-4 pb-4">
							<div className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 py-3">
								<span
									aria-hidden
									className="h-2.5 w-2.5 shrink-0 rounded-full"
									style={{
										background:
											employee.readiness.status === "ready"
												? "var(--w-success)"
												: employee.readiness.status === "blocked"
													? "var(--w-overdue)"
													: "var(--w-p2)",
									}}
								/>
								<div className="min-w-0 flex-1">
									<div className="font-display text-xs font-bold text-ink">
										{t(`employee.readiness.${employee.readiness.status}`)}
									</div>
									<div className="mt-0.5 truncate font-body text-[11.5px] text-ink-3">
										{employee.readiness.blockers.length > 0
											? t("employee.dashboardBlockers", {
													count: employee.readiness.blockers.length,
												})
											: t("employee.noBlockers")}
									</div>
								</div>
							</div>
							{(employeeNextDeadline || employeeUnread > 0) && (
								<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 font-body text-[11.5px] text-ink-3">
									{employeeNextDeadline && (
										<span>
											{employeeNextDeadline.label}
											{employeeNextDeadline.daysRemaining != null
												? ` · ${t("employee.daysRemaining", { count: employeeNextDeadline.daysRemaining })}`
												: ""}
										</span>
									)}
									{employeeUnread > 0 && (
										<span>{t("employee.dashboardNotifications", { count: employeeUnread })}</span>
									)}
								</div>
							)}
						</div>
					</div>
				)}

				{/* Waiting Room — odvozená čekání ze závislostí a aktivních kroků Postupů. */}
				<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.waitingRoom")}
						footLabel={
							waitingReady
								? t("prehled.waitingItems", {
										count: view.waiting.onMe.length + view.waiting.forOthers.length,
									})
								: undefined
						}
					/>
					<div className="mx-3 mb-2 grid grid-cols-2 rounded-lg border border-line bg-panel-2 p-[3px]">
						{(["on_me", "for_others"] as const).map((side) => {
							const count = side === "on_me" ? view.waiting.onMe.length : view.waiting.forOthers.length;
							return (
								<button
									key={side}
									type="button"
									aria-pressed={waitingSide === side}
									onClick={() => setWaitingSide(side)}
									className="min-h-11 rounded-md px-2 font-display font-semibold"
									style={{
										fontSize: 10.5,
										background: waitingSide === side ? "var(--w-card)" : "transparent",
										color: waitingSide === side ? "var(--w-ink)" : "var(--w-ink-3)",
									}}
								>
									{t(side === "on_me" ? "prehled.waitingOnMe" : "prehled.waitingForOthers")} · {waitingReady ? count : "—"}
								</button>
							);
						})}
					</div>
					{!waitingReady && <LoadingNote />}
					{waitingReady && waitingRows.length === 0 && (
						<div className="px-4 pt-1 pb-4 font-body text-ink-3" style={{ fontSize: 12.5 }}>
							{t(
								waitingSide === "on_me"
									? "prehled.waitingEmptyOnMe"
									: "prehled.waitingEmptyForOthers",
							)}
						</div>
					)}
					{waitingReady && waitingRows.map((entry: WaitingRoomEntry) => (
						<OvRow key={entry.key} label={entry.taskName} onClick={() => open(entry.taskId)}>
							<span
								aria-hidden
								className="h-2 w-2 shrink-0 rounded-full"
								style={{
									background:
										projById.get(entry.projectId ?? "")?.color ?? "var(--w-ink-3)",
								}}
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="truncate font-display font-semibold text-ink" style={{ fontSize: 12.5 }}>
										{entry.taskName}
									</span>
									<span className="shrink-0 rounded-full bg-panel-2 px-1.5 py-0.5 font-display font-semibold text-ink-3" style={{ fontSize: 9.5 }}>
										{t(entry.source === "flow" ? "prehled.waitingFlow" : "prehled.waitingDependency")}
									</span>
								</div>
								<div className="mt-0.5 truncate font-body text-ink-3" style={{ fontSize: 11.5 }}>
									{t(
										waitingSide === "on_me"
											? "prehled.waitingUnlocks"
											: "prehled.waitingBlocks",
										{ task: entry.relatedTaskName },
									)}
									{" · "}
									{waitingPeople(
										waitingSide === "on_me" ? entry.relatedOwnerIds : entry.ownerIds,
										waitingSide === "on_me",
									)}
								</div>
							</div>
							{entry.priority === 1 && (
								<span className="shrink-0 rounded border border-overdue px-1 font-mono text-overdue" style={{ fontSize: 10 }}>
									P1
								</span>
							)}
						</OvRow>
					))}
				</div>

				{/* Komunikace pro mě — zmínky, odpovědi a komentáře k mým úkolům. */}
				{surface !== "provoz" && (
					<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardCommunication")}
						footLabel={
							view.communication.length > 0
								? t("prehled.communicationCount", { count: view.communication.length })
								: undefined
						}
					/>
					<div className="mx-3 mb-2 flex rounded-lg border border-line bg-panel-2 p-[3px]">
						{(["all", "mentions", "tasks"] as const).map((filter) => (
							<button
								key={filter}
								type="button"
								aria-pressed={communicationFilter === filter}
								onClick={() => setCommunicationFilter(filter)}
								className="min-h-11 flex-1 rounded-md px-2 font-display font-semibold"
								style={{
									fontSize: 10.5,
									background: communicationFilter === filter ? "var(--w-card)" : "transparent",
									color: communicationFilter === filter ? "var(--w-ink)" : "var(--w-ink-3)",
								}}
							>
								{t(`prehled.communicationFilter${filter.charAt(0).toUpperCase()}${filter.slice(1)}`)}
							</button>
						))}
					</div>
					{!ready && <LoadingNote />}
					{ready && communicationRows.length === 0 && (
						<div className="px-4 pt-1 pb-4 font-body text-ink-3" style={{ fontSize: 12.5 }}>
							{t("prehled.communicationEmpty")}
						</div>
					)}
					{communicationRows.map((item) => (
						<OvRow
							key={item.id}
							label={`${item.author || t("detail.timelineUnknownUser")}: ${item.taskName}`}
							onClick={() => open(item.taskId)}
						>
							<span
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display font-bold text-white"
									style={{ fontSize: 9, background: "var(--w-avatar)" }}
							>
								{item.initials}
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									{item.kind === "mention" && (
										<span className="shrink-0 rounded-full bg-brass-soft px-1.5 py-0.5 font-display font-bold text-brass-text" style={{ fontSize: 9.5 }}>
											@
										</span>
									)}
									<span className="truncate font-display font-semibold text-ink" style={{ fontSize: 12.5 }}>
										{item.author || t("detail.timelineUnknownUser")}
									</span>
									<span className="truncate font-body text-ink-3" style={{ fontSize: 10.5 }}>
										· {item.taskName}
									</span>
								</div>
								<div className="mt-0.5 truncate font-body text-ink-2" style={{ fontSize: 12 }}>
									{item.body}
								</div>
							</div>
							<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
								{communicationTime(item.createdAt)}
							</span>
						</OvRow>
					))}
					</div>
				)}

				{/* Kalendář — měsíční widget s denní agendou (feedback 2026-07-11) */}
				{surface === "overview" && (
					<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardCalendar")}
						footLabel={t("prehled.openUpcoming")}
						onFoot={() => void navigate({ to: "/nadchazejici" })}
					/>
					<CalendarWidget
						onDay={(dateISO) =>
							setPeek({
								kind: "day",
								dateISO,
								firm,
								name: new Intl.DateTimeFormat(i18n.language, {
									weekday: "long",
									day: "numeric",
									month: "long",
								}).format(new Date(`${dateISO}T00:00:00`)),
								openFull: () => void navigate({ to: "/nadchazejici" }),
							})
						}
					/>
					</div>
				)}

				{/* Pošta — z digestu mail modulu (prototyp mails, ř. 741–765) */}
				{surface === "overview" && digest && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardMail")}
							footLabel={
								digest.unread > 0
									? t("prehled.mailUnread", { count: digest.unread })
									: t("prehled.openMail")
							}
							onFoot={() => void navigate({ to: "/mail" })}
						/>
						{digest.items.slice(0, 4).map((mm) => (
							<OvRow
								key={mm.id}
								label={`${mm.from}: ${mm.subj}`}
								onClick={() =>
									setPeek({
										kind: "mail",
										id: mm.id,
										openFull: () => {
											openMailThread?.(mm.id);
											void navigate({ to: "/mail" });
										},
									})
								}
							>
								<span
									className="flex shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 font-display font-bold text-ink-2"
									style={{ width: 26, height: 26, fontSize: 9.5 }}
								>
									{mm.ini}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-center" style={{ gap: 7 }}>
										{mm.unread && (
											<span
												className="shrink-0 rounded-full"
												style={{ width: 7, height: 7, background: "var(--w-brass)" }}
											/>
										)}
										<span
											className="truncate font-display font-semibold text-ink"
											style={{ fontSize: 12.5 }}
										>
											{mm.from}
										</span>
										<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
											{mm.mbShort}
										</span>
									</div>
									<div
										className="truncate font-body text-ink-2"
										style={{ fontSize: 12, marginTop: 1 }}
									>
										{mm.subj}
									</div>
								</div>
								{(mm.flag === "p1" || mm.flag === "p2") && (
									<span
										className="shrink-0 font-mono"
										style={{
											fontSize: 10,
											color: "var(--w-overdue)",
											border: "1px solid var(--w-overdue)",
											borderRadius: 5,
											padding: "0 5px",
										}}
									>
										{mm.flag.toUpperCase()}
									</span>
								)}
								<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
									{mm.time}
								</span>
							</OvRow>
						))}
					</div>
				)}

				{/* Nejbližší akce (Seznamy) */}
				{surface !== "provoz" && view.akce.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardEvents")}
							footLabel={t("prehled.allLists")}
							onFoot={() => void navigate({ to: "/seznamy", search: {} })}
						/>
						{view.akce.map((l) => (
							<OvRow
								key={l.id}
								label={l.name}
								column
								onClick={() =>
									setPeek({
										kind: "list",
										id: l.id,
										name: l.name,
										openFull: () =>
											void navigate({
												to: "/seznamy",
												search: { seznam: l.id },
											}),
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{l.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{l.event}
									</span>
								</div>
								<div className="flex items-center" style={{ gap: 9, marginTop: 7 }}>
									<div
										className="flex-1 overflow-hidden rounded-full bg-panel-2"
										style={{ height: 5 }}
									>
										<div
											style={{
												height: "100%",
												width: `${Math.min(100, l.pct)}%`,
												background: l.pct >= 100 ? "#2e9c6e" : "var(--w-brass)",
												borderRadius: "inherit",
											}}
										/>
									</div>
									<span className="shrink-0 font-mono text-ink-2" style={{ fontSize: 11 }}>
										{l.label}
									</span>
								</div>
							</OvRow>
						))}
					</div>
				)}

				{/* Cíle v ohrožení */}
				{surface !== "tym" && view.risk.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardRisk")}
							footLabel={t("prehled.openGoals")}
							onFoot={() => void navigate({ to: "/cile" })}
						/>
						{view.risk.map((g) => (
							<OvRow
								key={g.id}
								label={g.name}
								column
								onClick={() =>
									setPeek({
										kind: "goal",
										goal: g,
										openFull: () => void navigate({ to: "/cile" }),
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{g.name}
									</span>
									<span
										className="shrink-0 font-display font-bold text-brass-text"
										style={{ fontSize: 12.5 }}
									>
										{g.pct} %
									</span>
								</div>
								<div style={{ marginTop: 7, width: "100%" }}>
									<Bar pct={g.pct} />
								</div>
								<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginTop: 5 }}>
									{g.label} · {t("prehled.elapsed", { elapsed: g.elapsed })}
								</div>
							</OvRow>
						))}
					</div>
				)}

				{/* Vázne v postupech */}
				{surface !== "tym" && view.stuck.length > 0 && (
					<div className={cardCls} style={cardStyle}>
						<CardHead
							title={t("prehled.cardStuck")}
							footLabel={t("prehled.openFlows")}
							onFoot={() => void navigate({ to: "/postupy" })}
						/>
						{view.stuck.map((f) => (
							<OvRow
								key={f.id}
								label={f.name}
								column
								onClick={() =>
									setPeek({
										kind: "flow",
										flow: f,
										openFull: () =>
											void navigate({
												to: "/postupy",
												search: { postup: f.id },
											}),
									})
								}
							>
								<div className="flex w-full items-center" style={{ gap: 8 }}>
									<span
										className="shrink-0 rounded-full"
										style={{ width: 7, height: 7, background: "var(--w-overdue)" }}
									/>
									<span
										className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
										style={{ fontSize: 13 }}
									>
										{f.name}
									</span>
									<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{f.done}/{f.total}
									</span>
								</div>
								<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginTop: 4 }}>
									{t("prehled.stuckNow", {
										name: f.nowName,
										who: f.nowWho || t("flows.anyoneTeam"),
									})}
								</div>
							</OvRow>
						))}
					</div>
				)}

				{/* Dění týmu */}
				<div className={cardCls} style={cardStyle}>
					<CardHead
						title={t("prehled.cardFeed")}
						footLabel={t("prehled.openReports")}
						onFoot={() => void navigate({ to: "/reporty" })}
					/>
					{!ready && <LoadingNote />}
					{ready && view.feed.length === 0 && (
						<div
							className="font-body text-ink-3"
							style={{ padding: "8px 16px 16px", fontSize: 12.5 }}
						>
							{t("prehled.emptyFeed")}
						</div>
					)}
					{view.feed.map((f) => (
						<div
							key={f.key}
							className="flex items-start border-line border-t"
							style={{ gap: 10, padding: "8px 16px" }}
						>
							<span
								className="flex shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 font-display font-bold text-ink-2"
								style={{ width: 24, height: 24, fontSize: 9 }}
							>
								{f.ini}
							</span>
							<span
								className="min-w-0 flex-1 font-body text-ink-2"
								style={{ fontSize: 12.5, lineHeight: 1.45 }}
							>
								{f.txt}
							</span>
							<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
								{f.t}
							</span>
						</div>
					))}
				</div>
			</div>

			<PeekPanel target={peek} onClose={() => setPeek(null)} />
		</div>
	);
}

/** Chip firmy — aktivní = tmavý (prototyp data-ovchip[data-on]). */
function FirmChip({
	label,
	dot,
	on,
	onClick,
}: {
	label: string;
	dot?: string;
	on: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex items-center font-display font-semibold"
			style={{
				gap: 7,
				fontSize: 12,
				borderRadius: 999,
				padding: "5px 13px",
				cursor: "pointer",
				background: on ? "var(--w-ink)" : "var(--w-card)",
				color: on ? "var(--w-card)" : "var(--w-ink-2)",
				border: `1px solid ${on ? "var(--w-ink)" : "var(--w-line)"}`,
			}}
		>
			{dot && (
				<span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: dot }} />
			)}
			{label}
		</button>
	);
}

/** Řádek karty (prototyp data-ovrow: hover panel-2, klik). */
function OvRow({
	children,
	label,
	onClick,
	column,
}: {
	children: ReactNode;
	label: string;
	onClick?: () => void;
	column?: boolean;
}) {
	return (
		<div className="relative cursor-pointer border-line border-t hover:bg-panel-2">
			<button
				type="button"
				aria-label={label}
				onClick={(event) => {
					event.stopPropagation();
					onClick?.();
				}}
				className="absolute inset-0 z-[1] rounded-[inherit] bg-transparent focus-visible:outline-2 focus-visible:outline-brass focus-visible:outline-offset-[-2px]"
			/>
			<div
				className={
					column
						? "pointer-events-none relative z-[2]"
						: "pointer-events-none relative z-[2] flex items-center"
				}
				style={
					column
						? { padding: "9px 16px 11px" }
						: { gap: 10, padding: "8px 16px" }
				}
			>
				{children}
			</div>
		</div>
	);
}
