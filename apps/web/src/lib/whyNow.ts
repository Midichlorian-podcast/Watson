import { dateInTimeZone } from "./timeZone";

export const WHY_NOW_MAX_LENGTH = 1000;

export type WhyNowSignal =
  | "due_overdue"
  | "due_today"
  | "deadline_overdue"
  | "deadline_today"
  | "deadline_soon"
  | "starts_today"
  | "priority_one";

type RelevantTask = {
  due_date?: string | null;
  deadline?: string | null;
  start_date?: string | null;
  start_timezone?: string | null;
  priority?: number | null;
  completed_at?: string | null;
};

const datePart = (value: string | null | undefined): string | null => {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return match?.[1] ?? null;
};

const dayDistance = (from: string, to: string): number => {
  const [fy = 0, fm = 0, fd = 0] = from.split("-").map(Number);
  const [ty = 0, tm = 0, td = 0] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

/**
 * Průhledné, deterministické signály relevance. Žádné skryté skóre ani AI inference:
 * každý signál je přímo odvoditelný z polí úkolu a dnešního dne uživatele.
 */
export function whyNowSignals(
  task: RelevantTask,
  options: { today?: string; deviceTimeZone?: string } = {},
): WhyNowSignal[] {
  if (task.completed_at) return [];
  const today = options.today ?? dateInTimeZone(options.deviceTimeZone ?? "Europe/Prague");
  const result: WhyNowSignal[] = [];
  const due = datePart(task.due_date);
  if (due && due < today) result.push("due_overdue");
  else if (due === today) result.push("due_today");

  const deadline = datePart(task.deadline);
  if (deadline && deadline < today) result.push("deadline_overdue");
  else if (deadline === today) result.push("deadline_today");
  else if (deadline && dayDistance(today, deadline) <= 3) result.push("deadline_soon");

  if (task.start_date && task.start_timezone) {
    const start = dateInTimeZone(task.start_timezone, new Date(task.start_date));
    if (start === today && due !== today) result.push("starts_today");
  }
  if (task.priority === 1) result.push("priority_one");
  return result;
}
