/**
 * Úkoly a jejich okolí. Tady žijí klíčové invarianty:
 * R1 (max 3 úrovně — vynucuje app/validace), R2 (assignment_mode + per-osoba completed_at),
 * R3 (podúkoly NEdokončují rodiče — řeší app logika), R4 (opakování),
 * R6 (barva ≠ priorita), R9 (zaškrtnutí ↔ status Hotovo — řeší app/sync).
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { assignmentModeEnum, recurrenceBasisEnum } from "./enums";
import { users } from "./auth";
import { projects, sections, statuses, workspaces } from "./workspace";

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    /** R1 — hierarchie max 3 úrovně (hloubku hlídá validace, ne DB). */
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 500 }).notNull(),
    /** Markdown (BEZ CRDT v MVP — §12), LWW přes PowerSync. */
    description: text("description"),
    /** R6 — priorita P1–P4 (nebarevný odznak), nezávislá na barvě. */
    priority: integer("priority").notNull().default(4),
    /** R6 — uživatelský barevný akcent úkolu. */
    color: varchar("color", { length: 9 }),
    /** B1 — kdy se plánuje pracovat. */
    dueDate: timestamp("due_date", { withTimezone: true }),
    startDate: timestamp("start_date", { withTimezone: true }),
    /** R6/B2 — dokdy musí být hotovo (zobrazit zřetelně, červeně). */
    deadline: timestamp("deadline", { withTimezone: true }),
    /** B3 — odhad délky pro time-blocking (NE time tracking). */
    durationMin: integer("duration_min"),
    /** Vícedenní úkol — počet dní od due_date (1 = jednodenní); kalendář kreslí pruh. */
    days: integer("days"),
    /** Pořadí na nástěnce v rámci sloupce (prototyp boardOrder). */
    sortOrder: integer("sort_order"),
    /** R4 — lidský label opakování (zobrazení); null = neopakuje se. */
    recurrence: text("recurrence"),
    /** R4 — strukturované pravidlo (JSON RecurrenceRule) pro occurrence engine. */
    recurrenceRule: text("recurrence_rule"),
    recurrenceBasis: recurrenceBasisEnum("recurrence_basis").notNull().default("due_date"),
    /** R2 — režim přiřazení. */
    assignmentMode: assignmentModeEnum("assignment_mode").notNull().default("single"),
    statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /**
     * R2 — u `single`/`shared_any` se nastaví přímo;
     * u `shared_all` je ODVOZENÉ (vyplní se až mají všechny Assignment completed_at).
     * R9 — provázané se statusem „Hotovo".
     */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("tasks_priority_range", sql`${t.priority} between 1 and 4`),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_parent_idx").on(t.parentId),
    index("tasks_status_idx").on(t.statusId),
    index("tasks_due_idx").on(t.dueDate),
  ],
);

/** R2 — per-osoba přiřazení; `completedAt` se u `shared_all` nastavuje zvlášť. */
export const assignments = pgTable(
  "assignments",
  {
    id: pk(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** Denormalizace pro PowerSync scoping (bucket = project). */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("assignments_task_user_uq").on(t.taskId, t.userId)],
);

/**
 * R4 — per-výskyt výjimky opakovaného úkolu (exceptions mapa prototypu, ř. 2477–2482):
 * dokončení/přeskočení JEDNOHO výskytu bez dotčení řady. occ_date = ISO den výskytu.
 */
export const taskOccurrenceOverrides = pgTable(
  "task_occurrence_overrides",
  {
    id: pk(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** Denormalizace pro PowerSync scoping. */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    occDate: varchar("occ_date", { length: 10 }).notNull(),
    done: boolean("done").notNull().default(false),
    skipped: boolean("skipped").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("task_occ_overrides_uq").on(t.taskId, t.occDate)],
);

/** R1 — lehká položka (bez přiřazení/termínu), nezaměňovat s úkolem. */
export const checklistItems = pgTable("checklist_items", {
  id: pk(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  /** Denormalizace pro PowerSync scoping. */
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  text: varchar("text", { length: 500 }).notNull(),
  checked: boolean("checked").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * R7 — štítky globální pro interní tým, ale skryté hostům.
 * `workspaceId = null` → globální napříč týmem; non-null → per-workspace.
 * `isInternal = true` → nezobrazovat hostům (filtruje permission vrstva).
 */
export const labels = pgTable(
  "labels",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 9 }),
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("labels_workspace_idx").on(t.workspaceId)],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    id: pk(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("task_labels_task_label_uq").on(t.taskId, t.labelId)],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Assignment = typeof assignments.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type TaskLabel = typeof taskLabels.$inferSelect;
