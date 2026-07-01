import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";

export interface FlowStepInfo {
  chainId: string;
  /** Název postupu (chip „→ {název} ·· 2/5"). */
  name: string;
  /** Pozice kroku 1-based. */
  pos: number;
  total: number;
  state: string;
}

/** Mapa task_id → krok postupu (pro chip postupu na kartách úkolů). Jeden dotaz pro celý seznam. */
export function useFlowSteps(): Map<string, FlowStepInfo> {
  const { data } = usePsQuery<{
    chain_id: string | null;
    task_id: string | null;
    position: number | null;
    step_state: string | null;
  }>("SELECT chain_id, task_id, position, step_state FROM chain_steps");
  const { data: chains } = usePsQuery<{ id: string; name: string | null }>(
    "SELECT id, name FROM chains",
  );

  return useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of data ?? []) {
      if (s.chain_id) totals.set(s.chain_id, (totals.get(s.chain_id) ?? 0) + 1);
    }
    const names = new Map((chains ?? []).map((c) => [c.id, c.name ?? ""] as const));
    const m = new Map<string, FlowStepInfo>();
    for (const s of data ?? []) {
      if (!s.chain_id || !s.task_id) continue;
      m.set(s.task_id, {
        chainId: s.chain_id,
        name: names.get(s.chain_id) ?? "",
        pos: (s.position ?? 0) + 1,
        total: totals.get(s.chain_id) ?? 1,
        state: s.step_state ?? "dormant",
      });
    }
    return m;
  }, [data, chains]);
}
