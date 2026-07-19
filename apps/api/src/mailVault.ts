/**
 * F5 Mail M1 — server-only rotovatelný credential vault.
 *
 * Envelope používá AES-256-GCM, náhodný 96bit nonce a AAD připnuté ke konkrétnímu
 * account/owner/provider/kind. Přesunutí ciphertextu k jinému účtu proto selže.
 * Žádná chyba ani návratová hodnota neobsahuje klíč nebo plaintext credentialů.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm-v1" as const;
const CIPHER = "aes-256-gcm";
const KID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export type MailSecretKind = "google_oauth" | "imap_smtp";

export type MailVaultContext = {
	accountId: string;
	ownerUserId: string;
	provider: "google" | "imap_smtp";
	secretKind: MailSecretKind;
};

export type MailVaultEnvelope = {
	algorithm: typeof ALGORITHM;
	keyId: string;
	nonce: string;
	authTag: string;
	ciphertext: string;
};

export type MailVaultKeyring = {
	currentKid: string;
	keys: ReadonlyMap<string, Buffer>;
};

function fail(code: string, cause?: unknown): never {
	throw new Error(code, cause === undefined ? undefined : { cause });
}

function decodeKey(value: unknown): Buffer {
	if (typeof value !== "string" || value.length < 43 || value.length > 64) {
		return fail("mail_vault_key_invalid");
	}
	try {
		const decoded = Buffer.from(value, "base64url");
		if (decoded.length !== 32) return fail("mail_vault_key_invalid");
		return decoded;
	} catch (error) {
		return fail("mail_vault_key_invalid", error);
	}
}

/** Parse keyringu je striktní; tiché fallback klíče by znečitelnily rotaci i recovery. */
export function parseMailVaultKeyring(raw: string | undefined): MailVaultKeyring {
	if (!raw) return fail("mail_vault_not_configured");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		return fail("mail_vault_keyring_invalid", error);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fail("mail_vault_keyring_invalid");
	}
	const object = value as Record<string, unknown>;
	if (object.version !== 1 || typeof object.currentKid !== "string") {
		return fail("mail_vault_keyring_invalid");
	}
	if (!KID_PATTERN.test(object.currentKid)) return fail("mail_vault_keyring_invalid");
	if (!object.keys || typeof object.keys !== "object" || Array.isArray(object.keys)) {
		return fail("mail_vault_keyring_invalid");
	}
	const entries = Object.entries(object.keys as Record<string, unknown>);
	if (entries.length < 1 || entries.length > 8) return fail("mail_vault_keyring_invalid");
	const keys = new Map<string, Buffer>();
	for (const [kid, encoded] of entries) {
		if (!KID_PATTERN.test(kid)) return fail("mail_vault_keyring_invalid");
		keys.set(kid, decodeKey(encoded));
	}
	if (!keys.has(object.currentKid)) return fail("mail_vault_current_key_missing");
	return { currentKid: object.currentKid, keys };
}

function aad(context: MailVaultContext): Buffer {
	return Buffer.from(
		["watson-mail-v1", context.accountId, context.ownerUserId, context.provider, context.secretKind].join(
			"\0",
		),
		"utf8",
	);
}

function assertSecret(value: unknown): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fail("mail_vault_payload_invalid");
	}
}

export function encryptMailSecret(
	context: MailVaultContext,
	secret: Record<string, unknown>,
	keyring = parseMailVaultKeyring(env.mailVaultKeysJson),
): MailVaultEnvelope {
	assertSecret(secret);
	const key = keyring.keys.get(keyring.currentKid);
	if (!key) return fail("mail_vault_current_key_missing");
	const nonce = randomBytes(12);
	const cipher = createCipheriv(CIPHER, key, nonce);
	cipher.setAAD(aad(context));
	const plaintext = Buffer.from(JSON.stringify(secret), "utf8");
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const authTag = cipher.getAuthTag();
	plaintext.fill(0);
	return {
		algorithm: ALGORITHM,
		keyId: keyring.currentKid,
		nonce: nonce.toString("base64url"),
		authTag: authTag.toString("base64url"),
		ciphertext: ciphertext.toString("base64url"),
	};
}

export function decryptMailSecret<T extends Record<string, unknown>>(
	context: MailVaultContext,
	envelope: MailVaultEnvelope,
	keyring = parseMailVaultKeyring(env.mailVaultKeysJson),
): T {
	if (envelope.algorithm !== ALGORITHM) return fail("mail_vault_algorithm_unsupported");
	const key = keyring.keys.get(envelope.keyId);
	if (!key) return fail("mail_vault_key_unavailable");
	try {
		const nonce = Buffer.from(envelope.nonce, "base64url");
		const tag = Buffer.from(envelope.authTag, "base64url");
		const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
		if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
			return fail("mail_vault_envelope_invalid");
		}
		const decipher = createDecipheriv(CIPHER, key, nonce);
		decipher.setAAD(aad(context));
		decipher.setAuthTag(tag);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		let parsed: unknown;
		try {
			parsed = JSON.parse(plaintext.toString("utf8"));
		} finally {
			plaintext.fill(0);
		}
		assertSecret(parsed);
		return parsed as T;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("mail_vault_")) throw error;
		return fail("mail_vault_decryption_failed", error);
	}
}

export function mailVaultConfigured(): boolean {
	try {
		parseMailVaultKeyring(env.mailVaultKeysJson);
		return true;
	} catch {
		return false;
	}
}

