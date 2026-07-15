import { useQuery as usePsQuery } from "@powersync/react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type ReactNode, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { initials } from "../lib/format";
import { focusOnMount } from "../lib/focusOnMount";
import type { ChainRow, GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjectsWithState } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { useWorkspaces } from "../lib/workspace";
import { useMail } from "../mail/state";

const INBOX_NAMES = new Set(["Doručené", "Inbox"]);
type Member = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	job: string | null;
};

/** Pluralizace počtu výsledků — i18next count (cs má 3 tvary, en 2). */
function totalLabel(total: number, t: (k: string, o: { count: number }) => string): string {
	return t("search.resultCount", { count: total });
}

/**
 * Globální offline hledání. Prohledává výhradně řádky, které PowerSync uživateli
 * autorizovaně synchronizoval; tím nepřidává druhou, hůře auditovatelnou ACL cestu.
 * Přepis meetingu se záměrně neprohledává: není plošně synchronizovaný a jeho
 * participant ACL se vyhodnocuje on-demand na API.
 */
export function Hledat() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { projects, isLoading: projectsLoading } = useProjectsWithState();
	const taskDetail = useTaskDetail();
	const projectDetail = useProjectDetail();
	const { data: workspaces, isPending: workspacesLoading } = useWorkspaces();
	const { threads, openThread } = useMail();
	const [q, setQ] = useState("");

	const { data: tasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		"SELECT id, name, description, project_id, due_date, parent_id, completed_at FROM tasks",
	);
	const { data: comments, isLoading: commentsLoading } = usePsQuery<{
		task_id: string;
		body: string | null;
	}>("SELECT task_id, body FROM comments");
	const { data: chains, isLoading: chainsLoading } = usePsQuery<ChainRow>(
		"SELECT id, name, description FROM chains",
	);
	const { data: steps, isLoading: stepsLoading } = usePsQuery<{
		chain_id: string | null;
		step_state: string | null;
	}>("SELECT chain_id, step_state FROM chain_steps");
	const { data: goals, isLoading: goalsLoading } = usePsQuery<GoalRow>(
		"SELECT id, name, scope, metric, period FROM goals",
	);
	const { data: lists, isLoading: listsLoading } = usePsQuery<{
		id: string;
		name: string | null;
		event: string | null;
	}>("SELECT id, name, event FROM lists WHERE archived = 0 OR archived IS NULL");
	const { data: listItems, isLoading: listItemsLoading } = usePsQuery<{
		list_id: string;
		text: string | null;
		qty: string | null;
	}>("SELECT list_id, text, qty FROM list_items");
	const { data: contacts, isLoading: contactsLoading } = usePsQuery<{
		id: string;
		name: string | null;
		email: string | null;
		org: string | null;
		role: string | null;
		areas: string | null;
		note: string | null;
	}>("SELECT id, name, email, org, role, areas, note FROM contacts");
	const { data: meetings, isLoading: meetingsLoading } = usePsQuery<{
		id: string;
		title: string | null;
		status: string | null;
	}>("SELECT id, title, status FROM meetings");

	// Lidé napříč všemi prostory (dedup podle id).
	const memberQueries = useQueries({
		queries: (workspaces ?? []).map((w) => ({
			queryKey: ["wsMembersFull", w.id],
			queryFn: async () => {
				const r = await fetch(`${API_URL}/api/workspaces/${w.id}/members`, {
					credentials: "include",
				});
				if (!r.ok) throw new Error("members");
				return (await r.json()).members as Member[];
			},
		})),
	});
	const people = useMemo(() => {
		const map = new Map<string, Member>();
		for (const mq of memberQueries) for (const m of mq.data ?? []) map.set(m.id, m);
		return [...map.values()];
	}, [memberQueries]);
	const commentsByTask = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const row of comments ?? []) {
			if (!row.task_id || !row.body) continue;
			map.set(row.task_id, [...(map.get(row.task_id) ?? []), row.body]);
		}
		return map;
	}, [comments]);
	const itemsByList = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const row of listItems ?? []) {
			const value = [row.text, row.qty].filter(Boolean).join(" ");
			if (row.list_id && value) map.set(row.list_id, [...(map.get(row.list_id) ?? []), value]);
		}
		return map;
	}, [listItems]);
	const searchLoading =
		projectsLoading ||
		workspacesLoading ||
		tasksLoading ||
		commentsLoading ||
		chainsLoading ||
		stepsLoading ||
		goalsLoading ||
		listsLoading ||
		listItemsLoading ||
		contactsLoading ||
		meetingsLoading ||
		memberQueries.some((query) => query.isPending);
	const searchPartialError = memberQueries.some((query) => query.isError);

	const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
	const inboxIds = useMemo(
		() => new Set(projects.filter((p) => INBOX_NAMES.has(p.name ?? "")).map((p) => p.id)),
		[projects],
	);

	const res = useMemo(() => {
		const ql = q.trim().toLowerCase();
		if (!ql) return null;
		const has = (s: string | null | undefined) => (s ?? "").toLowerCase().includes(ql);

		// Úkoly — bez schránkových položek (nezařazené v inbox projektech patří do Schránky).
		const rTasks = (tasks ?? [])
			.filter(
				(tk) =>
					(has(tk.name) || has(tk.description) || (commentsByTask.get(tk.id) ?? []).some(has)) &&
					!(tk.project_id && inboxIds.has(tk.project_id) && !tk.due_date && !tk.parent_id),
			)
			// Dokončené řadit až za otevřené (a odlišit v renderu), ať nepřebijí aktivní.
			.sort((a, b) => (a.completed_at ? 1 : 0) - (b.completed_at ? 1 : 0))
			.slice(0, 8)
			.map((tk) => ({
				id: tk.id,
				name: tk.name ?? "",
				sub: (tk.project_id && projMap.get(tk.project_id)?.name) || "",
				color: (tk.project_id && projMap.get(tk.project_id)?.color) || null,
				done: !!tk.completed_at,
				run: () => taskDetail.open(tk.id),
			}));

		const KIND: Record<string, string> = {
			flow: t("search.kindFlow"),
			goal: t("search.kindGoal"),
			cycle: t("search.kindCycle"),
		};
		const rProjects = projects
			.filter((p) => has(p.name))
			.slice(0, 6)
			.map((p) => ({
				id: p.id,
				name: p.name ?? "",
				sub: KIND[p.kind ?? "flow"] ?? t("palette.kindProject"),
				color: p.color ?? null,
				run: () => projectDetail.open(p.id),
			}));

		const rPeople = people
			.filter((p) => has(p.name) || has(p.email) || has(p.job ?? ""))
			.slice(0, 6)
			.map((p) => ({
				id: p.id,
				name: p.name,
				sub: p.job || t("search.member"),
				run: () =>
					void navigate({
						to: "/reporty",
						search: { tab: "lide", clen: p.id },
					}),
			}));

		const doneBy = new Map<string, { done: number; total: number }>();
		for (const st of steps ?? []) {
			if (!st.chain_id) continue;
			const c = doneBy.get(st.chain_id) ?? { done: 0, total: 0 };
			c.total++;
			if (st.step_state === "done") c.done++;
			doneBy.set(st.chain_id, c);
		}
		const rFlows = (chains ?? [])
			.filter((ch) => has(ch.name) || has(ch.description))
			.slice(0, 6)
			.map((ch) => {
				const c = doneBy.get(ch.id) ?? { done: 0, total: 0 };
				return {
					id: ch.id,
					name: ch.name ?? "",
					sub: `${c.done}/${c.total} ${t("search.steps")}`,
					run: () => void navigate({ to: "/postupy", search: { postup: ch.id } }),
				};
			});

		const GSCOPE: Record<string, string> = {
			team: t("search.goalTeam"),
			project: t("search.goalProject"),
			personal: t("search.goalPerson"),
			person: t("search.goalPerson"),
		};
		const rGoals = (goals ?? [])
			.filter((g) => has(g.name) || has(g.metric) || has(g.period))
			.slice(0, 6)
			.map((g) => ({
				id: g.id,
				name: g.name ?? "",
				sub: GSCOPE[g.scope ?? ""] ?? t("search.goalGeneric"),
				run: () => void navigate({ to: "/cile" }),
			}));

		const rLists = (lists ?? [])
			.filter((list) => has(list.name) || has(list.event) || (itemsByList.get(list.id) ?? []).some(has))
			.slice(0, 6)
			.map((list) => ({
				id: list.id,
				name: list.name ?? t("search.unnamedList"),
				sub: list.event ?? t("search.checklist"),
				run: () => void navigate({ to: "/seznamy", search: { seznam: list.id } }),
			}));

		const rMeetings = (meetings ?? [])
			.filter((meeting) => has(meeting.title))
			.slice(0, 6)
			.map((meeting) => ({
				id: meeting.id,
				name: meeting.title ?? t("search.unnamedMeeting"),
				sub: meeting.status ?? t("search.meeting"),
				run: () => void navigate({ to: "/meets", search: { meet: meeting.id } }),
			}));

		const rMail = threads
			.filter(
				(thread) =>
					has(thread.subj) ||
					has(thread.snip) ||
					has(thread.from.n) ||
					has(thread.from.addr) ||
					thread.msgs.some((msg) => msg.body.some(has) || (msg.quote ?? []).some(has)) ||
					thread.chat.some((msg) => has(msg.m) || has(msg.pre) || has(msg.post)),
			)
			.slice(0, 6)
			.map((thread) => ({
				id: thread.id,
				name: thread.subj,
				sub: thread.from.n,
				run: () => {
					openThread(thread.id);
					void navigate({ to: "/mail" });
				},
			}));

		const rContacts = (contacts ?? [])
			.filter(
				(contact) =>
					has(contact.name) ||
					has(contact.email) ||
					has(contact.org) ||
					has(contact.role) ||
					has(contact.areas) ||
					has(contact.note),
			)
			.slice(0, 6)
			.map((contact) => ({
				id: contact.id,
				name: contact.name || contact.email || t("search.unnamedContact"),
				sub: [contact.org, contact.email].filter(Boolean).join(" · "),
				// Adresář zatím nemá vlastní detail; Mail je jeho jediný produkční konzument.
				run: () => void navigate({ to: "/mail" }),
			}));

		const total =
			rTasks.length +
			rProjects.length +
			rPeople.length +
			rFlows.length +
			rGoals.length +
			rLists.length +
			rMeetings.length +
			rMail.length +
			rContacts.length;
		return {
			tasks: rTasks,
			projects: rProjects,
			people: rPeople,
			flows: rFlows,
			goals: rGoals,
			lists: rLists,
			meetings: rMeetings,
			mail: rMail,
			contacts: rContacts,
			total,
		};
	}, [
		q,
		tasks,
		projects,
		people,
		chains,
		steps,
		goals,
		lists,
		meetings,
		threads,
		contacts,
		commentsByTask,
		itemsByList,
		projMap,
		inboxIds,
		t,
		navigate,
		taskDetail,
		projectDetail,
		openThread,
	]);

	return (
		<div className="mx-auto max-w-[760px]" style={{ padding: "20px 22px 90px" }}>
			{/* search box */}
			<div
				className="mb-[18px] flex items-center gap-2.5 rounded-[13px] border border-line bg-card"
				style={{ padding: "13px 16px", boxShadow: "var(--w-shadow-sm)" }}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 15 15"
					fill="none"
					className="shrink-0 text-ink-3"
					aria-hidden
				>
					<circle cx="6.4" cy="6.4" r="4.4" stroke="currentColor" strokeWidth="1.4" />
					<line
						x1="9.6"
						y1="9.6"
						x2="13"
						y2="13"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
				<input
					ref={focusOnMount}
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder={t("search.placeholder")}
					className="flex-1 border-none bg-transparent font-body text-ink outline-none"
					style={{ fontSize: 15 }}
					data-search-screen
				/>
				{res && (
					<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 11.5 }}>
						{totalLabel(res.total, t)}
					</span>
				)}
			</div>

			{!res && (
				<div className="text-center" style={{ padding: "54px 20px" }}>
					<div className="mx-auto max-w-[42ch] font-body text-ink-3" style={{ fontSize: 14 }}>
						{t("search.prompt")}
					</div>
				</div>
			)}

			{q.trim() && searchLoading && (
				<div role="status" className="text-center font-body text-ink-3" style={{ padding: "32px 20px", fontSize: 13 }}>
					{t("search.loading")}
				</div>
			)}

			{q.trim() && !searchLoading && searchPartialError && (
				<div role="alert" className="mb-3 rounded-lg border border-line bg-panel-2 px-3 py-2 font-body text-ink-2" style={{ fontSize: 12 }}>
					{t("search.partialError")}
				</div>
			)}

			{res && !searchLoading && res.total === 0 && (
				<div className="text-center" style={{ padding: "54px 20px" }}>
					<div className="mb-1 font-display font-bold text-ink" style={{ fontSize: 15 }}>
						{t("search.empty")}
					</div>
					<div className="font-body text-ink-3" style={{ fontSize: 13 }}>
						{t("search.emptyHint")}
					</div>
				</div>
			)}

			{res && res.tasks.length > 0 && (
				<Section label={t("search.tasks")}>
					{res.tasks.map((r) => (
						<Row key={r.id} onClick={r.run} sub={r.sub}>
							<span
								className="shrink-0 rounded-full"
								style={{
									width: 8,
									height: 8,
									background: r.color ?? "var(--w-line)",
								}}
							/>
							<span
								className="min-w-0 flex-1 truncate font-body"
								style={{
									fontSize: 13.5,
									color: r.done ? "var(--w-ink-3)" : "var(--w-ink)",
									textDecoration: r.done ? "line-through" : "none",
								}}
							>
								{r.name}
							</span>
						</Row>
					))}
				</Section>
			)}

			{res && res.projects.length > 0 && (
				<Section label={t("search.projects")}>
					{res.projects.map((r) => (
						<Row key={r.id} onClick={r.run} sub={r.sub}>
							<span
								className="shrink-0"
								style={{
									width: 10,
									height: 10,
									borderRadius: 3,
									background: r.color ?? "var(--w-line)",
								}}
							/>
							<span
								className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
								style={{ fontSize: 13.5 }}
							>
								{r.name}
							</span>
						</Row>
					))}
				</Section>
			)}

			{res && res.people.length > 0 && (
				<Section label={t("search.people")}>
					{res.people.map((r) => (
						<Row key={r.id} onClick={r.run} sub={r.sub}>
							<span
								className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white"
								style={{
									width: 32,
									height: 32,
									background: "var(--w-avatar)",
									fontSize: 12,
								}}
							>
								{initials(r.name)}
							</span>
							<span
								className="min-w-0 flex-1 font-display font-semibold text-ink"
								style={{ fontSize: 13.5 }}
							>
								{r.name}
							</span>
						</Row>
					))}
				</Section>
			)}

			{res && res.flows.length > 0 && (
				<Section label={t("search.flows")}>
					{res.flows.map((r) => (
						<Row key={r.id} onClick={r.run} sub={r.sub} subMono>
							<svg
								width="15"
								height="15"
								viewBox="0 0 16 16"
								fill="none"
								className="shrink-0 text-brass-text"
								aria-hidden
							>
								<circle cx="3.5" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
								<circle cx="12.5" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
								<path
									d="M5.3 8 H10.7 M9 6.3 L10.9 8 L9 9.7"
									stroke="currentColor"
									strokeWidth="1.3"
									fill="none"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<span
								className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
								style={{ fontSize: 13.5 }}
							>
								{r.name}
							</span>
						</Row>
					))}
				</Section>
			)}

			{res && res.goals.length > 0 && (
				<Section label={t("search.goals")}>
					{res.goals.map((r) => (
						<Row key={r.id} onClick={r.run} sub={r.sub}>
							<svg
								width="15"
								height="15"
								viewBox="0 0 16 16"
								fill="none"
								className="shrink-0 text-brass-text"
								aria-hidden
							>
								<circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
								<circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
							</svg>
							<span
								className="min-w-0 flex-1 truncate font-display font-semibold text-ink"
								style={{ fontSize: 13.5 }}
							>
								{r.name}
							</span>
						</Row>
					))}
				</Section>
			)}

			{res && res.lists.length > 0 && <SimpleSection label={t("search.lists")} rows={res.lists} mark="☷" />}
			{res && res.meetings.length > 0 && <SimpleSection label={t("search.meetings")} rows={res.meetings} mark="⌁" />}
			{res && res.mail.length > 0 && <SimpleSection label={t("search.mail")} rows={res.mail} mark="@" />}
			{res && res.contacts.length > 0 && <SimpleSection label={t("search.contacts")} rows={res.contacts} mark="•" />}
		</div>
	);
}

function SimpleSection({
	label,
	rows,
	mark,
}: {
	label: string;
	rows: Array<{ id: string; name: string; sub: string; run: () => void }>;
	mark: string;
}) {
	return (
		<Section label={label}>
			{rows.map((row) => (
				<Row key={row.id} onClick={row.run} sub={row.sub}>
					<span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-panel-2 font-mono text-brass-text" aria-hidden>
						{mark}
					</span>
					<span className="min-w-0 flex-1 truncate font-display font-semibold text-ink" style={{ fontSize: 13.5 }}>
						{row.name}
					</span>
				</Row>
			))}
		</Section>
	);
}

function Section({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<div
				className="mb-2 font-display font-bold text-ink-3 uppercase"
				style={{ fontSize: 10.5, letterSpacing: ".06em" }}
			>
				{label}
			</div>
			<div className="mb-[18px] overflow-hidden rounded-[13px] border border-line bg-card">
				{children}
			</div>
		</>
	);
}

function Row({
	children,
	sub,
	subMono,
	onClick,
}: {
	children: ReactNode;
	sub: string;
	subMono?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center gap-[11px] border-line border-b text-left last:border-b-0 hover:bg-panel-2"
			style={{ padding: "11px 15px" }}
		>
			{children}
			<span
				className={`shrink-0 ${subMono ? "font-mono" : "font-body"} text-ink-3`}
				style={{ fontSize: subMono ? 11.5 : 12 }}
			>
				{sub}
			</span>
		</button>
	);
}
