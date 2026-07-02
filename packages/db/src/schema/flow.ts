/**
 * Postupy (štafeta) — běžící instance řetězců. Krok = běžný úkol (`tasks`) + řídící vrstva.
 * Kroky jsou SOUROZENECKÉ úkoly (ne podúkoly, R1). Posun řetězce reaguje jen na `completed_at`
 * krok-úkolu (ne na jeho podúkoly, R3). Materializace předem: celý řetězec existuje jako úkoly,
 * posun = překlopení `step_state` dormant→active (idempotentní, LWW-bezpečné). Detaily:
 * files/fazovane_ukoly_PLAN.md.
 */
import {
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
import { chainGateEnum, chainStateEnum, chainStepStateEnum } from "./enums";
import { users } from "./auth";
import { tasks } from "./task";
import { projects, workspaces } from "./workspace";

/** Běžící instance řetězce. */
export const chains = pgTable(
  "chains",
  {
    id: pk(),
    /** KDE řetězec žije (scoping R5). */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Denormalizováno pro sync/audit. */
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** null = ad-hoc řetězec bez šablony (chain_templates přijdou s builderem). */
    templateId: uuid("template_id"),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    /** „Datum show" pro auto-datování kroků. */
    anchorDate: timestamp("anchor_date", { withTimezone: true }),
    state: chainStateEnum("state").notNull().default("active"),
    /** Plánování (prototyp schedMode): chain = termíny z předchozího kroku, anchor = pevné. */
    schedMode: varchar("sched_mode", { length: 10 }).notNull().default("chain"),
    /** Reflow přeskakuje víkendy (prototyp skipWeekend). */
    skipWeekend: integer("skip_weekend").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chains_project_idx").on(t.projectId)],
);

/** Kroky běžící instance; každý ukazuje na reálný úkol. */
export const chainSteps = pgTable(
  "chain_steps",
  {
    id: pk(),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    /** Skutečný úkol kroku (reuse R2/R9/komentáře…). */
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** Denormalizováno pro sync filtr (= chains.project_id). */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    gate: chainGateEnum("gate").notNull().default("after_previous"),
    /** ZDROJ PRAVDY o gatingu. */
    stepState: chainStepStateEnum("step_state").notNull().default("dormant"),
    /** Offset dne od kotvy řetězce (režim Kotva; prototyp anchorOffset). */
    anchorOffset: integer("anchor_offset"),
    /** Odstup od předchozího kroku ve dnech (režim Řetězec; prototyp gapDays). */
    gapDays: integer("gap_days"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chain_steps_chain_position_uq").on(t.chainId, t.position),
    uniqueIndex("chain_steps_task_uq").on(t.taskId),
    index("chain_steps_project_idx").on(t.projectId),
  ],
);

export type Chain = typeof chains.$inferSelect;
export type ChainStep = typeof chainSteps.$inferSelect;
