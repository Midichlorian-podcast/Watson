/**
 * Týmy, projekty, struktura. Invarianty R5 (oprávnění), R6 (barvy), R8 (osobní prostor).
 * Pozn.: každá tabulka má jediný UUID PK `id` (požadavek PowerSync), přirozené klíče
 * jsou vynucené přes unique indexy.
 */
import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import {
  projectLayoutEnum,
  projectRoleEnum,
  projectVisibilityEnum,
  statusScopeEnum,
  workspaceRoleEnum,
} from "./enums";
import { users } from "./auth";

export const workspaces = pgTable("workspaces", {
  id: pk(),
  name: varchar("name", { length: 200 }).notNull(),
  /** Volný typ kontextu (kavárna/studio/podcast…) — generické, tvoří uživatel. */
  contextType: varchar("context_type", { length: 64 }),
  /** Brand-nezávislá barva workspace (R6). */
  color: varchar("color", { length: 9 }),
  /** R8 — osobní prostor každého uživatele (soukromý workspace). */
  isPersonal: boolean("is_personal").notNull().default(false),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** R5 — přednastavené role (BEZ plně vlastních rolí). */
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_workspace_uq").on(t.userId, t.workspaceId)],
);

export const projects = pgTable("projects", {
  id: pk(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  /** R6 — uživatelská barva projektu (oddělená od priority a brand palety). */
  color: varchar("color", { length: 9 }),
  icon: varchar("icon", { length: 64 }),
  defaultLayout: projectLayoutEnum("default_layout").notNull().default("list"),
  /** R5 — restricted projekt je neviditelný nečlenům. */
  visibility: projectVisibilityEnum("visibility").notNull().default("team"),
  /** null = nearchivováno. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    id: pk(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRoleEnum("role").notNull().default("editor"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("project_members_project_user_uq").on(t.projectId, t.userId)],
);

export const sections = pgTable("sections", {
  id: pk(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Statusy — jednoduché per projekt (default), volitelně per workspace.
 * R9 — `isDone=true` status je provázaný se zaškrtnutím úkolu (řeší app/sync vrstva).
 */
export const statuses = pgTable("statuses", {
  id: pk(),
  scope: statusScopeEnum("scope").notNull().default("project"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 9 }),
  position: integer("position").notNull().default(0),
  isDone: boolean("is_done").notNull().default(false),
  createdAt: createdAt(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Status = typeof statuses.$inferSelect;
