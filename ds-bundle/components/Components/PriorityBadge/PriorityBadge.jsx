// Watson — PriorityBadge
// R6: priorita je NEBAREVNÝ odznak P1–P4, nezávislý na uživatelských barvách.
// Zdroj pravdy: packages/ui/src/PriorityBadge.tsx (tam přes Tailwind utility + var(--w-*)).
// Tady plain-CSS varianta (třída .w-priority-badge z components.css) pro Claude Design.

export function PriorityBadge({ priority, className = "" }) {
  return (
    <span
      className={`w-priority-badge ${className}`.trim()}
      data-priority={priority}
      aria-label={`Priorita P${priority}`}
    >
      P{priority}
    </span>
  );
}
