// Watson — TaskCard API
import type { Priority } from "../PriorityBadge/PriorityBadge";

/** R2 — režimy přiřazení. */
export type AssignmentMode = "single" | "shared_any" | "shared_all";

export interface TaskCardDue {
  /** Text termínu, např. „Po termínu · út" nebo „Dnes 14:30". */
  label: string;
  /** Deadline po termínu → zvýraznit červeně (--w-overdue). */
  overdue?: boolean;
}

export interface TaskCardAssignment {
  mode: AssignmentMode;
  /** Iniciály řešitelů (zobrazené avatary). */
  people: string[];
  /** shared_all: kolik osob hotovo (per-osoba progres „done/total"). */
  done?: number;
  total?: number;
}

export interface TaskCardProps {
  name: string;
  priority: Priority;
  /** Uživatelská barva úkolu/projektu (CSS color) — SAMOSTATNÝ akcent, ne priorita (R6). */
  color?: string;
  due?: TaskCardDue;
  /** Status chip: „Probíhá", „Ke kontrole", „Hotovo" … */
  status?: string;
  assignment?: TaskCardAssignment;
}

export function TaskCard(props: TaskCardProps): JSX.Element;
