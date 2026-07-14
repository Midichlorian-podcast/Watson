import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

// Načti kořenový .env — bez něj by platil natvrdo psaný fallback, a na tomhle
// stroji porty 5432/5433 drží CIZÍ databáze (LuckyOS tunel, RUBENS). Migrace
// nesmí nikdy potichu mířit jinam, než říká .env.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envPath)) process.loadEnvFile(envPath);
if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL není nastavené (.env) — odmítám hádat cílovou DB.");
}

export default defineConfig({
	schema: "./src/schema/index.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: { url: process.env.DATABASE_URL },
	casing: "snake_case",
});
