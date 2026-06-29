/**
 * Auth (Better Auth) + profil uživatele.
 * JS názvy sloupců = field names, které Better Auth očekává (emailVerified, userId, …);
 * DB sloupce jsou snake_case (casing v drizzle). Mapování modelů předáváme adapteru
 * v apps/api (user/session/account/verification/twoFactor).
 *
 * Pozn.: id jsou uuid (generuje DB / klient pro PowerSync) — Better Auth běží s
 * `generateId: false`, aby respektoval uuid defaulty.
 */
import { boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@watson/shared";
import { createdAt, pk, updatedAt } from "./_helpers";

export const users = pgTable("users", {
  id: pk(),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** twoFactor plugin — zapnuté 2FA (dobrovolné, N7). */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /** Naše rozšíření (additionalFields): i18n preference uživatele (cs default). */
  locale: varchar("locale", { length: 5 }).notNull().default(DEFAULT_LOCALE),
  /** MVP jedno pásmo (Europe/Prague), držené per uživatele pro budoucnost. */
  timezone: varchar("timezone", { length: 64 }).notNull().default(DEFAULT_TIMEZONE),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable("sessions", {
  id: pk(),
  userId: uuidRef("user_id"),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable("accounts", {
  id: pk(),
  userId: uuidRef("user_id"),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  /** Hash hesla pro e-mail+heslo (spravuje Better Auth). */
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verifications = pgTable("verifications", {
  id: pk(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const twoFactors = pgTable("two_factors", {
  id: pk(),
  userId: uuidRef("user_id"),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(true),
});

/** FK na users.id (uuid, cascade). Lokální helper kvůli pořadí definic. */
function uuidRef(column: string) {
  return uuid(column)
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
}

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
