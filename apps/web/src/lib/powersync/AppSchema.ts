import { Schema, Table, column } from "@powersync/web";

/**
 * Klientské zrcadlo (podmnožina) app tabulek.
 * PowerSync přidává textové `id` PK automaticky — neuvádí se.
 * SQLite nemá boolean → bool sloupce jako integer (0/1), časy jako text (ISO) / null.
 */
const tasks = new Table(
  {
    project_id: column.text,
    section_id: column.text,
    parent_id: column.text,
    name: column.text,
    description: column.text,
    priority: column.integer,
    color: column.text,
    due_date: column.text,
    start_date: column.text,
    deadline: column.text,
    duration_min: column.integer,
    recurrence: column.text,
    recurrence_basis: column.text,
    assignment_mode: column.text,
    status_id: column.text,
    completed_at: column.text,
    created_by: column.text,
    created_at: column.text,
  },
  { indexes: { by_project: ["project_id"] } },
);

/** Projekt (barva = tělo karet úkolů, R6); kind=flow|goal|cycle, status 4-stavový. */
const projects = new Table({
  workspace_id: column.text,
  name: column.text,
  color: column.text,
  icon: column.text,
  default_layout: column.text,
  visibility: column.text,
  kind: column.text,
  owner_id: column.text,
  status: column.text,
  delivery_date: column.text,
  definition_of_done: column.text,
  archived_at: column.text,
  created_at: column.text,
});

const sections = new Table(
  {
    project_id: column.text,
    name: column.text,
    position: column.integer,
    created_at: column.text,
  },
  { indexes: { by_project: ["project_id"] } },
);

/** Stavy úkolů per projekt; is_done (0/1) provázané se zaškrtnutím úkolu (R9). */
const statuses = new Table(
  {
    scope: column.text,
    project_id: column.text,
    workspace_id: column.text,
    name: column.text,
    color: column.text,
    position: column.integer,
    is_done: column.integer,
    created_at: column.text,
  },
  { indexes: { by_project: ["project_id"] } },
);

const project_members = new Table(
  {
    project_id: column.text,
    user_id: column.text,
    role: column.text,
    created_at: column.text,
  },
  { indexes: { by_project: ["project_id"], by_user: ["user_id"] } },
);

export const AppSchema = new Schema({ tasks, projects, sections, statuses, project_members });

export type Database = (typeof AppSchema)["types"];
export type TaskRow = Database["tasks"];
export type ProjectRow = Database["projects"];
export type SectionRow = Database["sections"];
export type StatusRow = Database["statuses"];
export type ProjectMemberRow = Database["project_members"];
