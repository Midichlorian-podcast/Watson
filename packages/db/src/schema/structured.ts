/**
 * Strukturovaná projektová data: typovaná vlastní pole a jejich hodnoty na úkolech.
 * Definice je projektová, hodnota vždy dědí stejný project_id jako úkol i definice.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { tasks } from "./task";
import { projects } from "./workspace";

export const CUSTOM_FIELD_TYPES = [
	"text",
	"number",
	"select",
	"date",
	"checkbox",
	"url",
	"person",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomFieldOption = { id: string; label: string };

export const projectCustomFields = pgTable(
	"project_custom_fields",
	{
		id: pk(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 120 }).notNull(),
		fieldType: varchar("field_type", { length: 16 }).$type<CustomFieldType>().notNull(),
		options: jsonb("options").$type<CustomFieldOption[]>().notNull().default([]),
		position: integer("position").notNull().default(0),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("project_custom_fields_id_project_uq").on(t.id, t.projectId),
		uniqueIndex("project_custom_fields_name_uq").on(t.projectId, sql`lower(${t.name})`),
		index("project_custom_fields_project_idx").on(t.projectId, t.position),
		check("project_custom_fields_name_valid", sql`char_length(trim(${t.name})) between 1 and 120`),
		check(
			"project_custom_fields_type_valid",
			sql`${t.fieldType} in ('text', 'number', 'select', 'date', 'checkbox', 'url', 'person')`,
		),
		check("project_custom_fields_position_valid", sql`${t.position} >= 0`),
		check(
			"project_custom_fields_options_valid",
			sql`jsonb_typeof(${t.options}) = 'array' and (
				(${t.fieldType} = 'select' and jsonb_array_length(${t.options}) between 2 and 50)
				or (${t.fieldType} <> 'select' and ${t.options} = '[]'::jsonb)
			)`,
		),
	],
);

/**
 * Hodnota je JSON scalar, protože tak zachováme jeden stabilní read model pro všech sedm typů.
 * Přesný typ, URL/date formát, select option i person membership vynucuje DB trigger.
 */
export const taskCustomFieldValues = pgTable(
	"task_custom_field_values",
	{
		id: pk(),
		fieldId: uuid("field_id").notNull(),
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		value: jsonb("value").$type<unknown>().notNull(),
		updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("task_custom_field_values_task_field_uq").on(t.taskId, t.fieldId),
		index("task_custom_field_values_task_idx").on(t.taskId),
		index("task_custom_field_values_project_idx").on(t.projectId),
		foreignKey({
			name: "task_custom_field_values_field_project_fk",
			columns: [t.fieldId, t.projectId],
			foreignColumns: [projectCustomFields.id, projectCustomFields.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "task_custom_field_values_task_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
	],
);

export type ProjectCustomField = typeof projectCustomFields.$inferSelect;
export type TaskCustomFieldValue = typeof taskCustomFieldValues.$inferSelect;
