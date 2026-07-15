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
	auditEvents,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sessions,
	sql,
	twoFactors,
	users,
	verifications,
	workspaceInvitations,
	workspaces,
} from "@watson/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, twoFactor } from "better-auth/plugins";
import { sendAuthMail } from "./authMailer";
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
if (process.env.NODE_ENV === "production" && !env.resendApiKey) {
	throw new Error(
		"[watson-api] RESEND_API_KEY musí být nastaven v produkci: magic link, ověření e-mailu a reset hesla nesmí selhat až po požadavku uživatele.",
	);
}
if (process.env.NODE_ENV === "production" && !env.backupSigningSecret) {
	throw new Error(
		"[watson-api] BACKUP_SIGNING_SECRET musí být v produkci nastaven pro ověřitelné exporty a restore.",
	);
}
if (process.env.NODE_ENV === "production" && !env.localDataEncryptionSecret) {
	throw new Error(
		"[watson-api] LOCAL_DATA_ENCRYPTION_SECRET musí být v produkci nastaven pro šifrování lokální PowerSync databáze.",
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
		disableSignUp: !env.authAllowSignup,
		requireEmailVerification: true,
		minPasswordLength: 12,
		resetPasswordTokenExpiresIn: 30 * 60,
		sendResetPassword: async ({ user, url }) => {
			await sendAuthMail({
				to: user.email,
				subject: "Obnova hesla do Watsonu",
				text: "O změnu hesla jste požádali vy nebo správce vašeho účtu. Odkaz platí 30 minut.",
				actionUrl: url,
			});
		},
	},

	emailVerification: {
		expiresIn: 60 * 60,
		sendOnSignUp: env.authAllowSignup,
		sendOnSignIn: true,
		autoSignInAfterVerification: false,
		sendVerificationEmail: async ({ user, url }) => {
			await sendAuthMail({
				to: user.email,
				subject: "Ověření e-mailu pro Watson",
				text: "Potvrďte, že tato e-mailová adresa patří vám. Odkaz platí jednu hodinu.",
				actionUrl: url,
			});
		},
	},

	/** R8 — každý nový uživatel dostane osobní workspace (admin membership). */
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					if (env.authAllowSignup) return;
					const email = user.email.trim().toLowerCase();
					const pending = (await getDb().execute(sql`
						SELECT 1 FROM workspace_invitations
						WHERE lower(email) = ${email}
						  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
						LIMIT 1
					`)) as unknown[];
					// Jediný serverový bod, který smí otevřít invite-only registraci.
					return pending.length > 0 ? undefined : false;
				},
				after: async (user) => {
					const db = getDb();
					// Provisioning musí být all-or-nothing: bez Inboxu nesmí zůstat napůl
					// vytvořený osobní prostor, který už UI neumí bezpečně opravit.
					await db.transaction(async (tx) => {
						const [ws] = await tx
							.insert(workspaces)
							.values({ name: "Osobní", isPersonal: true, ownerId: user.id })
							.returning();
						if (!ws) throw new Error("personal_workspace_not_created");
						await tx.insert(memberships).values({
							userId: user.id,
							workspaceId: ws.id,
							role: "admin",
						});
						const [inbox] = await tx
							.insert(projects)
							.values({
								workspaceId: ws.id,
								name: "Inbox",
								defaultLayout: "list",
							})
							.returning();
						if (!inbox) throw new Error("personal_inbox_not_created");
						await tx.insert(projectMembers).values({
							projectId: inbox.id,
							userId: user.id,
							role: "manager",
						});

						const invitations = (await tx.execute(sql`
							SELECT id, workspace_id, role::text
							FROM workspace_invitations
							WHERE lower(email) = ${user.email.trim().toLowerCase()}
							  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
							FOR UPDATE
						`)) as unknown as { id: string; workspace_id: string; role: "admin" | "manager" | "member" | "guest" }[];
						for (const invitation of invitations) {
							await tx
								.insert(memberships)
								.values({
									userId: user.id,
									workspaceId: invitation.workspace_id,
									role: invitation.role,
								})
								.onConflictDoNothing();
							await tx
								.update(workspaceInvitations)
								.set({ acceptedBy: user.id, acceptedAt: new Date() })
								.where(eq(workspaceInvitations.id, invitation.id));
							await tx.insert(auditEvents).values({
								workspaceId: invitation.workspace_id,
								actorType: "user",
								actorUserId: user.id,
								entity: "workspace_invitation",
								entityId: invitation.id,
								action: "accept",
								diff: { role: invitation.role },
							});
						}
					});
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
					// Invite-only povolení centrálně v user.create.before; Google jej nesmí obejít.
					disableSignUp: false,
				},
			}
		: {},

	plugins: [
		twoFactor({
			issuer: "Watson",
			allowPasswordless: true,
			skipVerificationOnEnable: false,
			twoFactorCookieMaxAge: 5 * 60,
			trustDeviceMaxAge: 14 * 24 * 60 * 60,
		}),
		magicLink({
			// Neznámý e-mail projde jen s platnou workspace_invitations autorizací
			// v databaseHooks.user.create.before.
			disableSignUp: false,
			expiresIn: 5 * 60,
			rateLimit: { window: 60, max: 5 },
			// Produkční DB neobsahuje použitelný bearer token. V dev zůstává plain jen
			// kvůli deterministickým integračním testům a explicitnímu lokálnímu flow.
			storeToken: process.env.NODE_ENV === "production" ? "hashed" : "plain",
			// CC-P0-11 — bearer token NIKDY do logu bez explicitního dev flagu a nikdy
			// v produkci (centralizované logy = únik přihlášení). Bez maileru a bez flagu
			// je kanál záměrně fail-closed; dev si token vytáhne z tabulky verifications.
			sendMagicLink: async ({ email, url }) => {
				await sendAuthMail({
					to: email,
					subject: "Přihlášení do Watsonu",
					text: "Použijte jednorázový přihlašovací odkaz. Pokud jste o něj nežádali, e-mail ignorujte.",
					actionUrl: url,
				});
			},
		}),
	],
});

export type Auth = typeof auth;
