import { useQuery as usePsQuery } from "@powersync/react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { useAddTask } from "../lib/addTask";
import { API_URL } from "../lib/api";
import {
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_MAX_SELECTION,
	attachmentContentUrl,
	attachmentSizeLabel,
	deleteAttachment,
	finalizeAttachment,
	isAttachmentPreviewable,
	rememberAttachmentFinalization,
	stageAttachment,
} from "../lib/attachments";
import { useSession } from "../lib/auth-client";
import { USER_COLORS } from "../lib/colors";
import { focusOnMount } from "../lib/focusOnMount";
import { initials } from "../lib/format";
import { parseOccId, recurrenceKind } from "../lib/occurrences";
import type { AttachmentRow, TaskRow } from "../lib/powersync/AppSchema";
import { rescheduleDate } from "../lib/reschedule";
import { CommentComposer } from "./CommentComposer";

const CustomFieldsSection = lazy(() =>
	import("./CustomFieldsSection").then((module) => ({ default: module.CustomFieldsSection })),
);
const PollsSection = lazy(() =>
	import("./PollsSection").then((module) => ({ default: module.PollsSection })),
);
const TaskAcceptanceSection = lazy(() => import("./TaskAcceptanceSection"));

type TimelineKind =
	| "task_created"
	| "task_imported"
	| "task_updated"
	| "task_rescheduled"
	| "task_completed"
	| "task_reopened"
	| "task_deleted"
	| "task_restored"
	| "comment_added"
	| "comment_updated"
	| "comment_deleted"
	| "decision_marked"
	| "decision_unmarked"
	| "assignment_added"
	| "assignment_updated"
	| "assignment_removed"
	| "acceptance_requested"
	| "acceptance_accepted"
	| "acceptance_declined"
	| "acceptance_cancelled"
	| "reminder_added"
	| "reminder_updated"
	| "reminder_removed"
	| "attachment_added"
	| "attachment_removed"
	| "custom_field_updated"
	| "poll_created"
	| "poll_updated"
	| "poll_closed"
	| "poll_reopened"
	| "poll_deleted"
	| "poll_response_updated"
	| "dependency_added"
	| "dependency_removed"
	| "occurrence_updated"
	| "availability_override"
	| "meeting_updated"
	| "integration_created";
type TimelineEvent = {
	id: string;
	source: "audit" | "legacy";
	kind: TimelineKind;
	actorType: "user" | "ai" | "system";
	actorUserId: string | null;
	actorName: string | null;
	createdAt: string;
	changedFields: string[];
	changes: { field: string; oldValue?: string | null; newValue?: string | null }[];
	commentId?: string;
	excerpt?: string;
	relatedTaskId?: string;
	relatedUserId?: string;
	direction?: "blocked_by" | "blocks";
};
type TimelinePage = { events: TimelineEvent[]; nextCursor: string | null };
type TimelineFilter = "all" | "changes" | "decisions";

import { logTaskActivity } from "../lib/activity";
import { copyDeepLink } from "../lib/deepLink";
import { wouldCreateDependencyCycle } from "../lib/dependencies";
import { powerSync } from "../lib/powersync/db";
import { useProject } from "../lib/projects";
import { enablePush, notificationPermission } from "../lib/push";
import {
	hasEquivalentReminder,
	type ReminderCandidate,
	reminderCandidateFireAt,
	reminderCandidateKey,
	reminderFireAt,
	sortReminders,
} from "../lib/reminders";
import { useRowMeta } from "../lib/rowMeta";
import { useTaskDetail } from "../lib/taskDetail";
import { taskProgress } from "../lib/taskProgress";
import {
	occLabel,
	rowDue,
	setOccurrenceOverride,
	todayISO,
	toggleAssignmentDone,
	toggleTask,
} from "../lib/tasks";
import {
	dateInTimeZone,
	deviceTimeZone,
	wallTimeFromInstant,
	zonedDateTimeToIso,
} from "../lib/timeZone";
import { showToast } from "../lib/toast";
import { deleteTaskWithUndo } from "../lib/undo";
import { useFocusTrap } from "../lib/useFocusTrap";
import { WHY_NOW_MAX_LENGTH, type WhyNowSignal, whyNowSignals } from "../lib/whyNow";
import { useOpenMailThread } from "../mail/state";

type Pri = 1 | 2 | 3 | 4;
type Member = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	role: "commenter" | "editor" | "manager";
};
type AssignMode = "single" | "shared_any" | "shared_all";
type CommentEntry = {
	id: string;
	body: string | null;
	parent_id: string | null;
	author_id: string | null;
	created_at: string | null;
};
const COMMENT_REACTIONS = ["👍", "❤️", "🎉", "👀"] as const;

function commentBody(
	body: string,
	mentionUserIds: string[],
	members: Member[],
): ReactNode[] {
	const tokens = mentionUserIds
		.map((id) => members.find((member) => member.id === id))
		.filter((member): member is Member => Boolean(member))
		.map((member) => `@${member.name}`)
		.sort((left, right) => right.length - left.length);
	if (tokens.length === 0) return [body];
	const output: ReactNode[] = [];
	let cursor = 0;
	let key = 0;
	while (cursor < body.length) {
		let next: { at: number; token: string } | null = null;
		for (const token of tokens) {
			const at = body.indexOf(token, cursor);
			if (at >= 0 && (!next || at < next.at || (at === next.at && token.length > next.token.length))) {
				next = { at, token };
			}
		}
		if (!next) {
			output.push(body.slice(cursor));
			break;
		}
		if (next.at > cursor) output.push(body.slice(cursor, next.at));
		output.push(
			<span key={`mention-${key++}`} className="font-semibold text-brass-text">
				{next.token}
			</span>,
		);
		cursor = next.at + next.token.length;
	}
	return output;
}

/** Relativní čas komentáře („dnes 8:05" / „12. 6."). */
function whenLabel(iso: string | null, t: (k: string) => string) {
	if (!iso) return "";
	const d = new Date(iso);
	const now = new Date();
	const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
	if (d.toDateString() === now.toDateString()) return `${t("today.todayLower")} ${hm}`;
	return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

/** Historie úprav — mapa DB sloupce → i18n popisek pole. */
const ACT_FIELD_KEY: Record<string, string> = {
	name: "detail.actName",
	description: "detail.actDesc",
	why_now: "detail.actWhyNow",
	due_date: "detail.actDue",
	start_date: "detail.actTime",
	start_timezone: "detail.actTime",
	duration_min: "detail.actTime",
	days: "detail.actDuration",
	deadline: "detail.actDeadline",
	priority: "detail.actPriority",
	color: "detail.actColor",
	recurrence: "detail.actRecurrence",
	recurrence_rule: "detail.actRecurrence",
	assignment_mode: "detail.actAssign",
	status_id: "detail.actStatus",
	project_id: "detail.actProject",
	parent_id: "detail.actParent",
	completed: "detail.actCompleted",
	completed_at: "detail.actCompleted",
	created: "detail.actCreated",
};
function actFieldLabel(field: string, t: (k: string) => string) {
	return t(ACT_FIELD_KEY[field] ?? "detail.actField");
}

const TIMELINE_KIND_KEY: Record<TimelineKind, string> = {
	task_created: "detail.timelineTaskCreated",
	task_imported: "detail.timelineTaskImported",
	task_updated: "detail.timelineTaskUpdated",
	task_rescheduled: "detail.timelineTaskRescheduled",
	task_completed: "detail.actMarkedDone",
	task_reopened: "detail.actMarkedUndone",
	task_deleted: "detail.timelineTaskDeleted",
	task_restored: "detail.timelineTaskRestored",
	comment_added: "detail.timelineCommentAdded",
	comment_updated: "detail.timelineCommentUpdated",
	comment_deleted: "detail.timelineCommentDeleted",
	decision_marked: "detail.actMarkedDecision",
	decision_unmarked: "detail.actUnmarkedDecision",
	assignment_added: "detail.timelineAssignmentAdded",
	assignment_updated: "detail.timelineAssignmentUpdated",
	assignment_removed: "detail.timelineAssignmentRemoved",
	acceptance_requested: "detail.timelineAcceptanceRequested",
	acceptance_accepted: "detail.timelineAcceptanceAccepted",
	acceptance_declined: "detail.timelineAcceptanceDeclined",
	acceptance_cancelled: "detail.timelineAcceptanceCancelled",
	reminder_added: "detail.timelineReminderAdded",
	reminder_updated: "detail.timelineReminderUpdated",
	reminder_removed: "detail.timelineReminderRemoved",
	attachment_added: "detail.timelineAttachmentAdded",
	attachment_removed: "detail.timelineAttachmentRemoved",
	custom_field_updated: "detail.timelineCustomFieldUpdated",
	poll_created: "detail.timelinePollCreated",
	poll_updated: "detail.timelinePollUpdated",
	poll_closed: "detail.timelinePollClosed",
	poll_reopened: "detail.timelinePollReopened",
	poll_deleted: "detail.timelinePollDeleted",
	poll_response_updated: "detail.timelinePollResponseUpdated",
	dependency_added: "detail.timelineDependencyAdded",
	dependency_removed: "detail.timelineDependencyRemoved",
	occurrence_updated: "detail.timelineOccurrenceUpdated",
	availability_override: "detail.timelineAvailabilityOverride",
	meeting_updated: "detail.timelineMeetingUpdated",
	integration_created: "detail.timelineIntegrationCreated",
};

const isDecisionTimelineEvent = (event: TimelineEvent) => event.kind.startsWith("decision_");
const isChangeTimelineEvent = (event: TimelineEvent) =>
	!event.kind.startsWith("comment_") && !event.kind.startsWith("decision_");

const WHY_NOW_SIGNAL_KEY: Record<WhyNowSignal, string> = {
	due_overdue: "detail.whyNowDueOverdue",
	due_today: "detail.whyNowDueToday",
	deadline_overdue: "detail.whyNowDeadlineOverdue",
	deadline_today: "detail.whyNowDeadlineToday",
	deadline_soon: "detail.whyNowDeadlineSoon",
	starts_today: "detail.whyNowStartsToday",
	priority_one: "detail.whyNowPriorityOne",
};
/** Lidsky čitelná hodnota pole pro log (priorita → P2, datum → 8.7. 14:00…). */
function fmtActVal(field: string, val: unknown): string | null {
	if (val == null || val === "") return null;
	if (field === "priority") return `P${val}`;
	if (field === "duration_min") return `${val} min`;
	if (field === "due_date" || field === "deadline") {
		const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(val));
		if (dateOnly) return `${Number(dateOnly[3])}. ${Number(dateOnly[2])}.`;
		return String(val);
	}
	if (field === "start_date") {
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

function fmtTimelineActVal(field: string, val: unknown, t: (key: string) => string): string | null {
	if (
		field === "assignment_mode" &&
		(val === "single" || val === "shared_any" || val === "shared_all")
	) {
		return t(`assignment.${val}`);
	}
	return fmtActVal(field, val);
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

/** CSP záměrně nepovoluje cizí image origin. Obsah proto načteme autorizovaně a
 * obrázek zobrazíme jen z krátkodobého device-local blob URL. */
function AttachmentImagePreview({ path }: { path: string }) {
	const [blobUrl, setBlobUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		let localUrl: string | null = null;
		setBlobUrl(null);
		setFailed(false);
		void fetch(attachmentContentUrl(path), { credentials: "include" })
			.then((response) => {
				if (!response.ok) throw new Error("attachment_preview");
				return response.blob();
			})
			.then((blob) => {
				if (!active) return;
				localUrl = URL.createObjectURL(blob);
				setBlobUrl(localUrl);
			})
			.catch(() => {
				if (active) setFailed(true);
			});
		return () => {
			active = false;
			if (localUrl) URL.revokeObjectURL(localUrl);
		};
	}, [path]);
	if (!blobUrl || failed) {
		return (
			<span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-card font-display font-bold text-ink-3 text-[10px]">
				{failed ? "IMG" : "…"}
			</span>
		);
	}
	return (
		<img
			src={blobUrl}
			alt=""
			className="h-12 w-12 shrink-0 rounded-lg border border-line bg-card object-cover"
		/>
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
			className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
		>
			<span
				className="grid place-items-center hover:border-brass"
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
			</span>
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
	const { t, i18n } = useTranslation();
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
	const [histOpen, setHistOpen] = useState(false);
	const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");

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
				!!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
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

	const { data: rows } = usePsQuery<TaskRow>("SELECT * FROM tasks WHERE id = ? LIMIT 1", [realId]);
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
	const { data: parentRows } = usePsQuery<TaskRow>("SELECT * FROM tasks WHERE id = ? LIMIT 1", [
		task?.parent_id ?? "",
	]);
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
	const { data: comments } = usePsQuery<CommentEntry>(
		"SELECT id, body, parent_id, author_id, created_at FROM comments WHERE task_id = ? ORDER BY created_at",
		[realId],
	);
	const { data: attachments } = usePsQuery<AttachmentRow>(
		"SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at, id",
		[realId],
	);
	const { data: commentDecisions } = usePsQuery<{
		id: string;
		comment_id: string;
		marked_by: string | null;
		created_at: string | null;
	}>(
		"SELECT id, comment_id, marked_by, created_at FROM comment_decisions WHERE task_id = ? ORDER BY created_at",
		[realId],
	);
	const { data: commentMentions } = usePsQuery<{
		comment_id: string;
		user_id: string;
	}>("SELECT comment_id, user_id FROM mentions WHERE task_id = ?", [realId]);
	const { data: commentReactions } = usePsQuery<{
		id: string;
		comment_id: string;
		user_id: string;
		emoji: string;
	}>("SELECT id, comment_id, user_id, emoji FROM comment_reactions WHERE task_id = ?", [realId]);
	const { data: assignRows } = usePsQuery<{
		id: string;
		user_id: string | null;
		completed_at: string | null;
	}>("SELECT id, user_id, completed_at FROM assignments WHERE task_id = ?", [realId]);
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
	const [reminderBusyKey, setReminderBusyKey] = useState<string | null>(null);
	const [attachmentBusy, setAttachmentBusy] = useState(false);
	const [attachmentDeleteConfirm, setAttachmentDeleteConfirm] = useState<string | null>(null);
	const { data: incomingDependencies } = usePsQuery<{
		id: string;
		task_id: string;
		name: string | null;
		completed_at: string | null;
	}>(
		`SELECT d.id, blocker.id AS task_id, blocker.name, blocker.completed_at
		 FROM task_dependencies d JOIN tasks blocker ON blocker.id = d.blocking_task_id
		 WHERE d.blocked_task_id = ? ORDER BY blocker.completed_at IS NOT NULL, blocker.name`,
		[realId],
	);
	const { data: outgoingDependencies } = usePsQuery<{
		id: string;
		task_id: string;
		name: string | null;
		completed_at: string | null;
	}>(
		`SELECT d.id, blocked.id AS task_id, blocked.name, blocked.completed_at
		 FROM task_dependencies d JOIN tasks blocked ON blocked.id = d.blocked_task_id
		 WHERE d.blocking_task_id = ? ORDER BY blocked.completed_at IS NOT NULL, blocked.name`,
		[realId],
	);
	const { data: dependencyCandidates } = usePsQuery<{
		id: string;
		name: string | null;
		completed_at: string | null;
	}>(
		"SELECT id, name, completed_at FROM tasks WHERE project_id = ? AND id <> ? AND kind = 'task' ORDER BY completed_at IS NOT NULL, name LIMIT 500",
		[task?.project_id ?? "", realId],
	);
	// Jedna autoritativní časová osa: audit_events + deduplikovaná legacy historie.
	const timelineQuery = useInfiniteQuery({
		queryKey: ["taskTimeline", realId],
		enabled: !!realId,
		initialPageParam: null as string | null,
		queryFn: async ({ pageParam }): Promise<TimelinePage> => {
			const params = new URLSearchParams({ limit: "50" });
			if (pageParam) params.set("cursor", pageParam);
			const response = await fetch(`${API_URL}/api/tasks/${realId}/timeline?${params}`, {
				credentials: "include",
			});
			if (!response.ok) throw new Error("task_timeline");
			return (await response.json()) as TimelinePage;
		},
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		refetchInterval: histOpen ? 5_000 : false,
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

	const reminderTiming = {
		startDate: task?.start_date ?? null,
		dueDate: task?.due_date ?? null,
	};
	const orderedReminders = sortReminders(reminders ?? [], reminderTiming);
	const relativeBase = task?.start_date ? "start" : task?.due_date ? "due" : null;
	const relativeLabel = (offsetMin: number) => {
		if (offsetMin === 0) {
			return t(relativeBase === "start" ? "detail.remAtStart" : "detail.remAtDue");
		}
		return `${fmtOffset(offsetMin)} ${t(
			relativeBase === "start" ? "detail.remBeforeStart" : "detail.remBeforeDue",
		)}`;
	};
	const reminderDateLabel = (reminder: (typeof orderedReminders)[number]) => {
		const timestamp = reminderFireAt(reminder, reminderTiming);
		if (timestamp == null) return null;
		return new Intl.DateTimeFormat(i18n.language, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(timestamp);
	};

	const addReminder = async (candidate: ReminderCandidate) => {
		if (!task) return;
		const uid = session?.user?.id;
		if (!uid) return;
		const candidateFireAt = reminderCandidateFireAt(candidate, reminderTiming);
		if (candidateFireAt == null || candidateFireAt <= Date.now()) {
			showToast(t("detail.remPast"));
			return;
		}
		if (hasEquivalentReminder(reminders ?? [], candidate)) {
			showToast(t("detail.remDuplicate"));
			return;
		}
		const busyKey = reminderCandidateKey(candidate);
		if (reminderBusyKey === busyKey) return;
		setReminderBusyKey(busyKey);
		try {
			await powerSync.execute(
				"INSERT INTO reminders (id, task_id, project_id, user_id, type, remind_at, offset_min, channel, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, 'push', ?)",
				[
					realId,
					task.project_id,
					uid,
					candidate.type,
					candidate.type === "time" ? candidate.remindAt : null,
					candidate.type === "relative" ? candidate.offsetMin : null,
					new Date().toISOString(),
				],
			);
			showToast(t("detail.remAdded"));
			void enablePush(); // vyžádá povolení notifikací v momentě záměru
		} catch {
			showToast(t("detail.remAddFailed"));
		} finally {
			setReminderBusyKey(null);
		}
	};

	const removeReminder = async (rid: string) => {
		try {
			await powerSync.execute("DELETE FROM reminders WHERE id = ?", [rid]);
			showToast(t("detail.remRemoved"));
		} catch {
			showToast(t("detail.remRemoveFailed"));
		}
	};

	const uploadTaskAttachments = async (selected: File[]) => {
		if (!task || attachmentBusy || selected.length === 0) return;
		if (!navigator.onLine) {
			showToast(t("detail.attachmentOffline"));
			return;
		}
		const valid = selected
			.filter((file) => file.size > 0 && file.size <= ATTACHMENT_MAX_BYTES)
			.slice(0, ATTACHMENT_MAX_SELECTION);
		if (valid.length !== selected.length) showToast(t("detail.attachmentInvalidSize"));
		if (valid.length === 0) return;
		setAttachmentBusy(true);
		let completed = 0;
		try {
			for (const file of valid) {
				const staged = await stageAttachment(realId, task.project_id ?? "", file);
				try {
					await finalizeAttachment(staged.stageId);
					completed += 1;
				} catch {
					await rememberAttachmentFinalization(staged.stageId, realId);
					completed += 1;
				}
			}
			showToast(t("detail.attachmentUploaded", { count: completed }));
			void qc.invalidateQueries({ queryKey: ["taskTimeline", realId] });
		} catch {
			showToast(t("detail.attachmentUploadFailed"));
		} finally {
			setAttachmentBusy(false);
		}
	};

	const removeAttachment = async (attachmentId: string) => {
		if (attachmentDeleteConfirm !== attachmentId) {
			setAttachmentDeleteConfirm(attachmentId);
			showToast(t("detail.attachmentDeleteConfirm"));
			return;
		}
		setAttachmentBusy(true);
		try {
			await deleteAttachment(attachmentId);
			setAttachmentDeleteConfirm(null);
			showToast(t("detail.attachmentDeleted"));
			void qc.invalidateQueries({ queryKey: ["taskTimeline", realId] });
		} catch {
			showToast(t("detail.attachmentDeleteFailed"));
		} finally {
			setAttachmentBusy(false);
		}
	};

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
	const [whyNow, setWhyNow] = useState("");
	const [whyNowOpen, setWhyNowOpen] = useState(false);
	const [subText, setSubText] = useState("");
	const [cmtText, setCmtText] = useState("");
	const [replyTo, setReplyTo] = useState<string | null>(null);
	const [replyText, setReplyText] = useState("");
	const [reactionPicker, setReactionPicker] = useState<string | null>(null);
	const [reactionBusy, setReactionBusy] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [assignOpen, setAssignOpen] = useState(false);
	const [selectedBlockerId, setSelectedBlockerId] = useState("");
	const [dependencyBusy, setDependencyBusy] = useState(false);
	// Vlastnosti (priorita/termín/deadline/čas/trvání/barva) rovnou viditelné —
	// kompletní přehledné menu i pro podúkoly (dřív schované za klikem na chip).
	const [editOpen, setEditOpen] = useState(true);
	// V3 save-UX: čas posledního uložení (zpětná vazba „Uloženo ✓ HH:MM").
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	// In-flight zámky proti dvojímu vložení podúkolu/komentáře (dvojí rychlý Enter).
	const addingSub = useRef(false);
	const addingCmt = useRef(false);
	// Seed lokálního stavu jen při PŘEPNUTÍ úkolu (task.id), ne při každém sync updatu —
	// jinak vzdálená změna jiného sloupce (status/priorita…) přepíše rozepsaný neuložený
	// název/popis uprostřed psaní.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reseed jen na task.id
	useEffect(() => {
		if (task) {
			setName(task.name ?? "");
			setDesc(task.description ?? "");
			setWhyNow(task.why_now ?? "");
			setWhyNowOpen(false);
			setSelectedBlockerId("");
		}
	}, [task?.id]);

	if (!task) return null;
	const done = occ ? Boolean(occOverride?.done) : Boolean(task.completed_at);
	const cmts = comments ?? [];
	const asg = assignRows ?? [];
	const members = team ?? [];
	const memberOf = (uid: string | null) => members.find((m) => m.id === uid);
	const myProjectRole = members.find((m) => m.id === session?.user?.id)?.role;
	const canDecide = myProjectRole === "editor" || myProjectRole === "manager";
	const canEditCustomFields = myProjectRole === "editor" || myProjectRole === "manager";
	const canManagePolls = myProjectRole === "editor" || myProjectRole === "manager";
	const canDeleteAnyAttachment = myProjectRole === "editor" || myProjectRole === "manager";
	const decisionsByComment = new Map((commentDecisions ?? []).map((d) => [d.comment_id, d]));
	const mentionIdsByComment = new Map<string, string[]>();
	for (const mention of commentMentions ?? []) {
		const ids = mentionIdsByComment.get(mention.comment_id) ?? [];
		ids.push(mention.user_id);
		mentionIdsByComment.set(mention.comment_id, ids);
	}
	const reactionsByComment = new Map<string, { emoji: string; count: number; mineId: string | null }[]>();
	for (const reaction of commentReactions ?? []) {
		const groups = reactionsByComment.get(reaction.comment_id) ?? [];
		let group = groups.find((candidate) => candidate.emoji === reaction.emoji);
		if (!group) {
			group = { emoji: reaction.emoji, count: 0, mineId: null };
			groups.push(group);
		}
		group.count += 1;
		if (reaction.user_id === session?.user?.id) group.mineId = reaction.id;
		reactionsByComment.set(reaction.comment_id, groups);
	}
	const commentIds = new Set(cmts.map((comment) => comment.id));
	const rootComments = cmts.filter((comment) => !comment.parent_id || !commentIds.has(comment.parent_id));
	const repliesByComment = new Map<string, CommentEntry[]>();
	for (const comment of cmts) {
		if (!comment.parent_id || !commentIds.has(comment.parent_id)) continue;
		const replies = repliesByComment.get(comment.parent_id) ?? [];
		replies.push(comment);
		repliesByComment.set(comment.parent_id, replies);
	}
	const timelineEvents = Array.from(
		new Map(
			(timelineQuery.data?.pages ?? [])
				.flatMap((page) => page.events)
				.map((event) => [event.id, event] as const),
		).values(),
	);
	const filteredTimeline = timelineEvents.filter((event) =>
		timelineFilter === "decisions"
			? isDecisionTimelineEvent(event)
			: timelineFilter === "changes"
				? isChangeTimelineEvent(event)
				: true,
	);
	const relevanceSignals = whyNowSignals(task, { deviceTimeZone: deviceTimeZone() });

	// Zápis jednoho záznamu do historie úprav.
	const logActivity = async (field: string, oldVal: string | null, newVal: string | null) => {
		const uid = session?.user?.id;
		if (!task || !uid) return;
		// sdílený zapisovač (lib/activity) — stejná historie i pro create/bulk/toggle
		await logTaskActivity(realId, task.project_id, uid, field, oldVal, newVal);
		// API timeline si po uploadu vezme autoritativní audit a legacy řádek deduplikuje.
		void qc.invalidateQueries({ queryKey: ["taskTimeline", realId] });
	};

	/** Rozhodnutí je samostatný auditovatelný objekt; text komentáře zůstává nedotčený. */
	const toggleCommentDecision = async (commentId: string) => {
		if (!canDecide || !session?.user?.id) return;
		const existing = decisionsByComment.get(commentId);
		if (existing) {
			await powerSync.execute("DELETE FROM comment_decisions WHERE id = ?", [existing.id]);
			await logActivity("comment_decision", commentId, null);
			showToast(t("detail.decisionUnmarked"));
			return;
		}
		await powerSync.execute(
			"INSERT INTO comment_decisions (id, comment_id, task_id, project_id, marked_by, created_at) VALUES (uuid(), ?, ?, ?, ?, ?)",
			[commentId, realId, task.project_id, session.user.id, new Date().toISOString()],
		);
		await logActivity("comment_decision", null, commentId);
		showToast(t("detail.decisionMarked"));
	};

	// V3: patch úkolu + zápis do historie + „Uloženo ✓" + cílené Zpět (revert bez logu).
	const patchLog = async (data: Record<string, unknown>) => {
		if (!task) return;
		const cur = task as unknown as Record<string, unknown>;
		const changed = Object.entries(data).filter(
			([k, v]) => String(cur[k] ?? "") !== String(v ?? ""),
		);
		if (changed.length === 0) return;
		const oldData = Object.fromEntries(changed.map(([k]) => [k, cur[k] ?? null]));
		for (const [k, v] of changed) await logActivity(k, fmtActVal(k, cur[k]), fmtActVal(k, v));
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

	const toggleDone = async () => {
		if (occ) {
			void setOccurrenceOverride(realId, task.project_id, occ.iso, {
				done: !done,
			});
			return;
		}
		// „completed" logujeme až podle SKUTEČNÉ změny tasks.completed_at — u opakovaného
		// úkolu (jen posun řady) ani u shared_all dílčí účasti se úkol nedokončí, takže
		// „označil hotovo" by lhalo. Porovnáme stav před/po zápisu.
		const before = !!task.completed_at;
		await toggleTask(task, session?.user?.id);
		const after = await powerSync.getAll<{ completed_at: string | null }>(
			"SELECT completed_at FROM tasks WHERE id = ? LIMIT 1",
			[realId],
		);
		const nowDone = !!after[0]?.completed_at;
		if (before !== nowDone)
			void logActivity("completed", before ? "1" : null, nowDone ? "1" : null);
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
		if (existing) await powerSync.execute("DELETE FROM assignments WHERE id = ?", [existing.id]);
		else
			await powerSync.execute(
				"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
				[realId, task.project_id, uid, new Date().toISOString()],
			);
	};
	// R2 — per-osoba checkbox musí projít odvozeným modelem (dokončit úkol/status/postup
	// až když jsou hotoví všichni) + undo; přímý UPDATE assignments to dřív obcházel.
	const togglePersonDone = (a: { id: string; completed_at: string | null }) =>
		void toggleAssignmentDone(task, a.id);

	// Rychlé přidání (checklist styl) — dědí JEN projekt (žádné atributy rodiče),
	// priorita základní P4; Enter přidá a nechá focus. Synchronní in-flight zámek (ref):
	// dvojí rychlý Enter jinak projde guardem dřív, než setState vyprázdní input → duplikát.
	const addSub = async () => {
		if (!subText.trim() || depth >= 3 || addingSub.current) return;
		addingSub.current = true;
		try {
			await powerSync.execute(
				"INSERT INTO tasks (id, project_id, parent_id, name, priority, created_at) VALUES (uuid(), ?, ?, ?, 4, ?)",
				[task.project_id, realId, subText.trim(), new Date().toISOString()],
			);
			setSubText("");
		} finally {
			addingSub.current = false;
		}
	};
	const addCmt = async (body: string, parentId: string | null, mentionUserIds: string[]) => {
		const uid = session?.user?.id;
		if (!body.trim() || !uid || addingCmt.current) return;
		addingCmt.current = true;
		try {
			const commentId = crypto.randomUUID();
			const createdAt = new Date().toISOString();
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(
					"INSERT INTO comments (id, task_id, project_id, parent_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
					[commentId, realId, task.project_id, parentId, uid, body.trim(), createdAt],
				);
				for (const mentionedUserId of new Set(mentionUserIds)) {
					await tx.execute(
						"INSERT INTO mentions (id, comment_id, task_id, project_id, user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
						[
							crypto.randomUUID(),
							commentId,
							realId,
							task.project_id,
							mentionedUserId,
							uid,
							createdAt,
						],
					);
				}
			});
			if (parentId) {
				setReplyText("");
				setReplyTo(null);
			} else {
				setCmtText("");
			}
		} catch {
			showToast(t("detail.commentAddFailed"));
		} finally {
			addingCmt.current = false;
		}
	};
	const toggleReaction = async (commentId: string, emoji: string) => {
		const uid = session?.user?.id;
		const busyKey = `${commentId}:${emoji}`;
		if (!uid || reactionBusy) return;
		setReactionBusy(busyKey);
		try {
			const mine = reactionsByComment
				.get(commentId)
				?.find((group) => group.emoji === emoji)?.mineId;
			if (mine) {
				await powerSync.execute("DELETE FROM comment_reactions WHERE id = ?", [mine]);
			} else {
				await powerSync.execute(
					"INSERT INTO comment_reactions (id, comment_id, task_id, project_id, user_id, emoji, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?)",
					[commentId, realId, task.project_id, uid, emoji, new Date().toISOString()],
				);
			}
			setReactionPicker(null);
		} catch {
			showToast(t("detail.reactionFailed"));
		} finally {
			setReactionBusy(null);
		}
	};

	/** Duplikace včetně podúkolů (rekurzivně) a přiřazení (prototyp kopíruje celý objekt). */
	const duplicate = async () => {
		const now = new Date().toISOString();
		const copyOne = async (srcId: string, newParentId: string | null, suffix: string) => {
			const nid = crypto.randomUUID();
			await powerSync.execute(
				`INSERT INTO tasks (id, project_id, section_id, parent_id, name, description, why_now, priority, color,
          due_date, start_date, start_timezone, deadline, duration_min, days, recurrence, recurrence_rule,
          recurrence_basis, assignment_mode, created_at)
         SELECT ?, project_id, section_id, ?, name || ?, description, why_now, priority, color,
          due_date, start_date, start_timezone, deadline, duration_min, days, recurrence, recurrence_rule,
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
		const nid = await copyOne(realId, task?.parent_id ?? null, ` ${t("detail.copySuffix")}`);
		setMenuOpen(false);
		open(nid);
	};
	const copyLink = async () => {
		const copied = await copyDeepLink("task", realId, project?.workspace_id);
		setMenuOpen(false);
		showToast(t(copied ? "deepLink.copied" : "deepLink.copyFailed"));
	};
	const detachFromParent = async () => {
		const parentId = task.parent_id;
		if (!parentId) return;
		const parentLabel = parent?.name ?? parentId;
		const standaloneLabel = t("detail.standaloneTask");
		await logActivity("parent_id", parentLabel, standaloneLabel);
		await patch(realId, { parent_id: null });
		setMenuOpen(false);
		showToast(t("detail.detachedFromParent"), {
			label: t("detail.undo"),
			onClick: () => {
				void (async () => {
					await logTaskActivity(
						realId,
						task.project_id,
						session?.user?.id,
						"parent_id",
						standaloneLabel,
						parentLabel,
					);
					await patch(realId, { parent_id: parentId });
					void qc.invalidateQueries({ queryKey: ["taskActivity", realId] });
				})();
			},
		});
	};
	const addDependency = async () => {
		if (!selectedBlockerId || dependencyBusy) return;
		setDependencyBusy(true);
		try {
			if (await wouldCreateDependencyCycle(selectedBlockerId, realId)) {
				showToast(t("detail.dependencyCycle"));
				return;
			}
			await powerSync.execute(
				"INSERT INTO task_dependencies (id, project_id, blocking_task_id, blocked_task_id, created_by, created_at) VALUES (uuid(), ?, ?, ?, ?, ?)",
				[
					task.project_id,
					selectedBlockerId,
					realId,
					session?.user?.id ?? null,
					new Date().toISOString(),
				],
			);
			setSelectedBlockerId("");
			showToast(t("detail.dependencyAdded"));
		} catch {
			showToast(t("detail.dependencyAddFailed"));
		} finally {
			setDependencyBusy(false);
		}
	};
	const removeDependency = async (dependencyId: string) => {
		try {
			await powerSync.execute("DELETE FROM task_dependencies WHERE id = ?", [dependencyId]);
			showToast(t("detail.dependencyRemoved"));
		} catch {
			showToast(t("detail.dependencyRemoveFailed"));
		}
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
	const subtaskProgress = taskProgress(subs ?? []);
	const incomingDependencyIds = new Set(
		(incomingDependencies ?? []).map((dependency) => dependency.task_id),
	);
	const availableDependencyCandidates = (dependencyCandidates ?? []).filter(
		(candidate) => !incomingDependencyIds.has(candidate.id),
	);
	const unresolvedDependencyCount = (incomingDependencies ?? []).filter(
		(dependency) => !dependency.completed_at,
	).length;
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
	const renderCommentCard = (cm: CommentEntry, isReply = false) => {
		const author = memberOf(cm.author_id);
		const decision = decisionsByComment.get(cm.id);
		const reactionGroups = reactionsByComment.get(cm.id) ?? [];
		return (
			<div
				key={cm.id}
				data-comment-id={cm.id}
				className={isReply ? "ml-7 border-line border-l pl-3" : ""}
				style={{ marginBottom: 8 }}
			>
				<div className="flex" style={{ gap: 9 }}>
					<span
						className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-display font-semibold text-white"
						style={{ fontSize: 10, background: "var(--w-avatar)" }}
					>
						{initials(author?.name ?? "?")}
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center font-display font-semibold text-ink" style={{ fontSize: 12.5, gap: "4px 8px" }}>
							<span>
								{author?.name ?? t("detail.timelineUnknownUser")} {" "}
								<span className="font-body text-ink-3" style={{ fontSize: 11 }}>
									· {whenLabel(cm.created_at, t)}
								</span>
							</span>
							{decision && !canDecide && (
								<span className="rounded-full bg-brass-soft px-2 py-1 text-brass-text" style={{ fontSize: 10.5 }}>
									{t("detail.decision")}
								</span>
							)}
						</div>
						<div className="mt-0.5 whitespace-pre-wrap break-words font-body text-ink-2" style={{ fontSize: 13 }}>
							{commentBody(cm.body ?? "", mentionIdsByComment.get(cm.id) ?? [], members)}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-1.5">
							{reactionGroups.map((group) => (
								<button
									key={group.emoji}
									type="button"
									aria-pressed={Boolean(group.mineId)}
									disabled={reactionBusy === `${cm.id}:${group.emoji}`}
									onClick={() => void toggleReaction(cm.id, group.emoji)}
									className="min-h-11 min-w-11 rounded-full border px-2 font-display font-semibold hover:border-brass"
									style={{
										fontSize: 11,
										borderColor: group.mineId ? "var(--w-brass)" : "var(--w-line)",
										background: group.mineId ? "var(--w-brass-soft)" : "transparent",
									}}
								>
									{group.emoji} {group.count}
								</button>
							))}
							<button
								type="button"
								aria-expanded={reactionPicker === cm.id}
								onClick={() => setReactionPicker((current) => (current === cm.id ? null : cm.id))}
								className="min-h-11 rounded-lg px-2 font-display font-semibold text-ink-3 hover:bg-panel-2 hover:text-ink"
								style={{ fontSize: 11 }}
							>
								{t("detail.react")}
							</button>
							{!isReply && (
								<button
									type="button"
									onClick={() => {
										setReplyTo((current) => (current === cm.id ? null : cm.id));
										setReplyText("");
									}}
									className="min-h-11 rounded-lg px-2 font-display font-semibold text-ink-3 hover:bg-panel-2 hover:text-ink"
									style={{ fontSize: 11 }}
								>
									{t("detail.reply")}
								</button>
							)}
							{canDecide && (
								<button
									type="button"
									aria-pressed={Boolean(decision)}
									onClick={() => void toggleCommentDecision(cm.id)}
									className="w-comment-decision min-h-11 rounded-lg border px-2 font-display font-semibold hover:border-brass"
									style={{
										fontSize: 10.5,
										borderColor: decision ? "var(--w-brass)" : "var(--w-line)",
										background: decision ? "var(--w-brass-soft)" : "transparent",
										color: decision ? "var(--w-brass-text)" : "var(--w-ink-3)",
									}}
								>
									{decision ? t("detail.decision") : `+ ${t("detail.decision")}`}
								</button>
							)}
						</div>
						{reactionPicker === cm.id && (
							<div className="mt-1 flex flex-wrap gap-1.5 rounded-lg border border-line bg-panel-2 p-1.5">
								{COMMENT_REACTIONS.map((emoji) => (
									<button
										key={emoji}
										type="button"
										aria-label={t("detail.reactWith", { emoji })}
										disabled={Boolean(reactionBusy)}
										onClick={() => void toggleReaction(cm.id, emoji)}
										className="min-h-11 min-w-11 rounded-lg text-lg hover:bg-card"
									>
										{emoji}
									</button>
								))}
							</div>
						)}
					</div>
				</div>
				{!isReply && (repliesByComment.get(cm.id)?.length ?? 0) > 0 && (
					<div className="mt-2">
						{repliesByComment.get(cm.id)?.map((reply) => renderCommentCard(reply, true))}
					</div>
				)}
				{!isReply && replyTo === cm.id && (
					<div className="mt-2 ml-7 border-line border-l pl-3">
						<CommentComposer
							autoFocus
							value={replyText}
							onChange={setReplyText}
							members={members}
							placeholder={t("detail.replyPlaceholder")}
							submitLabel={t("detail.replySend")}
							onCancel={() => {
								setReplyTo(null);
								setReplyText("");
							}}
							onSubmit={(body, mentionUserIds) => addCmt(body, cm.id, mentionUserIds)}
						/>
					</div>
				)}
			</div>
		);
	};

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
					aria-label={t("detail.dialogLabel")}
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
								{new Date(savedAt).toLocaleTimeString(i18n.language, {
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
								className="grid h-11 w-11 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
							>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
									<circle cx="8" cy="3.5" r="1.4" />
									<circle cx="8" cy="8" r="1.4" />
									<circle cx="8" cy="12.5" r="1.4" />
								</svg>
							</button>
							{menuOpen && (
								<div
									className="absolute border border-line bg-card"
									style={{
										top: 44,
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
								{task.parent_id && (
									<MenuItem icon="ukoly" onClick={() => void detachFromParent()}>
										{t("detail.detachFromParent")}
									</MenuItem>
								)}
									{/* U výskytu řady „Smazat" skryto — mazalo by CELOU řadu (base úkol),
									    ne jeden výskyt. Odebrání výskytu = tlačítko „Přeskočit" v patičce. */}
									{!occ && (
										<>
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
										</>
									)}
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("common.cancel")}
							className="grid h-11 w-11 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
						>
							<Icon name="zavrit" size={16} />
						</button>
					</div>

					{/* body */}
					<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "0 18px 18px" }}>
						{/* vrstvení: odkaz na rodičovský úkol */}
						{parent && (
							<button
								type="button"
								onClick={() => open(parent.id)}
								className="mt-3 inline-flex items-center font-display font-semibold text-ink-3 hover:text-brass-text"
								style={{ gap: 6, fontSize: 12 }}
							>
								↑ {t("detail.inTask")}: <span className="text-ink-2">{parent.name}</span>
							</button>
						)}

						{/* checkbox + název (ř. 993–997) */}
						<div className="flex items-start" style={{ gap: 11, marginTop: 16 }}>
							<button
								type="button"
								onClick={toggleDone}
								aria-label={done ? t("today.doneSection") : t("common.done")}
								className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
							>
								<span
									className="grid h-[22px] w-[22px] place-items-center rounded-full hover:border-brass"
									style={{
										border: done ? "none" : "2px solid var(--w-line)",
										background: done ? "var(--w-brass)" : "transparent",
									}}
								>
									{done && (
										<svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden>
											<path
												d="M2 5.7 L4.3 8 L9 2.7"
												stroke="#fff"
												strokeWidth="1.7"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
								</span>
							</button>
							<input
								ref={nameRef}
								aria-label={t("detail.nameLabel")}
								value={name}
								onChange={(e) => setName(e.target.value)}
								onBlur={() =>
									name.trim() && name !== task.name && void patchLog({ name: name.trim() })
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
									<span className="font-mono" style={{ fontSize: 12, color: "var(--w-ink-2)" }}>
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
						<div className="flex flex-wrap" style={{ gap: 8, margin: "16px 0 0" }}>
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
										color: (occ ? overdue : due.overdue) ? "var(--w-overdue)" : "var(--w-ink-2)",
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
										background: (status.name ?? "").toLowerCase().includes("kontrol")
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
									{t("detail.remindersCount", { count: reminders?.length ?? 0 })}
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
									{/* kánon pořadí polí (= AddTaskModal): Termín → Priorita → Přiřazení */}
									<div className="flex flex-wrap items-center" style={{ gap: 8 }}>
										{(
											[
												["due_date", t("detail.due")],
												["deadline", t("detail.deadline")],
											] as const
										).map(([col, label]) => (
											<label key={col} className="flex items-center" style={{ gap: 6 }}>
												<span className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
													{label}
												</span>
												<input
													type="date"
													value={task[col] ? (task[col] ?? "").slice(0, 10) : ""}
													onChange={(e) => {
														// S4 (R4) — přímá změna termínu u opakovaného úkolu by posunula
														// kotvu CELÉ řady bez dotazu tento/další/celá řada; blokujeme
														// stejně jako quick-shift (deadline se řady netýká).
														if (col === "due_date" && task.recurrence_rule) {
															showToast(t("bulk.recurringSkipped", { count: 1 }));
															return;
														}
														void patchLog({ [col]: e.target.value || null });
													}}
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
												onClick={() => {
													// S4 (R4) — quick-shift by u opakovaného úkolu tiše
													// posunul kotvu CELÉ řady bez dotazu „tento / tento
													// a další / celá řada"; posun proto neprovádíme.
													if (task.recurrence_rule) {
														showToast(t("bulk.recurringSkipped", { count: 1 }));
														return;
													}
													void patchLog({ due_date: rescheduleDate(key) });
												}}
												className="cursor-pointer whitespace-nowrap rounded-md border border-line bg-card font-mono text-ink-3 hover:border-brass hover:text-brass-text"
												style={{ fontSize: 9.5, padding: "3px 7px" }}
											>
												{label}
											</button>
										))}
										{/* čas + trvání (parita s AddTask — funguje i pro podúkoly) */}
										<label className="flex items-center" style={{ gap: 6 }}>
											<span className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
												{t("detail.time")}
											</span>
											<input
												type="time"
											value={
												task.start_date && task.start_timezone
													? (wallTimeFromInstant(
															task.start_date,
															task.start_timezone,
														)?.slice(0, 5) ?? "")
													: task.start_date?.slice(11, 16) ?? ""
											}
										onChange={(e) => {
											const zone = task.start_timezone ?? session?.user?.timezone ?? deviceTimeZone();
											const base =
												task.due_date?.slice(0, 10) ??
												dateInTimeZone(zone);
											const start = e.target.value
												? zonedDateTimeToIso(base, `${e.target.value}:00`, zone)
												: null;
											if (e.target.value && !start) {
												showToast(t("addmodal.invalidLocalTime"));
												return;
											}
											void patchLog({
												start_date: start,
												start_timezone: start ? zone : null,
														// čas bez termínu → nastavit i termín (jinak by blok neměl den)
														...(e.target.value && !task.due_date ? { due_date: base } : {}),
													});
												}}
												className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-ink-2 text-xs outline-none focus:border-brass"
											/>
										</label>
										<label className="flex items-center" style={{ gap: 6 }}>
											<span className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
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
											<span className="font-body text-ink-3" style={{ fontSize: 11 }}>
												{t("addmodal.min")}
											</span>
										</label>
									</div>
									<div className="flex items-center" style={{ gap: 8, marginTop: 9 }}>
										<span className="w-14 shrink-0 font-body text-ink-3" style={{ fontSize: 11.5 }}>
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
													background: task.priority === p ? "var(--w-brass-soft)" : "transparent",
													color: task.priority === p ? "var(--w-brass-text)" : "var(--w-ink-2)",
												}}
											>
												P{p}
											</button>
										))}
									</div>
									<div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 9 }}>
										<button
											type="button"
											onClick={() => void setUserColor(null)}
											aria-label={t("detail.clearColor")}
											className="grid place-items-center border border-line bg-card"
											style={{ width: 20, height: 20, borderRadius: 6 }}
										>
											<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
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

						{/* PŘIŘAZENÍ (R2) — jen přiřazení + „+ Přiřadit" popover (ř. 1050–1059) */}
						<SectionLabel>{t("detail.assignment")}</SectionLabel>
						{/* popisek režimu NAD seznamem (prototyp ř. 1040 assignAll / ř. 1051 assignAny) */}
						{asg.length > 0 && mode !== "single" && (
							<div className="font-body text-ink-3" style={{ fontSize: 12, marginBottom: 8 }}>
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
										<span style={{ fontSize: 13, color: "var(--w-ink)" }}>{m?.name ?? "—"}</span>
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
												<span className="flex-1" style={{ fontSize: 13, color: "var(--w-ink)" }}>
													{m.name}
												</span>
												{assigned && (
													<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
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
														background: mode === m2 ? "var(--w-brass-soft)" : "transparent",
														color: mode === m2 ? "var(--w-brass-text)" : "var(--w-ink-2)",
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

						<Suspense
							fallback={
								<div
									aria-busy="true"
									className="mt-4 min-h-11 rounded-lg border border-line border-dashed bg-panel-2 px-3 py-3 font-display font-semibold text-ink-3"
									style={{ fontSize: 11 }}
								>
									{t("detail.acceptanceTitle")}…
								</div>
							}
						>
							<TaskAcceptanceSection
								taskId={realId}
								required={
									task.kind === "task" &&
									Boolean(project?.urgent_acceptance_enabled) &&
									(task.priority ?? 4) <= (project?.urgent_acceptance_priority === 2 ? 2 : 1)
								}
								creatorId={task.created_by ?? null}
								assignees={asg.flatMap((assignment) => {
									if (!assignment.user_id) return [];
									return [
										{
											userId: assignment.user_id,
											name: memberOf(assignment.user_id)?.name ?? "—",
										},
									];
								})}
								currentUserId={session?.user?.id ?? null}
								taskCompleted={Boolean(task.completed_at)}
							/>
						</Suspense>

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
										ref={focusOnMount}
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

						{/* PROČ TEĎ — vlastní kontext + výhradně vysvětlitelné systémové signály. */}
						<SectionLabel>{t("detail.whyNow")}</SectionLabel>
						<div
							className="border border-line bg-panel-2"
							style={{ borderRadius: 11, padding: "12px 13px" }}
						>
							{whyNowOpen ? (
								<div>
									<label
										htmlFor={`why-now-${realId}`}
										className="mb-1 block font-display font-semibold text-ink-2"
										style={{ fontSize: 12 }}
									>
										{t("detail.whyNowOwnReason")}
									</label>
									<textarea
										id={`why-now-${realId}`}
										ref={focusOnMount}
										value={whyNow}
										onChange={(event) => setWhyNow(event.target.value)}
										maxLength={WHY_NOW_MAX_LENGTH}
										rows={3}
										placeholder={t("detail.whyNowPlaceholder")}
										className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-ink text-sm outline-none focus:border-brass"
									/>
									<div
										className="mt-2 flex flex-wrap items-center justify-between"
										style={{ gap: 8 }}
									>
										<span className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
											{whyNow.length}/{WHY_NOW_MAX_LENGTH}
										</span>
										<div className="flex items-center" style={{ gap: 7 }}>
											<button
												type="button"
												onClick={() => {
													setWhyNow(task.why_now ?? "");
													setWhyNowOpen(false);
												}}
												className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-2 hover:bg-panel"
												style={{ fontSize: 12 }}
											>
												{t("common.cancel")}
											</button>
											<button
												type="button"
												onClick={() => {
													const normalized = whyNow.trim();
													setWhyNow(normalized);
													setWhyNowOpen(false);
													void patchLog({ why_now: normalized || null });
												}}
												className="min-h-11 rounded-lg bg-brass px-3 font-display font-bold text-white hover:brightness-105"
												style={{ fontSize: 12 }}
											>
												{t("common.save")}
											</button>
										</div>
									</div>
								</div>
							) : (
								<div className="flex items-start justify-between" style={{ gap: 12 }}>
									<p className="font-body text-ink-2" style={{ fontSize: 13, lineHeight: 1.5 }}>
										{task.why_now || t("detail.whyNowEmpty")}
									</p>
									<button
										type="button"
										onClick={() => setWhyNowOpen(true)}
										className="min-h-11 shrink-0 rounded-lg border border-line bg-card px-3 font-display font-semibold text-ink-2 hover:border-brass hover:text-brass-text"
										style={{ fontSize: 11.5 }}
									>
										{task.why_now ? t("common.edit") : t("detail.whyNowAdd")}
									</button>
								</div>
							)}
							{relevanceSignals.length > 0 && (
								<div className="mt-3 border-line border-t pt-3">
									<p className="mb-2 font-body text-ink-3" style={{ fontSize: 11.5 }}>
										{t("detail.whyNowSystemSignals")}
									</p>
									<div className="flex flex-wrap" style={{ gap: 6 }}>
										{relevanceSignals.map((signal) => (
											<span
												key={signal}
												className="rounded-full border border-line bg-card font-display font-semibold text-ink-2"
												style={{ fontSize: 10.5, padding: "4px 8px" }}
											>
												{t(WHY_NOW_SIGNAL_KEY[signal])}
											</span>
										))}
									</div>
								</div>
							)}
						</div>

						{/* PODÚKOLY — reálné úkoly vrstvené na sebe (rozhodnutí 2026-07-02): plnohodnotný
              řádek s prioritním okrajem, počty vlastních podúkolů a klikem do vlastního detailu. */}
						<SectionLabel>
							{t("detail.subtasks")}
							{subtaskProgress.total > 0 && ` · ${subtaskProgress.done}/${subtaskProgress.total}`}
						</SectionLabel>
						{subtaskProgress.total > 0 && (
							<div className="mb-2 rounded-lg bg-panel-2 p-3">
								<div className="mb-2 flex items-center justify-between" style={{ gap: 8 }}>
									<span className="font-body text-ink-2" style={{ fontSize: 12 }}>
										{t("detail.subtaskProgress")}
									</span>
									<strong className="font-mono text-ink" style={{ fontSize: 12 }}>
										{subtaskProgress.percent}%
									</strong>
								</div>
								<div
									role="progressbar"
									aria-label={t("detail.subtaskProgress")}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={subtaskProgress.percent}
									className="h-2 overflow-hidden rounded-full bg-card"
								>
									<div
										className="h-full rounded-full bg-brass transition-[width] duration-200"
										style={{ width: `${subtaskProgress.percent}%` }}
									/>
								</div>
								{subtaskProgress.isComplete && !done && (
									<p className="mt-2 font-body text-ink-3" style={{ fontSize: 11.5 }}>
										{t("detail.subtasksCompleteParentOpen")}
									</p>
								)}
							</div>
						)}
						<ul>
							{(subs ?? []).map((s) => {
								const sd = Boolean(s.completed_at);
								const sMeta = metaOf(s);
								const sDue = rowDue(s, t);
								return (
									<li
										key={s.id}
										className="flex items-center border-line border-b hover:bg-panel-2"
										style={{
											gap: 10,
											padding: "8px 4px 8px 9px",
											borderRadius: "0 6px 6px 0",
											boxShadow: sd ? undefined : `inset 3px 0 0 var(--w-p${s.priority ?? 4})`,
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
										<button
											type="button"
											onClick={() => open(s.id)}
											className="flex min-w-0 flex-1 items-center text-left"
											style={{ gap: 10 }}
										>
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
											<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11 }}>
												⚏ {sMeta.checklist.done}/{sMeta.checklist.total}
											</span>
										)}
										{sDue && (
											<span
												className="shrink-0 font-mono"
												style={{
													fontSize: 11.5,
													color: sDue.overdue ? "var(--w-overdue)" : "var(--w-ink-3)",
												}}
											>
												{sDue.label}
											</span>
										)}
										<span className="shrink-0 text-ink-3" style={{ fontSize: 12 }}>
											›
										</span>
										</button>
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
									className="min-h-11 min-w-0 flex-1 rounded-lg border border-line border-dashed bg-transparent px-3 py-2 text-sm outline-none focus:border-brass"
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
									className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-ink-3 hover:border-brass hover:text-brass-text"
								>
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
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

						<SectionLabel>
							{t("detail.dependencies")}
							{unresolvedDependencyCount > 0 && ` · ${unresolvedDependencyCount}`}
						</SectionLabel>
						{unresolvedDependencyCount > 0 && (
							<div
								className="mb-2 rounded-lg border border-overdue bg-overdue-soft px-3 py-2 text-overdue"
								role="status"
							>
								<strong className="font-display" style={{ fontSize: 12.5 }}>
									{t("detail.blockedByCount", { count: unresolvedDependencyCount })}
								</strong>
								<p className="mt-1 font-body" style={{ fontSize: 11.5 }}>
									{t("detail.blockedCompletionHint")}
								</p>
							</div>
						)}
						{(incomingDependencies ?? []).length > 0 && (
							<div className="mb-2">
								<p className="mb-1 font-display font-semibold text-ink-3" style={{ fontSize: 11.5 }}>
									{t("detail.blockedBy")}
								</p>
								{(incomingDependencies ?? []).map((dependency) => (
									<div
										key={dependency.id}
										className="flex min-h-11 items-center rounded-lg hover:bg-panel-2"
										style={{ gap: 6 }}
									>
										<span aria-hidden>{dependency.completed_at ? "✓" : "⛔"}</span>
										<button
											type="button"
											onClick={() => open(dependency.task_id)}
											className={`min-h-11 min-w-0 flex-1 truncate text-left font-display font-semibold ${dependency.completed_at ? "text-ink-3 line-through" : "text-ink"}`}
											style={{ fontSize: 12.5 }}
										>
											{dependency.name}
										</button>
										<button
											type="button"
											onClick={() => void removeDependency(dependency.id)}
											aria-label={t("detail.dependencyRemove")}
											className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-card hover:text-overdue"
										>
											✕
										</button>
									</div>
								))}
							</div>
						)}
						{(outgoingDependencies ?? []).length > 0 && (
							<div className="mb-2 rounded-lg bg-panel-2 px-3 py-2">
								<p className="mb-1 font-display font-semibold text-ink-3" style={{ fontSize: 11.5 }}>
									{t("detail.blocks")}
								</p>
								{(outgoingDependencies ?? []).map((dependency) => (
									<div key={dependency.id} className="flex min-h-11 items-center" style={{ gap: 4 }}>
										<button
											type="button"
											onClick={() => open(dependency.task_id)}
											className="min-h-11 min-w-0 flex-1 truncate text-left font-display font-semibold text-ink-2 hover:text-brass-text"
											style={{ fontSize: 12.5 }}
										>
											→ {dependency.name}
										</button>
										<button
											type="button"
											onClick={() => void removeDependency(dependency.id)}
											aria-label={t("detail.dependencyRemove")}
											className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-card hover:text-overdue"
										>
											✕
										</button>
									</div>
								))}
							</div>
						)}
						<div className="flex items-center" style={{ gap: 8 }}>
							<select
								value={selectedBlockerId}
								onChange={(event) => setSelectedBlockerId(event.target.value)}
								aria-label={t("detail.dependencySelect")}
								className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 font-body text-ink outline-none focus:border-brass"
								style={{ fontSize: 12.5 }}
							>
								<option value="">{t("detail.dependencySelect")}</option>
								{availableDependencyCandidates.map((candidate) => (
									<option key={candidate.id} value={candidate.id}>
										{candidate.completed_at ? `✓ ${candidate.name}` : candidate.name}
									</option>
								))}
							</select>
							<button
								type="button"
								disabled={!selectedBlockerId || dependencyBusy}
								onClick={() => void addDependency()}
								className="min-h-11 shrink-0 rounded-lg border border-brass bg-brass-soft px-3 font-display font-semibold text-brass-text disabled:cursor-not-allowed disabled:opacity-50"
								style={{ fontSize: 12 }}
							>
								{dependencyBusy ? t("detail.dependencyAdding") : t("detail.dependencyAdd")}
							</button>
						</div>

						{/* PŘIPOMÍNKY — relativní (před termínem) / absolutní; doručení Web Push. */}
						<SectionLabel>
							{t("detail.remindersCount", { count: reminders?.length ?? 0 })}
						</SectionLabel>
						<div style={{ marginBottom: 4 }}>
							{orderedReminders.map((r) => {
								const dateLabel = reminderDateLabel(r);
								return (
									<div
									key={r.id}
									className="flex items-center justify-between"
									style={{ minHeight: 44, padding: "4px 0", fontSize: 12.5, gap: 8 }}
								>
									<div className="flex min-w-0 items-center" style={{ gap: 8 }}>
										<span aria-hidden>🔔</span>
										<span className="min-w-0" style={{ color: "var(--w-ink-2)" }}>
											<span className="block font-display font-semibold">
												{r.type === "relative" && r.offset_min != null
													? relativeLabel(r.offset_min)
													: t("detail.remCustom")}
											</span>
											{dateLabel && (
												<span className="block text-ink-3" style={{ fontSize: 11.5 }}>
													{dateLabel}
												</span>
											)}
										</span>
									</div>
									<button
										type="button"
										onClick={() => void removeReminder(r.id)}
										aria-label={t("detail.remRemove")}
										className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-panel-2 hover:text-overdue"
										style={{ fontSize: 13 }}
									>
										✕
									</button>
									</div>
								);
							})}
							<p className="text-ink-3" style={{ fontSize: 11.5, margin: "2px 0 8px" }}>
								{t("detail.remOptionalHint")}
							</p>
							<div
								className="flex flex-wrap items-center"
								style={{
									gap: 6,
									marginTop: (reminders?.length ?? 0) > 0 ? 6 : 2,
								}}
							>
								{[0, 10, 30, 60, 1440].map((min) => {
									const noBase = !relativeBase;
									const candidate = { type: "relative", offsetMin: min } as const;
									const duplicate = hasEquivalentReminder(reminders ?? [], candidate);
									const candidateTime = reminderCandidateFireAt(candidate, reminderTiming);
									const past = candidateTime != null && candidateTime <= Date.now();
									const busy = reminderBusyKey === reminderCandidateKey(candidate);
									return (
										<button
											key={min}
											type="button"
											disabled={noBase || duplicate || past || busy}
											onClick={() => void addReminder(candidate)}
											title={
												noBase
													? t("detail.remNoDue")
													: duplicate
														? t("detail.remDuplicate")
														: past
															? t("detail.remPast")
															: undefined
											}
											className="font-display font-semibold text-ink-2 hover:border-brass hover:text-brass-text"
											style={{
												fontSize: 11.5,
												minHeight: 44,
												padding: "7px 10px",
												borderRadius: 8,
												border: "1px solid var(--w-line)",
												opacity: noBase || duplicate || past ? 0.45 : 1,
												cursor: noBase || duplicate || past ? "not-allowed" : "pointer",
											}}
										>
											{relativeLabel(min)}
										</button>
									);
								})}
								<input
									type="datetime-local"
									min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
										.toISOString()
										.slice(0, 16)}
									onChange={(e) => {
										if (e.target.value)
											void addReminder({
												type: "time",
												remindAt: new Date(e.target.value).toISOString(),
											});
										e.target.value = "";
									}}
									aria-label={t("detail.remAt")}
									className="min-h-11 rounded-[7px] border border-line bg-panel-2 font-mono text-ink outline-none focus:border-brass"
									style={{ fontSize: 12, padding: "7px 9px" }}
								/>
							</div>
						{notificationPermission() === "denied" && (
								<div className="font-body text-overdue" style={{ fontSize: 11, marginTop: 6 }}>
									{t("detail.remPushDenied")}
								</div>
							)}
						</div>

						<Suspense
							fallback={
								<div
									aria-busy="true"
									className="mt-4 min-h-11 rounded-lg border border-line border-dashed bg-panel-2 px-3 py-3 font-display font-semibold text-ink-3"
									style={{ fontSize: 11 }}
								>
									{t("detail.customFields")}…
								</div>
							}
						>
							<CustomFieldsSection
								taskId={realId}
								projectId={task.project_id ?? ""}
								members={members}
								canEdit={canEditCustomFields}
							/>
						</Suspense>

						<Suspense
							fallback={
								<div
									aria-busy="true"
									className="mt-4 min-h-11 rounded-lg border border-line border-dashed bg-panel-2 px-3 py-3 font-display font-semibold text-ink-3"
									style={{ fontSize: 11 }}
								>
									{t("detail.polls")}…
								</div>
							}
						>
							<PollsSection
								taskId={realId}
								members={members}
								currentUserId={session?.user?.id ?? null}
								canManage={canManagePolls}
								isManager={myProjectRole === "manager"}
							/>
						</Suspense>

						{/* PŘÍLOHY — metadata offline, obsah přes autorizovanou serverovou route. */}
						<SectionLabel>
							{t("detail.attachments")} · {attachments?.length ?? 0}
						</SectionLabel>
						<div className="space-y-2">
							{(attachments ?? []).map((attachment) => {
								const mime = attachment.mime ?? "application/octet-stream";
								const previewable = isAttachmentPreviewable(mime);
								const image = mime.startsWith("image/") && previewable;
								const mayDelete =
									canDeleteAnyAttachment || attachment.uploaded_by === session?.user?.id;
								return (
									<div
										key={attachment.id}
										className="flex min-h-14 items-center rounded-xl border border-line bg-panel-2 p-2"
										style={{ gap: 10 }}
									>
										{image ? (
											<AttachmentImagePreview path={attachment.url ?? ""} />
										) : (
											<span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-card font-display font-bold text-ink-3 text-xs">
												{mime === "application/pdf" ? "PDF" : mime.startsWith("text/") ? "TXT" : "FILE"}
											</span>
										)}
										<div className="min-w-0 flex-1">
											<p className="truncate font-display font-semibold text-ink" style={{ fontSize: 12.5 }}>
												{attachment.file_name}
											</p>
											<p className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
												{attachmentSizeLabel(Number(attachment.size_bytes ?? 0))}
											</p>
										</div>
										<a
											href={attachmentContentUrl(attachment.url ?? "", !previewable)}
											target={previewable ? "_blank" : undefined}
											rel={previewable ? "noopener noreferrer" : undefined}
											className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-display font-semibold text-brass-text hover:bg-card"
											style={{ fontSize: 11.5 }}
										>
											{t(previewable ? "detail.attachmentPreview" : "detail.attachmentDownload")}
										</a>
										{mayDelete && (
											<button
												type="button"
												disabled={attachmentBusy}
												onClick={() => void removeAttachment(attachment.id)}
												aria-label={t("detail.attachmentDelete")}
												className={`grid h-11 shrink-0 place-items-center rounded-lg px-2 ${attachmentDeleteConfirm === attachment.id ? "bg-overdue-soft text-overdue" : "text-ink-3 hover:bg-card hover:text-overdue"}`}
											>
												{attachmentDeleteConfirm === attachment.id ? t("detail.attachmentDelete") : "✕"}
											</button>
										)}
									</div>
								);
							})}
							<label
								className={`flex min-h-11 w-full items-center justify-center rounded-xl border border-line border-dashed px-3 font-display font-semibold ${attachmentBusy ? "cursor-wait opacity-60" : "cursor-pointer text-ink-2 hover:border-brass hover:text-brass-text"}`}
								style={{ fontSize: 12, gap: 7 }}
							>
								<Icon name="priloha" size={16} />
								{attachmentBusy ? t("detail.attachmentUploading") : t("detail.attachmentAdd")}
								<input
									type="file"
									multiple
									disabled={attachmentBusy}
									className="sr-only"
									onChange={(event) => {
										void uploadTaskAttachments(Array.from(event.target.files ?? []));
										event.target.value = "";
									}}
								/>
							</label>
							<p className="font-body text-ink-3" style={{ fontSize: 11 }}>
								{t("detail.attachmentHint")}
							</p>
						</div>

						{/* KOMENTÁŘE · N (ř. 1062–1071) */}
						<SectionLabel>
							{t("detail.comments")} · {cmts.length}
						</SectionLabel>
						{rootComments.map((comment) => renderCommentCard(comment))}
						<CommentComposer
							value={cmtText}
							onChange={setCmtText}
							members={members}
							placeholder={t("detail.addComment")}
							submitLabel={t("detail.commentSend")}
							onSubmit={(body, mentionUserIds) => addCmt(body, null, mentionUserIds)}
						/>
						{/* JEDNOTNÁ ČASOVÁ OSA — serverový audit + rozhodnutí + legacy historie bez duplicit. */}
						<div style={{ marginTop: 22 }}>
							<button
								type="button"
								onClick={() => setHistOpen((open) => !open)}
								aria-expanded={histOpen}
								className="flex min-h-11 w-full items-center font-display font-bold text-ink-3 uppercase hover:text-ink-2"
								style={{ fontSize: 11, letterSpacing: ".06em", gap: 6 }}
							>
								<span
									aria-hidden
									style={{
										display: "inline-block",
										transform: histOpen ? "rotate(90deg)" : "none",
										transition: "transform .15s",
									}}
								>
									›
								</span>
								{t("detail.timeline")} · {timelineEvents.length}
								{timelineQuery.hasNextPage ? "+" : ""}
							</button>
							{histOpen && (
								<div style={{ marginTop: 8 }}>
									<div className="mb-3 flex rounded-lg border border-line bg-panel-2 p-[3px]">
										{(["all", "changes", "decisions"] as const).map((filter) => (
											<button
												key={filter}
												type="button"
												onClick={() => setTimelineFilter(filter)}
												aria-pressed={timelineFilter === filter}
												className="min-h-11 flex-1 rounded-md px-2 font-display font-semibold"
												style={{
													fontSize: 11,
													background: timelineFilter === filter ? "var(--w-card)" : "transparent",
													color: timelineFilter === filter ? "var(--w-ink)" : "var(--w-ink-3)",
												}}
											>
												{t(`detail.timelineFilter${filter[0]?.toUpperCase()}${filter.slice(1)}`)}
											</button>
										))}
									</div>

									{timelineQuery.isLoading && (
										<p className="py-3 text-center font-body text-ink-3 text-xs" role="status">
											{t("detail.timelineLoading")}
										</p>
									)}
									{timelineQuery.isError && (
										<div className="rounded-lg border border-line bg-panel-2 p-3 text-ink-3 text-xs">
											{t("detail.timelineError")}
											<button
												type="button"
												onClick={() => void timelineQuery.refetch()}
												className="ml-2 min-h-11 font-display font-semibold text-brass-text"
											>
												{t("detail.timelineRetry")}
											</button>
										</div>
									)}
									{!timelineQuery.isLoading && !timelineQuery.isError && filteredTimeline.length === 0 && (
										<p className="py-3 text-center font-body text-ink-3 text-xs">
											{t("detail.timelineEmpty")}
										</p>
									)}
									<div className="relative">
										{filteredTimeline.map((event, index) => {
											const actorName =
												event.actorName ??
												memberOf(event.actorUserId)?.name ??
												(event.actorType === "ai"
													? t("detail.timelineAi")
													: event.actorType === "user"
														? t("detail.timelineUnknownUser")
														: t("detail.timelineSystem"));
											const commentText =
												event.excerpt ??
												cmts.find((comment) => comment.id === event.commentId)?.body ??
												null;
											const relatedTaskName = event.relatedTaskId
												? dependencyCandidates?.find((candidate) => candidate.id === event.relatedTaskId)?.name
												: null;
											const relatedUserName = event.relatedUserId
												? memberOf(event.relatedUserId)?.name
												: null;
											const fieldLabels = event.changedFields
												.filter(
													(field) =>
														field !== "completed_at" &&
														!event.changes.some(
															(change) =>
																change.field === field &&
																Boolean(
																	fmtTimelineActVal(change.field, change.oldValue, t) ??
																		fmtTimelineActVal(change.field, change.newValue, t),
																),
														),
												)
												.map((field) => actFieldLabel(field, t));
											return (
												<div key={event.id} className="relative flex pb-4" style={{ gap: 9 }}>
													{index < filteredTimeline.length - 1 && (
														<span
															aria-hidden
															className="absolute bg-line"
															style={{ left: 13, top: 28, bottom: 0, width: 1 }}
														/>
													)}
													<span
														className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display font-semibold"
														style={{
															fontSize: 9,
															color: "#fff",
															background: isDecisionTimelineEvent(event)
																? "var(--w-brass)"
																: "var(--w-avatar)",
														}}
													>
														{event.actorType === "ai" ? "AI" : initials(actorName)}
													</span>
													<div className="min-w-0 flex-1 pt-1" style={{ fontSize: 12 }}>
														<div>
															<span className="font-display font-semibold text-ink">{actorName}</span>{" "}
															<span className="font-body text-ink-2">{t(TIMELINE_KIND_KEY[event.kind])}</span>
															<span className="font-body text-ink-3" style={{ fontSize: 11 }}>
																{" · "}
																{whenLabel(event.createdAt, t)}
															</span>
														</div>
														{fieldLabels.length > 0 && (
															<p className="mt-0.5 truncate font-body text-ink-3" style={{ fontSize: 11 }}>
																{fieldLabels.join(" · ")}
															</p>
														)}
														{event.changes.map((change) => {
															const oldValue = fmtTimelineActVal(change.field, change.oldValue, t);
															const newValue = fmtTimelineActVal(change.field, change.newValue, t);
															if (!oldValue && !newValue) return null;
															return (
																<p key={change.field} className="mt-0.5 truncate font-mono text-ink-3" style={{ fontSize: 11 }}>
																	{actFieldLabel(change.field, t)}: {" "}
																	{oldValue ? `${oldValue} → ` : "→ "}
																	{newValue ?? "—"}
																</p>
															);
														})}
														{commentText && (
															<p className="mt-1 line-clamp-2 rounded-md bg-panel-2 px-2 py-1.5 font-body text-ink-2" style={{ fontSize: 11.5 }}>
																{commentText}
															</p>
														)}
														{relatedTaskName && (
															<p className="mt-0.5 truncate font-body text-ink-3" style={{ fontSize: 11 }}>
																{event.direction === "blocked_by" ? "←" : "→"} {relatedTaskName}
															</p>
														)}
														{relatedUserName && (
															<p className="mt-0.5 font-body text-ink-3" style={{ fontSize: 11 }}>
																{relatedUserName}
															</p>
														)}
													</div>
												</div>
											);
										})}
									</div>
									{timelineQuery.hasNextPage && timelineFilter === "all" && (
										<button
											type="button"
											disabled={timelineQuery.isFetchingNextPage}
											onClick={() => void timelineQuery.fetchNextPage()}
											className="min-h-11 w-full rounded-lg border border-line bg-panel-2 font-display font-semibold text-ink-2 hover:border-brass disabled:opacity-60"
											style={{ fontSize: 11.5 }}
										>
											{timelineQuery.isFetchingNextPage
												? t("detail.timelineLoading")
												: t("detail.timelineOlder")}
										</button>
									)}
								</div>
							)}
						</div>
					</div>

					{/* footer akce (ř. 1073–1077) */}
					<div className="flex border-line border-t" style={{ gap: 9, padding: "13px 18px" }}>
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
	icon: "duplikovat" | "odkaz" | "smazat" | "ukoly";
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
				minHeight: 44,
				padding: "10px",
				fontSize: 13,
				color: danger ? "var(--w-overdue)" : "var(--w-ink)",
			}}
		>
			<Icon name={icon} size={15} />
			{children}
		</button>
	);
}
