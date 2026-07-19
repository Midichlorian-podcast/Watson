/**
 * Interní příjem práce. Formulář je projektová konfigurace, ale jeho aktivní odkaz
 * mohou použít členové prostoru i bez členství v cílovém týmovém projektu.
 * Odpověď atomicky materializuje úkol; nejde o schvalování ani akceptaci úkolu.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { tasks } from "./task";
import { projects } from "./workspace";

export const INTAKE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
] as const;
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];
export type IntakeFieldOption = { id: string; label: string };

export const intakeForms = pgTable(
  "intake_forms",
  {
    id: pk(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    defaultPriority: integer("default_priority").notNull().default(3),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("intake_forms_id_project_uq").on(t.id, t.projectId),
    uniqueIndex("intake_forms_title_uq").on(t.projectId, sql`lower(${t.title})`),
    index("intake_forms_project_idx").on(t.projectId),
    check("intake_forms_title_valid", sql`char_length(trim(${t.title})) between 1 and 160`),
    check("intake_forms_priority_valid", sql`${t.defaultPriority} between 1 and 4`),
    check(
      "intake_forms_description_valid",
      sql`${t.description} is null or char_length(${t.description}) <= 2000`,
    ),
  ],
);

export const intakeFormFields = pgTable(
  "intake_form_fields",
  {
    id: pk(),
    formId: uuid("form_id")
      .notNull()
      .references(() => intakeForms.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 120 }).notNull(),
    fieldType: varchar("field_type", { length: 16 }).$type<IntakeFieldType>().notNull(),
    required: boolean("required").notNull().default(false),
    options: jsonb("options").$type<IntakeFieldOption[]>().notNull().default([]),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("intake_form_fields_form_position_uq").on(t.formId, t.position),
    index("intake_form_fields_form_idx").on(t.formId, t.position),
    check("intake_form_fields_label_valid", sql`char_length(trim(${t.label})) between 1 and 120`),
    check(
      "intake_form_fields_type_valid",
      sql`${t.fieldType} in ('text', 'textarea', 'number', 'date', 'select', 'checkbox')`,
    ),
    check("intake_form_fields_position_valid", sql`${t.position} between 0 and 99`),
    check(
      "intake_form_fields_options_valid",
      sql`jsonb_typeof(${t.options}) = 'array' and (
				(${t.fieldType} = 'select' and jsonb_array_length(${t.options}) between 2 and 20)
				or (${t.fieldType} <> 'select' and ${t.options} = '[]'::jsonb)
			)`,
    ),
  ],
);

/**
 * Snapshot definice drží historickou srozumitelnost i po úpravě formuláře. Task může
 * být později smazán; submission zůstává jako auditovatelná stopa a task_id se odpojí.
 */
export const intakeSubmissions = pgTable(
  "intake_submissions",
  {
    id: pk(),
    formId: uuid("form_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    formSnapshot: jsonb("form_snapshot").$type<Record<string, unknown>>().notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "intake_submissions_form_project_fk",
      columns: [t.formId, t.projectId],
      foreignColumns: [intakeForms.id, intakeForms.projectId],
    }).onDelete("cascade"),
    uniqueIndex("intake_submissions_task_uq").on(t.taskId),
    index("intake_submissions_form_idx").on(t.formId, t.createdAt),
    index("intake_submissions_submitter_idx").on(t.submittedBy, t.createdAt),
    check("intake_submissions_snapshot_object", sql`jsonb_typeof(${t.formSnapshot}) = 'object'`),
    check("intake_submissions_answers_object", sql`jsonb_typeof(${t.answers}) = 'object'`),
  ],
);

export type IntakeForm = typeof intakeForms.$inferSelect;
export type IntakeFormField = typeof intakeFormFields.$inferSelect;
export type IntakeSubmission = typeof intakeSubmissions.$inferSelect;
