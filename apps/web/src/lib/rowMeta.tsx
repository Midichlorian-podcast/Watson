import { useQuery as usePsQuery } from "@powersync/react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { initials } from "./format";
import { useAllMembers } from "./overview";
import type { TaskRow } from "./powersync/AppSchema";

/**
 * Metadata řádku úkolu pro TaskCard (prototyp decorate, ř. 2895–2917):
 * checklist ⚏ N/M, komentáře, zvoneček, avatary přiřazených, „Každý zvlášť · N/M",
 * status pilulka. Jeden provider = pár agregačních dotazů pro VŠECHNY seznamy.
 */
export interface RowMeta {
	checklist?: { done: number; total: number };
	comments?: number;
	reminder?: boolean;
	avatars: { initials: string; brass?: boolean }[];
	/** User ids přiřazených (pro „Přišlo na tebe" apod.). */
	assigneeIds: string[];
	assignAll?: { done: number; total: number };
	status?: { label: string; kind: "success" | "muted" };
	/** Název rodiče (kontext vrstveného podúkolu v seznamech). */
	parentName?: string;
	/** R6 — vlastní barva úkolu přihlášeného uživatele (per-user overlay). */
	color?: string;
}

const EMPTY: RowMeta = { avatars: [], assigneeIds: [] };

interface RowMetaCtx {
	metaOf: (task: TaskRow) => RowMeta;
}
const Ctx = createContext<RowMetaCtx>({ metaOf: () => EMPTY });

export function RowMetaProvider({ children }: { children: ReactNode }) {
	// Jména členů napříč VŠEMI prostory — nescopované seznamy (Úkoly/Nadcházející/Oblíbené)
	// agregují cross-workspace úkoly; scoping jen na activeWs by cizí přiřazené ukázal jako „?".
	const allMembers = useAllMembers();
	// ⚏ N/M = reálné podúkoly (tasks s parent_id) — checklist zrušen (rozhodnutí 2026-07-02).
	const { data: chk } = usePsQuery<{
		task_id: string;
		total: number;
		done: number;
	}>(
		`SELECT parent_id AS task_id, COUNT(*) AS total,
            SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
     FROM tasks WHERE parent_id IS NOT NULL GROUP BY parent_id`,
	);
	const { data: cmt } = usePsQuery<{ task_id: string; n: number }>(
		"SELECT task_id, COUNT(*) AS n FROM comments GROUP BY task_id",
	);
	const { data: rem } = usePsQuery<{ task_id: string }>("SELECT DISTINCT task_id FROM reminders");
	const { data: asg } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
		completed_at: string | null;
	}>("SELECT task_id, user_id, completed_at FROM assignments ORDER BY created_at");
	const { data: sts } = usePsQuery<{
		id: string;
		name: string | null;
		is_done: number | null;
		position: number | null;
	}>("SELECT id, name, is_done, position FROM statuses");
	// Jména rodičů (kontext podúkolů v seznamech).
	const { data: parents } = usePsQuery<{ id: string; name: string | null }>(
		"SELECT id, name FROM tasks WHERE id IN (SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL)",
	);
	// R6 — per-uživatelské barvy úkolů (syncuje se jen vlastní, viz sync-config).
	const { data: userColors } = usePsQuery<{
		task_id: string;
		color: string | null;
	}>("SELECT task_id, color FROM task_user_colors");

	const value = useMemo<RowMetaCtx>(() => {
		const chkMap = new Map((chk ?? []).map((x) => [x.task_id, x] as const));
		const cmtMap = new Map((cmt ?? []).map((x) => [x.task_id, x.n] as const));
		const remSet = new Set((rem ?? []).map((x) => x.task_id));
		const nameMap = new Map([...allMembers].map(([id, name]) => [id, initials(name)] as const));
		const asgMap = new Map<string, { id: string; ini: string; done: boolean }[]>();
		for (const a of asg ?? []) {
			if (!a.task_id || !a.user_id) continue;
			const arr = asgMap.get(a.task_id) ?? [];
			arr.push({
				id: a.user_id,
				ini: nameMap.get(a.user_id) ?? "?",
				done: !!a.completed_at,
			});
			asgMap.set(a.task_id, arr);
		}
		const stsMap = new Map((sts ?? []).map((s) => [s.id, s] as const));
		const parentMap = new Map((parents ?? []).map((p) => [p.id, p.name ?? ""] as const));
		const colorMap = new Map(
			(userColors ?? []).filter((c) => c.color).map((c) => [c.task_id, c.color as string] as const),
		);

		// Cache per datový snapshot: metaOf(task) vrací STABILNÍ referenci (spočítá se jen jednou
		// na task.id). Memo se přepočítá při každé změně sledovaných tabulek → cache se sama
		// invaliduje. Zamezí přepočtu avatar/slice na každý render (virtualizace, scroll) a umožní
		// downstream memoizaci řádků.
		const cache = new Map<string, RowMeta>();
		const compute = (task: TaskRow): RowMeta => {
			const c = chkMap.get(task.id);
			const people = asgMap.get(task.id) ?? [];
			const isAll = task.assignment_mode === "shared_all" && people.length >= 2;
			const st = task.status_id ? stsMap.get(task.status_id) : undefined;
			return {
				checklist: c && c.total > 0 ? { done: c.done, total: c.total } : undefined,
				comments: cmtMap.get(task.id),
				reminder: remSet.has(task.id) || undefined,
				avatars: people.slice(0, 3).map((p, i) => ({
					initials: p.ini,
					brass: isAll && i === 0 ? true : undefined,
				})),
				assigneeIds: people.map((p) => p.id),
				parentName: task.parent_id ? parentMap.get(task.parent_id) : undefined,
				color: colorMap.get(task.id),
				assignAll: isAll
					? {
							done: people.filter((p) => p.done).length,
							total: people.length,
						}
					: undefined,
				// Pilulka jen pro ne-výchozí stavy (prototyp: Probíhá/Ke kontrole/Hotovo; „todo" bez pilulky).
				status:
					st?.name && (st.position ?? 0) > 0
						? {
								label: st.name,
								kind: (st.name ?? "").toLowerCase().includes("kontrol") ? "muted" : "success",
							}
						: undefined,
			};
		};
		return {
			metaOf: (task: TaskRow) => {
				const hit = cache.get(task.id);
				if (hit) return hit;
				const meta = compute(task);
				cache.set(task.id, meta);
				return meta;
			},
		};
	}, [chk, cmt, rem, asg, sts, parents, userColors, allMembers]);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRowMeta = () => useContext(Ctx);
