// Watson — PriorityBadge API
// Mirror packages/ui/src/PriorityBadge.tsx

/** R6 — P1 (nejvyšší/akutní) … P4 (default/nejnižší). Nikdy nevázat na barvu. */
export type Priority = 1 | 2 | 3 | 4;

export interface PriorityBadgeProps {
  /** Úroveň priority P1–P4. */
  priority: Priority;
  /** Volitelné doplnění tříd. */
  className?: string;
}

/**
 * Nebarevný odznak priority (P1–P4).
 * Uživatelská barva úkolu/projektu je SAMOSTATNÝ akcent (tečka/proužek) — sem nepatří.
 */
export function PriorityBadge(props: PriorityBadgeProps): JSX.Element;
