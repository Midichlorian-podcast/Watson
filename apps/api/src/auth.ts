/**
 * Better Auth — konfigurace.
 * Lokálně bez čehokoli externího:
 *  - e-mail + heslo: zapnuté,
 *  - 2FA (TOTP): plugin (nepotřebuje externí službu),
 *  - magic link: "dev odesílatel" → odkaz se vypíše do konzole API (žádný Resend),
 *  - Google OAuth: zapne se sám, jen co jsou klíče v .env (jinak se nenabízí).
 */

import {
	accounts,
	getDb,
	memberships,
	projectMembers,
	projects,
	sessions,
	twoFactors,
	users,
	verifications,
	workspaces,
} from "@watson/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, twoFactor } from "better-auth/plugins";
import { env, googleEnabled } from "./env";

const DEV_SECRET = "watson-dev-secret-change-me-in-prod-0000000000000000";
// Fail-closed v produkci: bez silného secretu se session podpisují slabým dev klíčem → v prod
// odmítni start. V dev jen upozorni.
if (!env.authSecret) {
	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"[watson-api] BETTER_AUTH_SECRET musí být nastaven v produkci (fail-closed).",
		);
	}
	console.warn(
		"[watson-api] BETTER_AUTH_SECRET není nastaven — používám DEV secret. " +
			"Pro produkci doplň silný secret do .env.",
	);
}

export const auth = betterAuth({
	appName: "Watson",
	secret: env.authSecret ?? DEV_SECRET,
	baseURL: env.authUrl,
	trustedOrigins: env.webOrigins,

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
							.values({
								workspaceId: ws.id,
								name: "Inbox",
								defaultLayout: "list",
							})
							.returning();
						if (inbox) {
							await db.insert(projectMembers).values({
								projectId: inbox.id,
								userId: user.id,
								role: "manager",
							});
						}
					}
				},
			},
		},
	},

	user: {
		additionalFields: {
			locale: {
				type: "string",
				required: false,
				defaultValue: "cs",
				input: false,
			},
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
			// CC-P0-11 — bearer token NIKDY do logu bez explicitního dev flagu a nikdy
			// v produkci (centralizované logy = únik přihlášení). Bez maileru a bez flagu
			// je kanál záměrně fail-closed; dev si token vytáhne z tabulky verifications.
			sendMagicLink: async ({ email, url }) => {
				if (
					process.env.DEV_AUTH_LOG_LINKS === "1" &&
					process.env.NODE_ENV !== "production"
				) {
					console.log(`\n[watson-api] ✉️  Magic link pro ${email}:\n${url}\n`);
				} else {
					console.log(
						`[watson-api] ✉️  Magic link pro ${email} vygenerován (odkaz se neloguje; zapni DEV_AUTH_LOG_LINKS=1, nebo použij tabulku verifications)`,
					);
				}
			},
		}),
	],
});

export type Auth = typeof auth;
