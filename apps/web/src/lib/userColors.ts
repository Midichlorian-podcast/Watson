import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";
import { parseOccId } from "./occurrences";

/**
 * R6 — per-uživatelské barvy úkolů (task_user_colors; syncuje se jen vlastní barva).
 * Vrací funkci colorOf(taskId, fallback) — vlastní barva má přednost před sdílenou tasks.color.
 * Podporuje i virtuální výskyty `base@ISO` (ořízne na base id).
 */
export function useUserColors() {
	const { data } = usePsQuery<{ task_id: string; color: string | null }>(
		"SELECT task_id, color FROM task_user_colors",
	);
	return useMemo(() => {
		const map = new Map(
			(data ?? [])
				.filter((c) => c.color)
				.map((c) => [c.task_id, c.color as string] as const),
		);
		return (taskId: string, fallback?: string | null): string | null => {
			const base = parseOccId(taskId)?.taskId ?? taskId;
			return map.get(base) ?? fallback ?? null;
		};
	}, [data]);
}
