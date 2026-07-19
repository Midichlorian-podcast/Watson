import { createHmac } from "node:crypto";

export const PRIMARY_LOCAL_DATA_ENCRYPTION_SECRET =
	"watson-dev-local-data-encryption-secret-not-for-production";

type LocalDataRootOptions = {
	configuredSecret?: string;
	nodeEnv?: string;
	apiPort: number;
	authUrl: string;
	webOrigins: string[];
};

function isLocalOrigin(value: string, expectedPort: number): boolean {
	try {
		const url = new URL(value);
		return (
			(url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
			Number(url.port) === expectedPort
		);
	} catch {
		return false;
	}
}

/**
 * Hlavní lokální runtime (API 8787 + Vite 5173/5180) musí mít stabilní klíč napříč
 * ručním vývojem i UI audity. Jiný dočasný secret by nad stejným Safari
 * originem způsobil pouze nečitelnou lokální cache (`file is not a database`).
 * Izolované testovací servery na jiných portech dál respektují vlastní secret;
 * produkce vždy používá povinný secret z prostředí.
 */
export function resolveLocalDataEncryptionRoot(options: LocalDataRootOptions): string {
	const isPrimaryLocalRuntime =
		options.nodeEnv !== "production" &&
		options.apiPort === 8787 &&
		isLocalOrigin(options.authUrl, 8787) &&
		options.webOrigins.some(
			(origin) => isLocalOrigin(origin, 5173) || isLocalOrigin(origin, 5180),
		);

	if (isPrimaryLocalRuntime) return PRIMARY_LOCAL_DATA_ENCRYPTION_SECRET;
	return options.configuredSecret ?? PRIMARY_LOCAL_DATA_ENCRYPTION_SECRET;
}

export function deriveLocalDataKey(root: string, userId: string): string {
	return createHmac("sha256", root)
		.update(`watson-local-db:v1:${userId}`)
		.digest("base64url");
}
