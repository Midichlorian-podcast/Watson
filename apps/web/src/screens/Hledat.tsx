import { useQuery as usePsQuery } from "@powersync/react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type ReactNode, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { initials } from "../lib/format";
import type { ChainRow, GoalRow, TaskRow } from "../lib/powersync/AppSchema";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { useWorkspaces } from "../lib/workspace";

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
 * Hledat — 5 entit (úkoly/projekty/lidé/postupy/cíle), substring match, limity 8/6/6/6/6
 * (1:1 dle Cloud Design). Prompt/empty stavy, počítadlo s českou pluralizací.
 */
export function Hledat() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const projects = useProjects();
	const taskDetail = useTaskDetail();
	const projectDetail = useProjectDetail();
	const { data: workspaces } = useWorkspaces();
	const [q, setQ] = useState("");

	const { data: tasks } = usePsQuery<TaskRow>(
		"SELECT id, name, project_id, due_date, parent_id, completed_at FROM tasks",
	);
	const { data: chains } = usePsQuery<ChainRow>("SELECT id, name FROM chains");
	const { data: steps } = usePsQuery<{
		chain_id: string | null;
		step_state: string | null;
	}>("SELECT chain_id, step_state FROM chain_steps");
	const { data: goals } = usePsQuery<GoalRow>("SELECT id, name, scope FROM goals");

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
					has(tk.name) &&
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
			.filter((ch) => has(ch.name))
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
			.filter((g) => has(g.name))
			.slice(0, 6)
			.map((g) => ({
				id: g.id,
				name: g.name ?? "",
				sub: GSCOPE[g.scope ?? ""] ?? t("search.goalGeneric"),
				run: () => void navigate({ to: "/cile" }),
			}));

		const total = rTasks.length + rProjects.length + rPeople.length + rFlows.length + rGoals.length;
		return {
			tasks: rTasks,
			projects: rProjects,
			people: rPeople,
			flows: rFlows,
			goals: rGoals,
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
		projMap,
		inboxIds,
		t,
		navigate,
		taskDetail,
		projectDetail,
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
				{/* biome-ignore lint/a11y/noAutofocus: search obrazovka — input se má fokusovat hned */}
				<input
					autoFocus
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

			{res && res.total === 0 && (
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
		</div>
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
