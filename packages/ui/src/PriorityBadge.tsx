import type { Priority } from "@watson/shared";
import { cn } from "./cn";

/**
 * R6 — priorita je NEBAREVNÝ odznak P1–P4, nezávislý na uživatelských barvách.
 * Vizuál sjednotí Claude Design; tady je funkční základ.
 */
export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        "border-[var(--w-line)] text-[var(--w-ink-2)]",
        className,
      )}
      aria-label={`Priorita P${priority}`}
    >
      P{priority}
    </span>
  );
}
