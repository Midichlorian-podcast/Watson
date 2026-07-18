export type TaskTab = "dnes" | "prichozi" | "vse" | "zasobnik";

export const parseTaskTab = (value: unknown): TaskTab | undefined =>
	value === "dnes" || value === "prichozi" || value === "vse" || value === "zasobnik"
		? value
		: undefined;
