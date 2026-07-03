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

export const env = {
	apiPort: Number(process.env.API_PORT ?? 8787),
	webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
	databaseUrl: process.env.DATABASE_URL,
	authSecret: process.env.BETTER_AUTH_SECRET,
	authUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:8787",
	google: {
		clientId: process.env.GOOGLE_CLIENT_ID,
		clientSecret: process.env.GOOGLE_CLIENT_SECRET,
	},
};

/** Google login se zapne sám, jakmile jsou v .env oba klíče. */
export const googleEnabled = Boolean(
	env.google.clientId && env.google.clientSecret,
);
