import type { Priority } from "@watson/shared";
import { cn } from "./cn";

export type AssignmentMode = "single" | "shared_any" | "shared_all";

export interface TaskCardProps {
  name: string;
  /** Priorita 1–4 — POUZE levý okraj (inset box-shadow), ne odznak. */
  priority: Priority;
  /** Tečka + podřádek projektu. */
  projectName?: string;
  projectColor?: string;
  due?: { label: string; overdue?: boolean };
  /** Volitelný status label (Probíhá / Ke kontrole / Hotovo). */
  status?: string;
  /** Krok postupu — chip „⛓ X/Y", klik otevře postup. */
  flow?: { label: string; onClick?: () => void };
  done?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}

const PRI: Record<Priority, string> = {
  1: "var(--w-p1)",
  2: "var(--w-p2)",
  3: "var(--w-p3)",
  4: "var(--w-p4)",
};

/**
 * Řádek úkolu — 1:1 dle Cloud Design: plochý řádek s `border-bottom`, levý okraj = priorita
 * (inset box-shadow 3px), tečka + název projektu v podřádku, termín jako mono text (po termínu =
 * červená), NEUTRÁLNÍ prioritní odznak P1–P4. Hotový = opacity .5 + přeškrtnutý název, bez okraje.
 */
export function TaskCard({
  name,
  priority,
  projectName,
  projectColor,
  due,
  status,
  flow,
  done,
  onToggle,
  onOpen,
}: TaskCardProps) {
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer items-center gap-3 border-line border-b hover:bg-panel-2"
      style={{
        padding: "10px 4px 10px 11px",
        borderRadius: "0 6px 6px 0",
        boxShadow: done ? undefined : `inset 3px 0 0 ${PRI[priority]}`,
        opacity: done ? 0.5 : 1,
      }}
    >
      {/* zaškrtávátko */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={done ? "Označit jako nehotové" : "Dokončit"}
        className="grid shrink-0 place-items-center rounded-full"
        style={{
          width: 18,
          height: 18,
          background: done ? "var(--w-brass)" : "transparent",
          border: done ? "none" : "2px solid var(--w-line)",
        }}
      >
        {done && (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path
              d="M2 5.7 L4.3 8 L9 2.7"
              stroke="#fff"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* tečka projektu */}
      <span
        className="shrink-0 rounded-full"
        style={{ width: 8, height: 8, background: projectColor ?? "var(--w-ink-3)" }}
      />

      {/* název + podřádek */}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate font-display font-semibold",
            done ? "text-ink-3 line-through" : "text-ink",
          )}
          style={{ fontSize: 13.5 }}
        >
          {name}
        </div>
        {projectName && (
          <div className="mt-0.5 font-body text-ink-3" style={{ fontSize: 11.5 }}>
            {projectName}
          </div>
        )}
      </div>

      {/* krok postupu (⛓ X/Y) */}
      {flow && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            flow.onClick?.();
          }}
          className="shrink-0 rounded-full font-mono"
          style={{
            fontSize: 10.5,
            padding: "2px 8px",
            background: "var(--w-brass-soft)",
            color: "var(--w-brass-text)",
          }}
        >
          ⛓ {flow.label}
        </button>
      )}

      {/* termín */}
      {due && (
        <span
          className="shrink-0 font-mono"
          style={{ fontSize: 12, color: due.overdue ? "var(--w-overdue)" : "var(--w-ink-2)" }}
        >
          {due.label}
        </span>
      )}

      {/* prioritní odznak — NEUTRÁLNÍ pill (barva priority je jen levý okraj) */}
      <span
        className="shrink-0 font-display font-semibold"
        style={{
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 999,
          background: "var(--w-card)",
          border: `1px solid ${priority === 1 ? "var(--w-ink-3)" : "var(--w-line)"}`,
          color:
            priority === 1 ? "var(--w-ink)" : priority === 4 ? "var(--w-ink-3)" : "var(--w-ink-2)",
        }}
      >
        P{priority}
      </span>

      {/* status (volitelný) */}
      {status && <StatusPill status={status} />}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const success = status === "Hotovo" || status === "Probíhá";
  return (
    <span
      className="shrink-0 font-display font-semibold"
      style={{
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: 999,
        background: success ? "var(--w-success-soft)" : "var(--w-panel-2)",
        color: success ? "var(--w-success-ink)" : "var(--w-ink-2)",
      }}
    >
      {status}
    </span>
  );
}
