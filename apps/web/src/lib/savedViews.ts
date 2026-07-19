import type {
	DueKey,
	GroupBy,
	SortBy,
	StatusKey,
	ToolbarState,
} from "../components/TasksToolbar";
import type { Density } from "./tweaks";
import type { ViewMode } from "./viewMode";

export type SavedViewSurface = "tasks" | "upcoming";

interface SavedToolbarConfig extends ToolbarState {
	density: Density;
}

export interface SavedTaskViewConfig extends SavedToolbarConfig {
	viewMode: Exclude<ViewMode, "calendar">;
}

export interface SavedUpcomingViewConfig extends SavedToolbarConfig {
	viewMode: ViewMode;
	/** null = všechny prostory; UUID = konkrétní workspace chip. */
	workspaceFilter: string | null;
}

const unique = (values: unknown[], valid: (value: unknown) => boolean, max: number) =>
	values.length <= max && new Set(values).size === values.length && values.every(valid);

function parseToolbarConfig(
	raw: unknown,
	allowedViews: ViewMode[],
): (SavedToolbarConfig & { viewMode: ViewMode; workspaceFilter?: string | null }) | null {
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	const priorities = row.priorities;
	const statuses = row.statuses;
	const projects = row.projects;
	const people = row.people;
	const due = row.due;
	if (
		!Array.isArray(priorities) ||
		!unique(priorities, (item) => Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 4, 4) ||
		!Array.isArray(statuses) ||
		!unique(statuses, (item) => ["probiha", "kontrola", "", "hotovo"].includes(String(item)), 4) ||
		!Array.isArray(projects) ||
		!unique(projects, (item) => typeof item === "string" && item.length > 0, 100) ||
		!Array.isArray(people) ||
		!unique(people, (item) => typeof item === "string" && item.length > 0, 100) ||
		!Array.isArray(due) ||
		!unique(due, (item) => ["overdue", "today", "next7", "none"].includes(String(item)), 4) ||
		!["smart", "due", "priority", "name", "project", "status"].includes(String(row.sortBy)) ||
		typeof row.asc !== "boolean" ||
		typeof row.showDone !== "boolean" ||
		!["project", "priority", "status", "none"].includes(String(row.groupBy)) ||
		!allowedViews.includes(row.viewMode as ViewMode) ||
		!["vzdusne", "vyvazene", "kompaktni"].includes(String(row.density))
	)
		return null;
	return {
		priorities: [...priorities] as number[],
		statuses: [...statuses] as StatusKey[],
		projects: [...projects] as string[],
		people: [...people] as string[],
		due: [...due] as DueKey[],
		sortBy: row.sortBy as SortBy,
		asc: row.asc,
		showDone: row.showDone,
		groupBy: row.groupBy as GroupBy,
		viewMode: row.viewMode as ViewMode,
		density: row.density as Density,
	};
}

export function parseSavedTaskViewConfig(raw: unknown): SavedTaskViewConfig | null {
	return parseToolbarConfig(raw, ["list", "board"]) as SavedTaskViewConfig | null;
}

export function parseSavedUpcomingViewConfig(raw: unknown): SavedUpcomingViewConfig | null {
	const parsed = parseToolbarConfig(raw, ["list", "board", "calendar"]);
	if (!parsed) return null;
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	const workspaceFilter = (value as Record<string, unknown>).workspaceFilter;
	if (workspaceFilter !== null && typeof workspaceFilter !== "string") return null;
	return { ...parsed, workspaceFilter } as SavedUpcomingViewConfig;
}

function copyToolbar(state: ToolbarState): ToolbarState {
	return {
		...state,
		priorities: [...state.priorities],
		statuses: [...state.statuses],
		projects: [...state.projects],
		people: [...state.people],
		due: [...state.due],
	};
}

export function makeSavedTaskViewConfig(
	state: ToolbarState,
	viewMode: ViewMode,
	density: Density,
): SavedTaskViewConfig {
	return {
		...copyToolbar(state),
		viewMode: viewMode === "board" ? "board" : "list",
		density,
	};
}

export function makeSavedUpcomingViewConfig(
	state: ToolbarState,
	viewMode: ViewMode,
	density: Density,
	workspaceFilter: string | null,
): SavedUpcomingViewConfig {
	return { ...copyToolbar(state), viewMode, density, workspaceFilter };
}

export function toolbarStateFromSavedView(
	config: SavedTaskViewConfig | SavedUpcomingViewConfig,
): ToolbarState {
	return copyToolbar(config);
}
