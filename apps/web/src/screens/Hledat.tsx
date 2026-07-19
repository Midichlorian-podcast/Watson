import { useQuery as usePsQuery } from "@powersync/react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { focusOnMount } from "../lib/focusOnMount";
import { initials } from "../lib/format";
import type { ChainRow, GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { useProjectsWithState } from "../lib/projects";
import {
	parseSearchQuery,
	rankSearchCandidates,
	type SearchCandidate,
	type SearchScope,
} from "../lib/universalSearch";
import { useWorkspace, useWorkspaces } from "../lib/workspace";
import { useMail } from "../mail/state";

const INBOX_NAMES = new Set(["Doručené", "Inbox"]);
type Member = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	job: string | null;
	workspaceIds?: string[];
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
	const { data: workspaces, isPending: workspacesLoading } = useWorkspaces();
	const { activeWs } = useWorkspace();
	const { threads } = useMail();
	const [q, setQ] = useState("");
	const [scope, setScope] = useState<SearchScope>("all");
	const [activeResult, setActiveResult] = useState<string | null>(null);

	const { data: tasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		"SELECT id, name, description, project_id, due_date, parent_id, completed_at FROM tasks",
	);
	const { data: comments, isLoading: commentsLoading } = usePsQuery<{
		task_id: string;
		body: string | null;
	}>("SELECT task_id, body FROM comments");
	const { data: chains, isLoading: chainsLoading } = usePsQuery<ChainRow>(
		"SELECT id, workspace_id, name, description, state, anchor_date FROM chains",
	);
	const { data: steps, isLoading: stepsLoading } = usePsQuery<{
		chain_id: string | null;
		step_state: string | null;
	}>("SELECT chain_id, step_state FROM chain_steps");
	const { data: goals, isLoading: goalsLoading } = usePsQuery<GoalRow>(
		"SELECT id, workspace_id, name, scope, metric, period, due_date FROM goals",
	);
	const { data: lists, isLoading: listsLoading } = usePsQuery<{
		id: string;
		workspace_id: string | null;
		name: string | null;
		event: string | null;
	}>("SELECT id, workspace_id, name, event FROM lists WHERE archived = 0 OR archived IS NULL");
	const { data: listItems, isLoading: listItemsLoading } = usePsQuery<{
		list_id: string;
		text: string | null;
		qty: string | null;
	}>("SELECT list_id, text, qty FROM list_items");
	const { data: contacts, isLoading: contactsLoading } = usePsQuery<{
		id: string;
		workspace_id: string | null;
		name: string | null;
		email: string | null;
		org: string | null;
		role: string | null;
		areas: string | null;
		note: string | null;
	}>("SELECT id, workspace_id, name, email, org, role, areas, note FROM contacts");
	const { data: meetings, isLoading: meetingsLoading } = usePsQuery<{
		id: string;
		workspace_id: string | null;
		title: string | null;
		status: string | null;
		hub_task_id: string | null;
	}>("SELECT id, workspace_id, title, status, hub_task_id FROM meetings");

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
		for (let index = 0; index < memberQueries.length; index++) {
			const workspaceId = workspaces?.[index]?.id;
			for (const member of memberQueries[index]?.data ?? []) {
				const previous = map.get(member.id);
				const workspaceIds = [
					...(previous?.workspaceIds ?? []),
					...(workspaceId ? [workspaceId] : []),
				];
				map.set(member.id, { ...member, workspaceIds: [...new Set(workspaceIds)] });
			}
		}
		return [...map.values()];
	}, [memberQueries, workspaces]);
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
	const workspaceNames = useMemo(
		() => new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace.name] as const)),
		[workspaces],
	);
	const parsedQuery = useMemo(() => parseSearchQuery(q), [q]);

	const res = useMemo(() => {
		if (!q.trim()) return null;
		const workspaceName = (workspaceId: string | null | undefined) =>
			workspaceId ? (workspaceNames.get(workspaceId) ?? "") : "";
		const withWorkspace = (label: string, workspaceId: string | null | undefined) =>
			[label, workspaceName(workspaceId)].filter(Boolean).join(" · ");
		const rank = <T,>(
			values: T[],
			candidate: (value: T) => Omit<SearchCandidate<T>, "value">,
		) =>
			rankSearchCandidates(
				values.map((value) => ({ ...candidate(value), value })),
				parsedQuery,
				scope,
			);

		// Úkoly — bez schránkových položek (nezařazené v inbox projektech patří do Schránky).
		const taskHits = rank(
			(tasks ?? [])
			.filter(
				(tk) =>
					!(tk.project_id && inboxIds.has(tk.project_id) && !tk.due_date && !tk.parent_id),
			),
			(tk) => {
				const project = tk.project_id ? projMap.get(tk.project_id) : undefined;
				return {
					id: tk.id,
					kind: "task",
					title: tk.name ?? "",
					fields: [tk.description, project?.name, ...(commentsByTask.get(tk.id) ?? [])],
					workspace: workspaceName(project?.workspace_id),
					status: tk.completed_at ? "done" : "open",
					date: tk.due_date,
				} satisfies Omit<SearchCandidate<TaskRow>, "value">;
			},
		);
		const rTasks = taskHits.slice(0, 10).map(({ value: tk }) => {
			const project = tk.project_id ? projMap.get(tk.project_id) : undefined;
			return {
				id: tk.id,
				searchKey: `task:${tk.id}`,
				name: tk.name ?? "",
				sub: withWorkspace(project?.name ?? "", project?.workspace_id),
				color: project?.color ?? null,
				done: !!tk.completed_at,
				run: () =>
					void navigate({
						to: "/ukoly",
						search: { prostor: project?.workspace_id ?? undefined, ukol: tk.id },
					}),
			};
		});

		const KIND: Record<string, string> = {
			flow: t("search.kindFlow"),
			goal: t("search.kindGoal"),
			cycle: t("search.kindCycle"),
		};
		const projectHits = rank(projects, (project) => ({
			id: project.id,
			kind: "project",
			title: project.name ?? "",
			fields: [project.definition_of_done, KIND[project.kind ?? "flow"]],
			workspace: workspaceName(project.workspace_id),
			status: project.status,
			date: project.delivery_date,
		}));
		const rProjects = projectHits.slice(0, 8).map(({ value: p }) => ({
				id: p.id,
				searchKey: `project:${p.id}`,
				name: p.name ?? "",
				sub: withWorkspace(
					KIND[p.kind ?? "flow"] ?? t("palette.kindProject"),
					p.workspace_id,
				),
				color: p.color ?? null,
				run: () =>
					void navigate({
						to: "/projekty",
						search: { prostor: p.workspace_id ?? undefined, projekt: p.id },
					}),
			}));

		const personHits = rank(people, (person) => ({
			id: person.id,
			kind: "person",
			title: person.name,
			fields: [person.email, person.job],
			workspace: (person.workspaceIds ?? []).map(workspaceName).join(" "),
		}));
		const rPeople = personHits.slice(0, 8).map(({ value: p }) => {
			const workspaceId =
				(activeWs && p.workspaceIds?.includes(activeWs) ? activeWs : p.workspaceIds?.[0]) ?? undefined;
			return {
				id: p.id,
				searchKey: `person:${p.id}`,
				name: p.name,
				sub: withWorkspace(p.job || t("search.member"), workspaceId),
				run: () =>
					void navigate({
						to: "/reporty",
						search: { tab: "lide", clen: p.id, prostor: workspaceId },
					}),
			};
		});

		const doneBy = new Map<string, { done: number; total: number }>();
		for (const st of steps ?? []) {
			if (!st.chain_id) continue;
			const c = doneBy.get(st.chain_id) ?? { done: 0, total: 0 };
			c.total++;
			if (st.step_state === "done") c.done++;
			doneBy.set(st.chain_id, c);
		}
		const flowHits = rank(chains ?? [], (flow) => ({
			id: flow.id,
			kind: "flow",
			title: flow.name ?? "",
			fields: [flow.description],
			workspace: workspaceName(flow.workspace_id),
			status: flow.state,
			date: flow.anchor_date,
		}));
		const rFlows = flowHits.slice(0, 8).map(({ value: ch }) => {
				const c = doneBy.get(ch.id) ?? { done: 0, total: 0 };
				return {
					id: ch.id,
					searchKey: `flow:${ch.id}`,
					name: ch.name ?? "",
					sub: withWorkspace(`${c.done}/${c.total} ${t("search.steps")}`, ch.workspace_id),
					run: () =>
						void navigate({
							to: "/postupy",
							search: { postup: ch.id, prostor: ch.workspace_id ?? undefined },
						}),
				};
			});

		const GSCOPE: Record<string, string> = {
			team: t("search.goalTeam"),
			project: t("search.goalProject"),
			personal: t("search.goalPerson"),
			person: t("search.goalPerson"),
		};
		const goalHits = rank(goals ?? [], (goal) => ({
			id: goal.id,
			kind: "goal",
			title: goal.name ?? "",
			fields: [goal.metric, goal.period, GSCOPE[goal.scope ?? ""]],
			workspace: workspaceName(goal.workspace_id),
			date: goal.due_date,
		}));
		const rGoals = goalHits.slice(0, 8).map(({ value: g }) => ({
				id: g.id,
				searchKey: `goal:${g.id}`,
				name: g.name ?? "",
				sub: withWorkspace(
					GSCOPE[g.scope ?? ""] ?? t("search.goalGeneric"),
					g.workspace_id,
				),
				run: () =>
					void navigate({
						to: "/cile",
						search: { cil: g.id, prostor: g.workspace_id ?? undefined },
					}),
			}));

		const listHits = rank(lists ?? [], (list) => ({
			id: list.id,
			kind: "list",
			title: list.name ?? "",
			fields: [list.event, ...(itemsByList.get(list.id) ?? [])],
			workspace: workspaceName(list.workspace_id),
		}));
		const rLists = listHits.slice(0, 8).map(({ value: list }) => ({
				id: list.id,
				searchKey: `list:${list.id}`,
				name: list.name ?? t("search.unnamedList"),
				sub: withWorkspace(list.event ?? t("search.checklist"), list.workspace_id),
				run: () =>
					void navigate({
						to: "/seznamy",
						search: { seznam: list.id, prostor: list.workspace_id ?? undefined },
					}),
			}));

		const taskById = new Map((tasks ?? []).map((task) => [task.id, task] as const));
		const meetingHits = rank(meetings ?? [], (meeting) => ({
			id: meeting.id,
			kind: "meeting",
			title: meeting.title ?? "",
			workspace: workspaceName(meeting.workspace_id),
			status: meeting.status,
			date: meeting.hub_task_id ? taskById.get(meeting.hub_task_id)?.due_date : null,
		}));
		const rMeetings = meetingHits.slice(0, 8).map(({ value: meeting }) => ({
				id: meeting.id,
				searchKey: `meeting:${meeting.id}`,
				name: meeting.title ?? t("search.unnamedMeeting"),
				sub: withWorkspace(meeting.status ?? t("search.meeting"), meeting.workspace_id),
				run: () =>
					void navigate({
						to: "/meets",
						search: { meet: meeting.id, prostor: meeting.workspace_id ?? undefined },
					}),
			}));

		const mailHits = rank(threads, (thread) => ({
			id: thread.id,
			kind: "mail",
			title: thread.subj,
			fields: [
				thread.snip,
				thread.from.n,
				thread.from.addr,
				...thread.msgs.flatMap((message) => [...message.body, ...(message.quote ?? [])]),
				...thread.chat.flatMap((message) => [message.m, message.pre, message.post]),
			],
			workspace: thread.personal ? t("savedViews.personal") : thread.mb,
			status: thread.st,
			from: [thread.from.n, thread.from.addr],
		}));
		const rMail = mailHits.slice(0, 10).map(({ value: thread }) => ({
				id: thread.id,
				searchKey: `mail:${thread.id}`,
				name: thread.subj,
				sub: thread.from.n,
				run: () => void navigate({ to: "/mail", search: { vlakno: thread.id } }),
			}));

		const contactHits = rank(contacts ?? [], (contact) => ({
			id: contact.id,
			kind: "contact",
			title: contact.name || contact.email || "",
			fields: [contact.email, contact.org, contact.role, contact.areas, contact.note],
			workspace: workspaceName(contact.workspace_id),
		}));
		const rContacts = contactHits.slice(0, 8).map(({ value: contact }) => ({
				id: contact.id,
				searchKey: `contact:${contact.id}`,
				name: contact.name || contact.email || t("search.unnamedContact"),
				sub: withWorkspace(
					[contact.org, contact.email].filter(Boolean).join(" · "),
					contact.workspace_id,
				),
				// Adresář zatím nemá vlastní detail; Mail je jeho jediný produkční konzument.
				run: () => void navigate({ to: "/mail" }),
			}));

		const total =
			taskHits.length +
			projectHits.length +
			personHits.length +
			flowHits.length +
			goalHits.length +
			listHits.length +
			meetingHits.length +
			mailHits.length +
			contactHits.length;
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
		workspaceNames,
		parsedQuery,
		scope,
		activeWs,
		t,
		navigate,
	]);
	const resultList = useMemo(
		() =>
			res
				? [
						...res.tasks,
						...res.projects,
						...res.people,
						...res.flows,
						...res.goals,
						...res.lists,
						...res.meetings,
						...res.mail,
						...res.contacts,
					]
				: [],
		[res],
	);
	const selectionResetKey = `${q}\u0000${scope}\u0000${resultList
		.map((result) => result.searchKey)
		.join("|")}`;
	const firstResultKey = resultList[0]?.searchKey ?? null;
	useEffect(() => {
		void selectionResetKey;
		setActiveResult(firstResultKey);
		// Stabilní podpis brání resetu klávesové volby při běžném renderu datových hooků.
	}, [selectionResetKey, firstResultKey]);
	const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (resultList.length === 0) return;
		const current = Math.max(
			0,
			resultList.findIndex((result) => result.searchKey === activeResult),
		);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const direction = event.key === "ArrowDown" ? 1 : -1;
			const next = (current + direction + resultList.length) % resultList.length;
			const key = resultList[next]?.searchKey ?? null;
			setActiveResult(key);
			requestAnimationFrame(() =>
				document.querySelector(`[data-search-result="${key}"]`)?.scrollIntoView({ block: "nearest" }),
			);
		} else if (event.key === "Enter") {
			event.preventDefault();
			resultList[current]?.run();
		}
	};
	const scopeOptions: Array<[SearchScope, string]> = [
		["all", t("search.scopeAll")],
		["task", t("search.tasks")],
		["project", t("search.projects")],
		["person", t("search.people")],
		["flow", t("search.flows")],
		["goal", t("search.goals")],
		["list", t("search.scopeLists")],
		["meeting", t("search.meetings")],
		["mail", t("search.mail")],
		["contact", t("search.contacts")],
	];

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
					onKeyDown={onSearchKeyDown}
					placeholder={t("search.placeholder")}
					aria-label={t("search.placeholder")}
					className="min-h-11 min-w-0 flex-1 border-none bg-transparent font-body text-ink outline-none"
					style={{ fontSize: 15 }}
					data-search-screen
				/>
				{res && (
					<span className="hidden shrink-0 font-mono text-ink-3 sm:inline" style={{ fontSize: 11.5 }}>
						{totalLabel(res.total, t)}
					</span>
				)}
				{q && (
					<button
						type="button"
						onClick={() => setQ("")}
						className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-panel-2 hover:text-ink"
						aria-label={t("search.clear")}
					>
						×
					</button>
				)}
			</div>
			<div className="-mt-2 mb-2 overflow-x-auto pb-1" role="group" aria-label={t("search.scopeLabel")}>
				<div className="flex w-max gap-1.5">
					{scopeOptions.map(([value, label]) => (
						<button
							key={value}
							type="button"
							onClick={() => setScope(value)}
							aria-pressed={scope === value}
							className="min-h-11 rounded-full border px-3 font-display font-semibold"
							style={{
								fontSize: 12,
								borderColor: scope === value ? "var(--w-brass)" : "var(--w-line)",
								background: scope === value ? "var(--w-brass-soft)" : "var(--w-card)",
								color: scope === value ? "var(--w-brass-text)" : "var(--w-ink-2)",
							}}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			<div className="mb-4 font-body text-ink-3" style={{ fontSize: 11.5 }}>
				{t("search.operatorHint")}
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
						<Row key={r.id} onClick={r.run} sub={r.sub} resultKey={r.searchKey} active={activeResult === r.searchKey} onActivate={setActiveResult}>
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
						<Row key={r.id} onClick={r.run} sub={r.sub} resultKey={r.searchKey} active={activeResult === r.searchKey} onActivate={setActiveResult}>
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
						<Row key={r.id} onClick={r.run} sub={r.sub} resultKey={r.searchKey} active={activeResult === r.searchKey} onActivate={setActiveResult}>
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
						<Row key={r.id} onClick={r.run} sub={r.sub} subMono resultKey={r.searchKey} active={activeResult === r.searchKey} onActivate={setActiveResult}>
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
						<Row key={r.id} onClick={r.run} sub={r.sub} resultKey={r.searchKey} active={activeResult === r.searchKey} onActivate={setActiveResult}>
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

			{res && res.lists.length > 0 && <SimpleSection label={t("search.lists")} rows={res.lists} mark="☷" activeResult={activeResult} onActivate={setActiveResult} />}
			{res && res.meetings.length > 0 && <SimpleSection label={t("search.meetings")} rows={res.meetings} mark="⌁" activeResult={activeResult} onActivate={setActiveResult} />}
			{res && res.mail.length > 0 && <SimpleSection label={t("search.mail")} rows={res.mail} mark="@" activeResult={activeResult} onActivate={setActiveResult} />}
			{res && res.contacts.length > 0 && <SimpleSection label={t("search.contacts")} rows={res.contacts} mark="•" activeResult={activeResult} onActivate={setActiveResult} />}
		</div>
	);
}

function SimpleSection({
	label,
	rows,
	mark,
	activeResult,
	onActivate,
}: {
	label: string;
	rows: Array<{ id: string; searchKey: string; name: string; sub: string; run: () => void }>;
	mark: string;
	activeResult: string | null;
	onActivate: (key: string) => void;
}) {
	return (
		<Section label={label}>
			{rows.map((row) => (
				<Row
					key={row.id}
					onClick={row.run}
					sub={row.sub}
					resultKey={row.searchKey}
					active={activeResult === row.searchKey}
					onActivate={onActivate}
				>
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
	resultKey,
	active,
	onActivate,
}: {
	children: ReactNode;
	sub: string;
	subMono?: boolean;
	onClick: () => void;
	resultKey: string;
	active: boolean;
	onActivate: (key: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => onActivate(resultKey)}
			onFocus={() => onActivate(resultKey)}
			data-search-result={resultKey}
			className="flex min-h-11 w-full items-center gap-[11px] border-line border-b text-left last:border-b-0 hover:bg-panel-2"
			style={{ padding: "11px 15px", background: active ? "var(--w-brass-soft)" : undefined }}
		>
			{children}
			<span
				className={`min-w-0 max-w-[45%] truncate ${subMono ? "font-mono" : "font-body"} text-ink-3`}
				style={{ fontSize: subMono ? 11.5 : 12 }}
			>
				{sub}
			</span>
		</button>
	);
}
