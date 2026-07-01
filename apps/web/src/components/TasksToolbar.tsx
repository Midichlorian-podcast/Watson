import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@watson/i18n";

export type SortBy = "smart" | "due" | "priority" | "name";
export interface ToolbarState {
  priorities: number[];
  sortBy: SortBy;
  asc: boolean;
  showDone: boolean;
}

export const DEFAULT_TOOLBAR: ToolbarState = {
  priorities: [],
  sortBy: "smart",
  asc: true,
  showDone: false,
};

/** Řadicí komparátor dle toolbaru (smart = priorita→termín, jinak zvolený klíč). */
export function sortTasks<T extends { name: string | null; priority: number | null; due_date: string | null }>(
  list: T[],
  st: ToolbarState,
): T[] {
  const dir = st.asc ? 1 : -1;
  const byDue = (a: T, b: T) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  };
  const cmp: Record<SortBy, (a: T, b: T) => number> = {
    smart: (a, b) => (a.priority ?? 4) - (b.priority ?? 4) || byDue(a, b),
    due: byDue,
    priority: (a, b) => (a.priority ?? 4) - (b.priority ?? 4),
    name: (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "cs"),
  };
  return [...list].sort((a, b) => dir * cmp[st.sortBy](a, b));
}

/** Filtr dle toolbaru (priority + dokončené). */
export function filterTasks<T extends { priority: number | null; completed_at: string | null }>(
  list: T[],
  st: ToolbarState,
): T[] {
  return list.filter((tk) => {
    if (!st.showDone && tk.completed_at) return false;
    if (st.priorities.length > 0 && !st.priorities.includes(tk.priority ?? 4)) return false;
    return true;
  });
}

/**
 * Toolbar úkolů — Filtr (priorita) / Řazení + směr / Dokončené (1:1 dle Cloud Design,
 * status+lidé dimenze viz RECONCILIACE §24). Sdílený pro seznamové obrazovky.
 */
export function TasksToolbar({
  state,
  onChange,
  hideDone,
}: {
  state: ToolbarState;
  onChange: (next: ToolbarState) => void;
  /** Skryje „Dokončené" toggle (Dnes/Nadcházející mají vlastní sekce hotových). */
  hideDone?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<"filter" | "sort" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const SORTS: [SortBy, string][] = [
    ["smart", t("toolbar.sortSmart")],
    ["due", t("toolbar.sortDue")],
    ["priority", t("toolbar.sortPriority")],
    ["name", t("toolbar.sortName")],
  ];
  const togglePri = (p: number) =>
    onChange({
      ...state,
      priorities: state.priorities.includes(p)
        ? state.priorities.filter((x) => x !== p)
        : [...state.priorities, p],
    });

  const chip = (on: boolean) => ({
    fontSize: 12,
    padding: "4px 11px",
    borderRadius: 999,
    border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
    color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
    background: on ? "var(--w-brass-soft)" : "transparent",
  });

  return (
    <div ref={ref} className="relative mb-4 flex flex-wrap items-center gap-2">
      {/* Filtr */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "filter" ? null : "filter")}
          className="font-display font-semibold"
          style={chip(state.priorities.length > 0 || open === "filter")}
        >
          {t("toolbar.filter")}
          {state.priorities.length > 0 && ` · ${state.priorities.length}`}
        </button>
        {open === "filter" && (
          <div
            className="absolute top-9 left-0 z-30 rounded-xl border border-line bg-card"
            style={{ width: 230, padding: 12, boxShadow: "var(--w-shadow)" }}
          >
            <div
              className="mb-1.5 font-display font-bold text-ink-3 uppercase"
              style={{ fontSize: 10, letterSpacing: ".06em" }}
            >
              {t("toolbar.priority")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePri(p)}
                  className="font-display font-semibold"
                  style={chip(state.priorities.includes(p))}
                >
                  P{p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Řazení */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "sort" ? null : "sort")}
          className="font-display font-semibold"
          style={chip(state.sortBy !== "smart" || open === "sort")}
        >
          {t("toolbar.sort")} · {SORTS.find(([k]) => k === state.sortBy)?.[1]}
        </button>
        {open === "sort" && (
          <div
            className="absolute top-9 left-0 z-30 flex flex-col rounded-xl border border-line bg-card"
            style={{ width: 170, padding: 8, boxShadow: "var(--w-shadow)" }}
          >
            {SORTS.map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onChange({ ...state, sortBy: k });
                  setOpen(null);
                }}
                className="flex items-center gap-2 rounded-lg text-left font-body text-ink hover:bg-panel-2"
                style={{ padding: "7px 9px", fontSize: 12.5 }}
              >
                <span className="w-3 font-bold text-brass-text">{state.sortBy === k ? "✓" : ""}</span>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* směr */}
      <button
        type="button"
        onClick={() => onChange({ ...state, asc: !state.asc })}
        title={state.asc ? t("toolbar.dirAsc") : t("toolbar.dirDesc")}
        className="font-display font-semibold"
        style={chip(false)}
      >
        {state.asc ? "↑" : "↓"}
      </button>

      {/* Dokončené */}
      {!hideDone && (
        <button
          type="button"
          onClick={() => onChange({ ...state, showDone: !state.showDone })}
          className="font-display font-semibold"
          style={chip(state.showDone)}
        >
          {t("toolbar.showDone")}
        </button>
      )}

      {/* aktivní filter chips */}
      {state.priorities.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => togglePri(p)}
          className="inline-flex items-center gap-1.5 rounded-full font-display font-semibold"
          style={{
            fontSize: 11.5,
            padding: "4px 6px 4px 10px",
            background: "var(--w-brass-soft)",
            color: "var(--w-brass-text)",
          }}
        >
          P{p}
          <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
        </button>
      ))}
    </div>
  );
}
