import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, createContext, useContext, useMemo } from "react";
import { API_URL } from "./api";
import type { TaskRow } from "./powersync/AppSchema";
import { useWorkspace } from "./workspace";

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
}

const EMPTY: RowMeta = { avatars: [], assigneeIds: [] };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

type Member = { id: string; name: string };

interface RowMetaCtx {
  metaOf: (task: TaskRow) => RowMeta;
}
const Ctx = createContext<RowMetaCtx>({ metaOf: () => EMPTY });

export function RowMetaProvider({ children }: { children: ReactNode }) {
  const { activeWs } = useWorkspace();
  const { data: chk } = usePsQuery<{ task_id: string; total: number; done: number }>(
    "SELECT task_id, COUNT(*) AS total, COALESCE(SUM(checked), 0) AS done FROM checklist_items GROUP BY task_id",
  );
  const { data: cmt } = usePsQuery<{ task_id: string; n: number }>(
    "SELECT task_id, COUNT(*) AS n FROM comments GROUP BY task_id",
  );
  const { data: rem } = usePsQuery<{ task_id: string }>(
    "SELECT DISTINCT task_id FROM reminders",
  );
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
  const { data: team } = useQuery({
    queryKey: ["wsMembersFull", activeWs],
    enabled: !!activeWs,
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("members");
      return (await r.json()).members as Member[];
    },
  });

  const value = useMemo<RowMetaCtx>(() => {
    const chkMap = new Map((chk ?? []).map((x) => [x.task_id, x] as const));
    const cmtMap = new Map((cmt ?? []).map((x) => [x.task_id, x.n] as const));
    const remSet = new Set((rem ?? []).map((x) => x.task_id));
    const nameMap = new Map((team ?? []).map((m) => [m.id, initials(m.name)] as const));
    const asgMap = new Map<string, { id: string; ini: string; done: boolean }[]>();
    for (const a of asg ?? []) {
      if (!a.task_id || !a.user_id) continue;
      const arr = asgMap.get(a.task_id) ?? [];
      arr.push({ id: a.user_id, ini: nameMap.get(a.user_id) ?? "?", done: !!a.completed_at });
      asgMap.set(a.task_id, arr);
    }
    const stsMap = new Map((sts ?? []).map((s) => [s.id, s] as const));

    return {
      metaOf: (task: TaskRow) => {
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
          assignAll: isAll
            ? { done: people.filter((p) => p.done).length, total: people.length }
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
      },
    };
  }, [chk, cmt, rem, asg, sts, team]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRowMeta = () => useContext(Ctx);
