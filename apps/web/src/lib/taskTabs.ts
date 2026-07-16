export type TaskTab = "dnes" | "vse" | "zasobnik";

export const parseTaskTab = (value: unknown): TaskTab | undefined =>
	value === "dnes" || value === "vse" || value === "zasobnik" ? value : undefined;
