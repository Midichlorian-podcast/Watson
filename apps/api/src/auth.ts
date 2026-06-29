/**
 * Better Auth — konfigurace.
 * Lokálně bez čehokoli externího:
 *  - e-mail + heslo: zapnuté,
 *  - 2FA (TOTP): plugin (nepotřebuje externí službu),
 *  - magic link: "dev odesílatel" → odkaz se vypíše do konzole API (žádný Resend),
 *  - Google OAuth: zapne se sám, jen co jsou klíče v .env (jinak se nenabízí).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, twoFactor } from "better-auth/plugins";
import { getDb } from "@watson/db";
import {
  accounts,
  memberships,
  projectMembers,
  projects,
  sessions,
  twoFactors,
  users,
  verifications,
  workspaces,
} from "@watson/db";
import { env, googleEnabled } from "./env";

const DEV_SECRET = "watson-dev-secret-change-me-in-prod-0000000000000000";
if (!env.authSecret) {
  console.warn(
    "[watson-api] BETTER_AUTH_SECRET není nastaven — používám DEV secret. " +
      "Pro produkci doplň silný secret do .env.",
  );
}

export const auth = betterAuth({
  appName: "Watson",
  secret: env.authSecret ?? DEV_SECRET,
  baseURL: env.authUrl,
  trustedOrigins: [env.webOrigin],

  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
    },
  }),

  /** uuid id necháváme generovat DB (defaultRandom) — kompatibilní s PowerSync. */
  advanced: {
    database: { generateId: false },
  },

  emailAndPassword: {
    enabled: true,
    // MVP bez ověřování e-mailu (žádný mailer); zapne se s Resendem později.
    requireEmailVerification: false,
  },

  /** R8 — každý nový uživatel dostane osobní workspace (admin membership). */
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const db = getDb();
          const [ws] = await db
            .insert(workspaces)
            .values({ name: "Osobní", isPersonal: true, ownerId: user.id })
            .returning();
          if (ws) {
            await db
              .insert(memberships)
              .values({ userId: user.id, workspaceId: ws.id, role: "admin" });
            // R8 — výchozí osobní Inbox projekt + členství (kam padá quick add).
            const [inbox] = await db
              .insert(projects)
              .values({ workspaceId: ws.id, name: "Inbox", defaultLayout: "list" })
              .returning();
            if (inbox) {
              await db
                .insert(projectMembers)
                .values({ projectId: inbox.id, userId: user.id, role: "manager" });
            }
          }
        },
      },
    },
  },

  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "cs", input: false },
      timezone: {
        type: "string",
        required: false,
        defaultValue: "Europe/Prague",
        input: false,
      },
    },
  },

  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.google.clientId as string,
          clientSecret: env.google.clientSecret as string,
        },
      }
    : {},

  plugins: [
    twoFactor(),
    magicLink({
      // Dev odesílatel — bez e-mailové služby. Odkaz najdeš v logu API.
      sendMagicLink: async ({ email, url }) => {
        console.log(`\n[watson-api] ✉️  Magic link pro ${email}:\n${url}\n`);
      },
    }),
  ],
});

export type Auth = typeof auth;
