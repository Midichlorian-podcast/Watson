/**
 * Sdílené cross-workspace agregace pro Přehled a Velín (prototyp flowsOverview
 * ř. 3846–3848 + prehledView/velinView) — cíle v riziku, přehled postupů a jména
 * členů napříč všemi prostory (Cíle/Postupy počítají jen aktivní prostor).
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { API_URL } from "./api";
import {
	goalElapsed,
	goalProgress,
	type GoalStatusKind,
	goalStatus,
	type GoalTranslate,
} from "./goals";
import type { GoalRow } from "./powersync/AppSchema";
import { todayISO } from "./tasks";
import { useWorkspaces } from "./workspace";

/** Jména členů všech mých prostorů (userId → name) — pro agregace napříč firmami. */
export function useAllMembers(): Map<string, string> {
	const { data: workspaces } = useWorkspaces();
	const results = useQueries({
		queries: (workspaces ?? []).map((w) => ({
			queryKey: ["wsMembersFull", w.id],
			queryFn: async () => {
				const r = await fetch(`${API_URL}/api/workspaces/${w.id}/members`, {
					credentials: "include",
				});
				if (!r.ok) throw new Error("members");
				return (await r.json()).members as { id: string; name: string }[];
			},
		})),
	});
	// results je nové pole každý render — memo dle počtu + updatedAt otisku stačí
	const stamp = results.map((r) => r.dataUpdatedAt).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: stamp zastupuje results
	return useMemo(() => {
		const m = new Map<string, string>();
		for (const r of results) {
			for (const mm of r.data ?? []) {
				if (!m.has(mm.id)) m.set(mm.id, mm.name);
			}
		}
		return m;
	}, [stamp]);
}

type TaskLite = {
	id: string;
	name: string | null;
	project_id: string | null;
	completed_at: string | null;
	due_date: string | null;
};

export interface GoalOverviewRow {
	id: string;
	name: string;
	/** Workspace cíle (izolace sfér + filtr firmy). */
	wsId: string | null;
	scope: string | null;
	pct: number;
	label: string;
	elapsed: number;
	status: GoalStatusKind;
}

/**
 * Cíle napříč všemi prostory s progresem a stavem — stejná logika jako Cile.tsx
 * (goalTasks ∩ prostor ∩ projekty ∩ člověk ∩ klíčové slovo, metriky z lib/goals).
 */
export function useGoalsOverview(t?: GoalTranslate): GoalOverviewRow[] {
	const { data: goals } = usePsQuery<GoalRow>("SELECT * FROM goals");
	const { data: goalProjects } = usePsQuery<{
		goal_id: string | null;
		project_id: string | null;
	}>("SELECT goal_id, project_id FROM goal_projects");
	const { data: tasks } = usePsQuery<TaskLite>(
		"SELECT id, name, project_id, completed_at, due_date FROM tasks",
	);
	const { data: projects } = usePsQuery<{
		id: string;
		workspace_id: string | null;
	}>("SELECT id, workspace_id FROM projects");
	const { data: assignments } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");

	return useMemo(() => {
		const tdy = todayISO();
		const projWs = new Map(
			(projects ?? []).map((p) => [p.id, p.workspace_id] as const),
		);
		const linksByGoal = new Map<string, string[]>();
		for (const gp of goalProjects ?? []) {
			if (!gp.goal_id || !gp.project_id) continue;
			linksByGoal.set(gp.goal_id, [
				...(linksByGoal.get(gp.goal_id) ?? []),
				gp.project_id,
			]);
		}
		const assigneesByTask = new Map<string, Set<string>>();
		for (const a of assignments ?? []) {
			if (!a.task_id || !a.user_id) continue;
			const s = assigneesByTask.get(a.task_id) ?? new Set<string>();
			s.add(a.user_id);
			assigneesByTask.set(a.task_id, s);
		}

		return (goals ?? []).map((g) => {
			const links = linksByGoal.get(g.id) ?? [];
			const linkSet = new Set(links);
			const person =
				g.filter_person_id || (g.scope === "person" ? g.owner_id : null);
			const kw = (g.filter_keyword ?? "").trim().toLowerCase();
			const ps = g.period_start ? g.period_start.slice(0, 10) : null;
			const ts = (tasks ?? []).filter((tk) => {
				if (!tk.project_id || projWs.get(tk.project_id) !== g.workspace_id)
					return false;
				if (links.length > 0 && !linkSet.has(tk.project_id)) return false;
				if (person && !assigneesByTask.get(tk.id)?.has(person)) return false;
				if (kw && !(tk.name ?? "").toLowerCase().includes(kw)) return false;
				if (ps && tk.completed_at && tk.completed_at.slice(0, 10) < ps)
					return false;
				return true;
			});
			let projectPct: { pct: number; count: number } | undefined;
			if (g.metric === "project") {
				let w = 0;
				let p = 0;
				for (const pid of links) {
					const pts = (tasks ?? []).filter((tk) => tk.project_id === pid);
					const done = pts.filter((tk) => tk.completed_at).length;
					const pct = pts.length ? Math.round((done / pts.length) * 100) : 0;
					w += pts.length;
					p += pct * pts.length;
				}
				projectPct = { pct: w ? Math.round(p / w) : 0, count: links.length };
			}
			const pr = goalProgress(
				g.metric ?? "completion",
				ts,
				g.target ?? 0,
				projectPct,
				t,
			);
			const overdue = !!g.due_date && g.due_date.slice(0, 10) < tdy;
			const elapsed = goalElapsed(g.created_at, g.due_date, tdy);
			return {
				id: g.id,
				name: g.name ?? "",
				wsId: g.workspace_id,
				scope: g.scope,
				pct: pr.pct,
				label: pr.label,
				elapsed,
				status: goalStatus(pr.pct, elapsed, overdue, false),
			};
		});
	}, [goals, goalProjects, tasks, projects, assignments, t]);
}

export interface FlowOverviewRow {
	id: string;
	name: string;
	projectId: string | null;
	wsId: string | null;
	done: number;
	total: number;
	pct: number;
	/** Aktivní krok je po termínu (prototyp f.stuck). */
	stuck: boolean;
	hasNow: boolean;
	nowName: string;
	/** Jména přiřazených aktivního kroku (čárkou), fallback dodá konzument. */
	nowWho: string;
}

/** Přehled postupů napříč prostory — progres, aktivní krok, vázne (Postupy.tsx logika). */
export function useFlowsOverview(): FlowOverviewRow[] {
	const { data: chains } = usePsQuery<{
		id: string;
		name: string | null;
		project_id: string | null;
		workspace_id: string | null;
	}>("SELECT id, name, project_id, workspace_id FROM chains");
	const { data: steps } = usePsQuery<{
		chain_id: string | null;
		task_id: string | null;
		position: number | null;
		step_state: string | null;
	}>("SELECT chain_id, task_id, position, step_state FROM chain_steps ORDER BY position");
	const { data: tasks } = usePsQuery<TaskLite>(
		"SELECT id, name, project_id, completed_at, due_date FROM tasks",
	);
	const { data: assignments } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");
	const members = useAllMembers();

	return useMemo(() => {
		const tdy = todayISO();
		const taskById = new Map((tasks ?? []).map((tk) => [tk.id, tk] as const));
		const asgByTask = new Map<string, string[]>();
		for (const a of assignments ?? []) {
			if (!a.task_id || !a.user_id) continue;
			asgByTask.set(a.task_id, [...(asgByTask.get(a.task_id) ?? []), a.user_id]);
		}
		return (chains ?? []).map((ch) => {
			const chSteps = (steps ?? []).filter((s) => s.chain_id === ch.id);
			const total = chSteps.length;
			const done = chSteps.filter((s) => s.step_state === "done").length;
			const now = chSteps.find((s) => s.step_state === "active") ?? null;
			const nowTask = now?.task_id ? taskById.get(now.task_id) : undefined;
			const stuck = !!nowTask?.due_date && nowTask.due_date.slice(0, 10) < tdy;
			const nowWho = now?.task_id
				? (asgByTask.get(now.task_id) ?? [])
						.map((uid) => members.get(uid) ?? "")
						.filter(Boolean)
						.join(", ")
				: "";
			return {
				id: ch.id,
				name: ch.name ?? "",
				projectId: ch.project_id,
				wsId: ch.workspace_id,
				done,
				total,
				pct: total ? Math.round((done / total) * 100) : 0,
				stuck,
				hasNow: !!now,
				nowName: nowTask?.name ?? "",
				nowWho,
			};
		});
	}, [chains, steps, tasks, assignments, members]);
}
