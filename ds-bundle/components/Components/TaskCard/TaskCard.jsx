// Watson — TaskCard
// Karta úkolu: název, prioritní odznak (R6), uživatelská barva (samostatný akcent),
// termín (deadline po termínu červeně), status chip, přiřazení.
// Dva režimy přiřazení (R2) MUSÍ jít vizuálně odlišit:
//   - shared_any → jeden avatar (stačí kdokoli),
//   - shared_all → per-osoba progres „3/5" + skupina avatarů.

import { PriorityBadge } from "../PriorityBadge/PriorityBadge.jsx";

export function TaskCard({
  name,
  priority,
  color = "var(--w-ink-3)",   // uživatelská barva úkolu/projektu — NE priorita
  due,                         // { label: "Po termínu · út", overdue: true }
  status,                      // "Probíhá" | "Ke kontrole" | …
  assignment,                  // { mode: "shared_all", done: 3, total: 5, people: ["T","M"] } | { mode, people }
}) {
  return (
    <div className="w-task-card">
      <div className="w-task-card__top">
        <span className="w-task-card__dot" style={{ background: color }} />
        <span className="w-task-card__name">{name}</span>
      </div>
      <div className="w-task-card__meta">
        <PriorityBadge priority={priority} />
        {due && (
          <span className={`w-chip ${due.overdue ? "w-chip--overdue" : ""}`}>
            <span className="w-num">{due.label}</span>
          </span>
        )}
        {status && <span className="w-chip w-chip--status">{status}</span>}
        <span className="w-task-card__assignees">
          {assignment?.mode === "shared_all" ? (
            <>
              <span className="w-chip">Každý zvlášť · <span className="w-num">{assignment.done}/{assignment.total}</span></span>
              <span className="w-avatar-group">
                {assignment.people.map((p, i) => (
                  <span key={i} className={`w-avatar ${i === 0 ? "w-avatar--brass" : ""}`}>{p}</span>
                ))}
              </span>
            </>
          ) : (
            assignment?.people?.map((p, i) => <span key={i} className="w-avatar">{p}</span>)
          )}
        </span>
      </div>
    </div>
  );
}
