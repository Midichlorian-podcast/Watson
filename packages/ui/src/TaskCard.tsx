import type { Priority } from "@watson/shared";
import { AvatarGroup } from "./Avatar";
import { Chip, StatusChip } from "./Chip";
import { cn } from "./cn";
import { PriorityBadge } from "./PriorityBadge";

export type AssignmentMode = "single" | "shared_any" | "shared_all";

export interface TaskCardAssignment {
  mode: AssignmentMode;
  /** Iniciály řešitelů. */
  people: string[];
  /** shared_all: kolik osob hotovo (per-osoba progres „done/total"). */
  done?: number;
  total?: number;
}

export interface TaskCardProps {
  name: string;
  priority: Priority;
  /** Barva těla karty: dle projektu nebo per-uživatel. NE priorita (ta je levý okraj). */
  color?: string;
  due?: { label: string; overdue?: boolean };
  status?: string;
  assignment?: TaskCardAssignment;
  done?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}

/**
 * Karta úkolu — vlajková komponenta seznamů / „Dnes" / boardu.
 * Barevný model (Claude Design, revize R6): LEVÝ OKRAJ = priorita (p1–p4);
 * tečka/tělo = barva projektu nebo per-uživatelská barva úkolu.
 * R2: shared_any = avatary + 1 checkbox; shared_all = per-osoba progres „3/5".
 */
export function TaskCard({
  name,
  priority,
  color,
  due,
  status,
  assignment,
  done,
  onToggle,
  onOpen,
}: TaskCardProps) {
  const isAll = assignment?.mode === "shared_all";
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-line bg-card py-3 pl-3 pr-4"
      style={{ boxShadow: "var(--w-shadow-sm)", borderLeft: `4px solid var(--w-p${priority})` }}
      onClick={onOpen}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={done ? "Označit jako nehotové" : "Dokončit"}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs text-white"
        style={{
          borderColor: done ? "var(--w-success)" : "var(--w-line)",
          background: done ? "var(--w-success)" : "transparent",
        }}
      >
        {done ? "✓" : ""}
      </button>

      {color && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      )}

      <span
        className={cn(
          "min-w-0 flex-1 truncate font-display text-sm font-semibold",
          done ? "text-ink-3 line-through" : "text-ink",
        )}
      >
        {name}
      </span>

      {due && (
        <Chip tone={due.overdue ? "overdue" : "default"} className="font-mono">
          {due.label}
        </Chip>
      )}
      {status && <StatusChip status={status} />}
      <PriorityBadge priority={priority} />

      {assignment && assignment.people.length > 0 && (
        <span className="flex shrink-0 items-center gap-1.5">
          {isAll && (
            <span className="font-mono text-xs text-ink-2">
              {assignment.done ?? 0}/{assignment.total ?? assignment.people.length}
            </span>
          )}
          <AvatarGroup people={assignment.people} />
        </span>
      )}
    </div>
  );
}
