import { Schema, Table, column } from "@powersync/web";

/**
 * Klientské zrcadlo (podmnožina) tabulky `tasks`.
 * PowerSync přidává textové `id` PK automaticky — neuvádí se.
 * SQLite nemá boolean → completed jako text (ISO) / null.
 */
const tasks = new Table(
  {
    project_id: column.text,
    name: column.text,
    priority: column.integer,
    completed_at: column.text,
    created_at: column.text,
  },
  { indexes: { by_project: ["project_id"] } },
);

export const AppSchema = new Schema({ tasks });

export type Database = (typeof AppSchema)["types"];
export type TaskRow = Database["tasks"];
