import type {
	DueKey,
	GroupBy,
	SortBy,
	StatusKey,
	ToolbarState,
} from "../components/TasksToolbar";
import type { Density } from "./tweaks";
import type { ViewMode } from "./viewMode";

export interface SavedTaskViewConfig extends ToolbarState {
	viewMode: Exclude<ViewMode, "calendar">;
	density: Density;
}

const unique = (values: unknown[], valid: (value: unknown) => boolean, max: number) =>
	values.length <= max && new Set(values).size === values.length && values.every(valid);

export function parseSavedTaskViewConfig(raw: unknown): SavedTaskViewConfig | null {
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
		!["list", "board"].includes(String(row.viewMode)) ||
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
		viewMode: row.viewMode as "list" | "board",
		density: row.density as Density,
	};
}

export function makeSavedTaskViewConfig(
	state: ToolbarState,
	viewMode: ViewMode,
	density: Density,
): SavedTaskViewConfig {
	return {
		...state,
		priorities: [...state.priorities],
		statuses: [...state.statuses],
		projects: [...state.projects],
		people: [...state.people],
		due: [...state.due],
		viewMode: viewMode === "board" ? "board" : "list",
		density,
	};
}

export function toolbarStateFromSavedView(config: SavedTaskViewConfig): ToolbarState {
	const { viewMode: _viewMode, density: _density, ...state } = config;
	return {
		...state,
		priorities: [...state.priorities],
		statuses: [...state.statuses],
		projects: [...state.projects],
		people: [...state.people],
		due: [...state.due],
	};
}
