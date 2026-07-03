/**
 * Sdílená Zod schémata (validace vstupů FE↔BE).
 * Zatím jen kostra pro scaffold — plný datový model přijde v kroku 2 (schéma + migrace).
 */
import { z } from "zod";
import {
	ASSIGNMENT_MODES,
	PRIORITIES,
	PROJECT_VISIBILITY,
	RECURRENCE_BASIS,
} from "./invariants";

export const idSchema = z.string().uuid();

/** Priorita jako odznak P1–P4 (R6 — nezávislá na barvě). */
export const prioritySchema = z.union([
	z.literal(PRIORITIES[0]),
	z.literal(PRIORITIES[1]),
	z.literal(PRIORITIES[2]),
	z.literal(PRIORITIES[3]),
]);

export const assignmentModeSchema = z.enum(ASSIGNMENT_MODES);
export const recurrenceBasisSchema = z.enum(RECURRENCE_BASIS);
export const projectVisibilitySchema = z.enum(PROJECT_VISIBILITY);

/** Minimální tvar úkolu pro scaffold; rozšíří se s datovým modelem. */
export const taskDraftSchema = z.object({
	name: z.string().min(1).max(500),
	description: z.string().optional(),
	priority: prioritySchema.default(4),
	assignmentMode: assignmentModeSchema.default("single"),
	dueDate: z.string().datetime().optional(),
	projectId: idSchema.optional(),
});
export type TaskDraft = z.infer<typeof taskDraftSchema>;
