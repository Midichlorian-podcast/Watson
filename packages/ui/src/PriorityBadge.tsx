import type { Priority } from "@watson/shared";
import { cn } from "./cn";

/**
 * Priorita P1–P4. Barevný model dle Claude Design (revize R6): barva = priorita
 * (p1 červená / p2 žlutá / p3 modrá / p4 šedá). Primární signál je levý okraj
 * karty (TaskCard); tady jen doplňkový odznak s barevnou tečkou.
 */
export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink-2",
        className,
      )}
      aria-label={`Priorita P${priority}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--w-p${priority})` }} />
      P{priority}
    </span>
  );
}
