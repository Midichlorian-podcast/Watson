/**
 * Načtení .env z kořene monorepa (dev) přes vestavěný Node loader — bez externí závislosti.
 * V produkci se proměnné předávají prostředím, soubor nemusí existovat.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}

// Povolené originy webu (CORS + trustedOrigins). WEB_ORIGIN může být čárkou oddělený seznam;
// dev default zahrnuje běžné Vite porty (5173 primární, 5180 fallback při kolizi portů).
const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5180")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

export const env = {
	apiPort: Number(process.env.API_PORT ?? 8787),
	webOrigin: webOrigins[0] ?? "http://localhost:5173",
	webOrigins,
	databaseUrl: process.env.DATABASE_URL,
	authSecret: process.env.BETTER_AUTH_SECRET,
	authUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:8787",
	/** Pilot je invite-only; veřejný signup musí být zapnut explicitně. */
	authAllowSignup: process.env.AUTH_ALLOW_SIGNUP === "1",
	/** V produkci výchozí povinnost 2FA pro adminy/vlastníky; nouzové vypnutí je explicitní. */
	authRequirePrivileged2FA:
		process.env.AUTH_REQUIRE_PRIVILEGED_2FA !== undefined
			? process.env.AUTH_REQUIRE_PRIVILEGED_2FA === "1"
			: process.env.NODE_ENV === "production",
	authEmailFrom: process.env.AUTH_EMAIL_FROM ?? "Watson <auth@watson.local>",
	/** HMAC manifestu aplikačního exportu; musí být jiný než session/signing keys. */
	backupSigningSecret: process.env.BACKUP_SIGNING_SECRET,
	/**
	 * Kořenový secret pro per-user klíče lokální PowerSync DB. Nesmí se sdílet
	 * s Better Auth ani exporty. Změna hodnoty záměrně invaliduje jen lokální
	 * cache (serverová data zůstávají autoritativní).
	 */
	localDataEncryptionSecret: process.env.LOCAL_DATA_ENCRYPTION_SECRET,
	/** Rotovatelný AES-256-GCM keyring výhradně pro mailbox OAuth/IMAP credentials. */
	mailVaultKeysJson: process.env.MAIL_VAULT_KEYS_JSON,
	/** Forwarded IP hlavičky jsou autoritativní jen za námi spravovanou proxy. */
	trustProxy: process.env.TRUST_PROXY === "1",
	/** Samostatný bearer token pro produkční SLO scraper; nikdy nepoužívat jako auth secret. */
	opsMetricsToken: process.env.OPS_METRICS_TOKEN,
	google: {
		clientId: process.env.GOOGLE_CLIENT_ID,
		clientSecret: process.env.GOOGLE_CLIENT_SECRET,
	},
	/** Samostatný OAuth klient pro Gmail; login scopes se tím nikdy nerozšiřují. */
	mailGoogle: {
		clientId: process.env.MAIL_GOOGLE_CLIENT_ID,
		clientSecret: process.env.MAIL_GOOGLE_CLIENT_SECRET,
		redirectUri:
			process.env.MAIL_GOOGLE_REDIRECT_URI ??
			`${(process.env.BETTER_AUTH_URL ?? "http://localhost:8787").replace(/\/$/, "")}/api/mail/oauth/google/callback`,
		authUrl:
			process.env.NODE_ENV === "production"
				? "https://accounts.google.com/o/oauth2/v2/auth"
				: (process.env.MAIL_GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth"),
		tokenUrl:
			process.env.NODE_ENV === "production"
				? "https://oauth2.googleapis.com/token"
				: (process.env.MAIL_GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token"),
		apiBaseUrl:
			process.env.NODE_ENV === "production"
				? "https://gmail.googleapis.com"
				: (process.env.MAIL_GOOGLE_API_BASE_URL ?? "https://gmail.googleapis.com").replace(/\/$/, ""),
		revokeUrl:
			process.env.NODE_ENV === "production"
				? "https://oauth2.googleapis.com/revoke"
				: (process.env.MAIL_GOOGLE_REVOKE_URL ?? "https://oauth2.googleapis.com/revoke"),
	},
	vapid: {
		subject: process.env.VAPID_SUBJECT ?? "mailto:dev@watson.test",
		publicKey: process.env.VAPID_PUBLIC_KEY,
		privateKey: process.env.VAPID_PRIVATE_KEY,
	},
	resendApiKey: process.env.RESEND_API_KEY,
	/** Odesílatel reminderů; může být oddělený od auth domény. */
	reminderEmailFrom:
		process.env.REMINDER_EMAIL_FROM ?? process.env.AUTH_EMAIL_FROM ?? "Watson <auth@watson.local>",
	/** Lokální stub je povolen jen mimo produkci; produkce vždy míří přímo na Resend. */
	resendApiBaseUrl:
		process.env.NODE_ENV === "production"
			? "https://api.resend.com"
			: (process.env.RESEND_API_BASE_URL ?? "https://api.resend.com").replace(/\/$/, ""),
	/** Claude (Anthropic) — pohání AI vrstvu (modul Mítingy, Watson příkazy). */
	anthropicApiKey: process.env.ANTHROPIC_API_KEY,
	/** Model pro AI extrakci — default Opus, přepnutelný přes .env kvůli ceně. */
	anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
	/**
	 * LuckyOS employee API (zaměstnanecký modul). Broker `employee.ts` volá tuto base URL
	 * server-to-server s bridge-tokenem. `mock=1` = dev bez reálného LuckyOS (canned data).
	 */
	luckyOs: {
		baseUrl: process.env.LUCKYOS_BASE_URL,
		mock: process.env.NODE_ENV !== "production" && process.env.LUCKYOS_MOCK === "1",
	},
};

if (
	process.env.NODE_ENV === "production" &&
	(!env.opsMetricsToken || env.opsMetricsToken.length < 32 || env.opsMetricsToken.length > 512)
) {
	throw new Error("[watson-api] OPS_METRICS_TOKEN musí mít v produkci 32–512 znaků.");
}

/** Google login se zapne sám, jakmile jsou v .env oba klíče. */
export const googleEnabled = Boolean(env.google.clientId && env.google.clientSecret);

/** Gmail mailbox OAuth vyžaduje vlastní klientský pár i credential vault. */
export const mailGoogleEnabled = Boolean(
	env.mailGoogle.clientId && env.mailGoogle.clientSecret && env.mailVaultKeysJson,
);

/** Web Push se zapne, jakmile jsou v .env oba VAPID klíče. */
export const pushEnabled = Boolean(env.vapid.publicKey && env.vapid.privateKey);

/** E-mailové notifikace (Resend) — jen když je klíč. */
export const emailEnabled = Boolean(env.resendApiKey);

/** AI vrstva (Claude) se zapne, jakmile je v .env ANTHROPIC_API_KEY. */
export const aiEnabled = Boolean(env.anthropicApiKey);

/** Deterministická ukázková extrakce je výhradně lokální/dev funkce. */
export const aiMockEnabled = !aiEnabled && process.env.NODE_ENV !== "production";

/** Zaměstnanecký modul (most na LuckyOS) — zapnut, když je base URL, nebo dev mock. */
export const luckyOsEnabled = Boolean(env.luckyOs.baseUrl) || env.luckyOs.mock;
