import { Schema, Table, column } from "@powersync/web";

/**
 * Klientské zrcadlo (podmnožina) tabulky `tasks`.
 * PowerSync přidává textové `id` PK automaticky — neuvádí se.
 * SQLite nemá boolean → completed jako text (ISO) / null.
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

export const AppSchema = new Schema({ tasks });

export type Database = (typeof AppSchema)["types"];
export type TaskRow = Database["tasks"];
