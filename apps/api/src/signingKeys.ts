import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	exportJWK,
	generateKeyPair,
	importJWK,
	type JWK,
} from "jose";

export const SIGNING_ALG = "RS256";

type StoredSigningKey = {
	kid: string;
	createdAt: string;
	publicJwk: JWK;
	/** Jen aktuální podpisový klíč musí mít private část; staré overlap klíče jsou public-only. */
	privateJwk?: JWK;
};

type StoredKeyRing = {
	version: 1;
	currentKid: string;
	keys: StoredSigningKey[];
};

export type SigningKeyRing = {
	purpose: "powersync" | "luckyos";
	currentKid: string;
	privateKey: Awaited<ReturnType<typeof importJWK>>;
	publicJwks: JWK[];
};

const keyDir = fileURLToPath(new URL("../.keys", import.meta.url));
const legacyPowerSyncFile = fileURLToPath(
	new URL("../.keys/powersync-key.json", import.meta.url),
);

function keyId(publicJwk: JWK) {
	// Stabilní otisk veřejné části; žádné pevné kid a žádný únik private parametrů.
	return createHash("sha256")
		.update(JSON.stringify({ e: publicJwk.e, kty: publicJwk.kty, n: publicJwk.n }))
		.digest("base64url")
		.slice(0, 24);
}

function publicForJwks(publicJwk: JWK, kid: string): JWK {
	return { ...publicJwk, kid, alg: SIGNING_ALG, use: "sig" };
}

function parseStoredRing(raw: string, source: string): StoredKeyRing {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error(`[watson-api] ${source} není platné JSON.`);
	}
	if (!value || typeof value !== "object") {
		throw new Error(`[watson-api] ${source} nemá tvar keyringu.`);
	}
	const ring = value as Partial<StoredKeyRing>;
	if (ring.version !== 1 || typeof ring.currentKid !== "string" || !Array.isArray(ring.keys)) {
		throw new Error(`[watson-api] ${source} musí mít version=1, currentKid a keys[].`);
	}
	if (ring.keys.length < 1 || ring.keys.length > 5) {
		throw new Error(`[watson-api] ${source} musí obsahovat 1–5 klíčů pro řízený overlap.`);
	}
	const seen = new Set<string>();
	for (const key of ring.keys) {
		if (
			!key ||
			typeof key.kid !== "string" ||
			!key.kid ||
			!key.publicJwk ||
			key.publicJwk.kty !== "RSA" ||
			!key.publicJwk.n ||
			!key.publicJwk.e
		) {
			throw new Error(`[watson-api] ${source} obsahuje neplatný veřejný RSA klíč.`);
		}
		if (seen.has(key.kid)) throw new Error(`[watson-api] ${source} má duplicitní kid.`);
		seen.add(key.kid);
	}
	const current = ring.keys.find((key) => key.kid === ring.currentKid);
	if (!current?.privateJwk) {
		throw new Error(`[watson-api] ${source}: currentKid musí mít privateJwk.`);
	}
	if (
		current.privateJwk.kty !== "RSA" ||
		current.privateJwk.n !== current.publicJwk.n ||
		current.privateJwk.e !== current.publicJwk.e
	) {
		throw new Error(`[watson-api] ${source}: private/public část currentKid si neodpovídají.`);
	}
	return ring as StoredKeyRing;
}

async function generateStoredRing(): Promise<StoredKeyRing> {
	const { privateKey, publicKey } = await generateKeyPair(SIGNING_ALG, {
		extractable: true,
	});
	const privateJwk = await exportJWK(privateKey);
	const barePublic = await exportJWK(publicKey);
	const kid = keyId(barePublic);
	return {
		version: 1,
		currentKid: kid,
		keys: [
			{
				kid,
				createdAt: new Date().toISOString(),
				privateJwk,
				publicJwk: publicForJwks(barePublic, kid),
			},
		],
	};
}

async function migrateLegacyPowerSync(): Promise<StoredKeyRing | null> {
	if (!existsSync(legacyPowerSyncFile)) return null;
	chmodSync(legacyPowerSyncFile, 0o600);
	const legacy = JSON.parse(readFileSync(legacyPowerSyncFile, "utf8")) as {
		privateJwk?: JWK;
		publicJwk?: JWK;
	};
	if (!legacy.privateJwk || !legacy.publicJwk) {
		throw new Error("[watson-api] Starý PowerSync keyfile je poškozený.");
	}
	const kid = keyId(legacy.publicJwk);
	return {
		version: 1,
		currentKid: kid,
		keys: [
			{
				kid,
				createdAt: new Date(0).toISOString(),
				privateJwk: legacy.privateJwk,
				publicJwk: publicForJwks(legacy.publicJwk, kid),
			},
		],
	};
}

export async function loadSigningKeyRing(
	purpose: "powersync" | "luckyos",
): Promise<SigningKeyRing> {
	const envName =
		purpose === "powersync" ? "POWERSYNC_SIGNING_KEYS_JSON" : "LUCKYOS_SIGNING_KEYS_JSON";
	const file = fileURLToPath(new URL(`../.keys/${purpose}-keyring.json`, import.meta.url));
	let stored: StoredKeyRing;
	const fromEnv = process.env[envName];
	if (fromEnv) {
		stored = parseStoredRing(fromEnv, envName);
	} else {
		if (process.env.NODE_ENV === "production") {
			throw new Error(
				`[watson-api] ${envName} musí být v produkci nastaven; lokální generování by po restartu zneplatnilo tokeny.`,
			);
		}
		if (existsSync(file)) {
			chmodSync(file, 0o600);
			stored = parseStoredRing(readFileSync(file, "utf8"), file);
		} else {
			stored =
				purpose === "powersync" ? ((await migrateLegacyPowerSync()) ?? (await generateStoredRing())) : await generateStoredRing();
			if (!existsSync(keyDir)) mkdirSync(keyDir, { recursive: true, mode: 0o700 });
			writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
			console.log(`[watson-api] vytvořen oddělený ${purpose} signing keyring (.keys/)`);
		}
	}

	const current = stored.keys.find((key) => key.kid === stored.currentKid);
	if (!current?.privateJwk) throw new Error("current_signing_key_missing");
	const privateKey = await importJWK(current.privateJwk, SIGNING_ALG);
	return {
		purpose,
		currentKid: current.kid,
		privateKey,
		publicJwks: stored.keys.map((key) => publicForJwks(key.publicJwk, key.kid)),
	};
}

/** Používá se v contract testu rotace; validuje stejná pravidla jako produkční env. */
export async function loadSigningKeyRingFromJson(
	purpose: "powersync" | "luckyos",
	raw: string,
): Promise<SigningKeyRing> {
	const stored = parseStoredRing(raw, "test-keyring");
	const current = stored.keys.find((key) => key.kid === stored.currentKid);
	if (!current?.privateJwk) throw new Error("current_signing_key_missing");
	return {
		purpose,
		currentKid: current.kid,
		privateKey: await importJWK(current.privateJwk, SIGNING_ALG),
		publicJwks: stored.keys.map((key) => publicForJwks(key.publicJwk, key.kid)),
	};
}
