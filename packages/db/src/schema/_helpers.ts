/**
 * Sdílené sloupcové stavební kameny.
 * UUID primární klíče jsou generovatelné na klientu (offline tvorba pro PowerSync);
 * defaultRandom() je serverová pojistka.
 */
import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

export const pk = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);
