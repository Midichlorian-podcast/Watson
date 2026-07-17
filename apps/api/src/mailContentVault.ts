/**
 * F5 Mail M1 — authenticated encryption of synchronized message content.
 *
 * Uses the rotatable mail keyring but derives a separate cryptographic sub-key,
 * so a credential envelope can never be replayed as message content. AAD binds
 * every ciphertext to one owner account and one opaque provider message ID.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "./env";
import { parseMailVaultKeyring, type MailVaultEnvelope, type MailVaultKeyring } from "./mailVault";

const ALGORITHM = "aes-256-gcm-v1" as const;
const CIPHER = "aes-256-gcm";

export type MailContentContext = {
	accountId: string;
	providerMessageId: string;
	provider: "google";
};

function fail(code: string, cause?: unknown): never {
	throw new Error(code, cause === undefined ? undefined : { cause });
}

function contentKey(root: Buffer): Buffer {
	return createHmac("sha256", root).update("watson-mail-content-key-v1").digest();
}

function aad(context: MailContentContext): Buffer {
	return Buffer.from(
		[
			"watson-mail-content-v1",
			context.accountId,
			context.provider,
			context.providerMessageId,
		].join("\0"),
		"utf8",
	);
}

function assertContent(value: unknown): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fail("mail_content_payload_invalid");
	}
}

export function encryptMailContent(
	context: MailContentContext,
	content: Record<string, unknown>,
	keyring: MailVaultKeyring = parseMailVaultKeyring(env.mailVaultKeysJson),
): MailVaultEnvelope {
	assertContent(content);
	const root = keyring.keys.get(keyring.currentKid);
	if (!root) return fail("mail_content_current_key_missing");
	const key = contentKey(root);
	const nonce = randomBytes(12);
	const cipher = createCipheriv(CIPHER, key, nonce);
	cipher.setAAD(aad(context));
	const plaintext = Buffer.from(JSON.stringify(content), "utf8");
	try {
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		return {
			algorithm: ALGORITHM,
			keyId: keyring.currentKid,
			nonce: nonce.toString("base64url"),
			authTag: cipher.getAuthTag().toString("base64url"),
			ciphertext: ciphertext.toString("base64url"),
		};
	} finally {
		plaintext.fill(0);
		key.fill(0);
	}
}

export function decryptMailContent<T extends Record<string, unknown>>(
	context: MailContentContext,
	envelope: MailVaultEnvelope,
	keyring: MailVaultKeyring = parseMailVaultKeyring(env.mailVaultKeysJson),
): T {
	if (envelope.algorithm !== ALGORITHM) return fail("mail_content_algorithm_unsupported");
	const root = keyring.keys.get(envelope.keyId);
	if (!root) return fail("mail_content_key_unavailable");
	const key = contentKey(root);
	try {
		const nonce = Buffer.from(envelope.nonce, "base64url");
		const tag = Buffer.from(envelope.authTag, "base64url");
		const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
		if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
			return fail("mail_content_envelope_invalid");
		}
		const decipher = createDecipheriv(CIPHER, key, nonce);
		decipher.setAAD(aad(context));
		decipher.setAuthTag(tag);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		try {
			const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
			assertContent(parsed);
			return parsed as T;
		} finally {
			plaintext.fill(0);
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("mail_content_")) throw error;
		return fail("mail_content_decryption_failed", error);
	} finally {
		key.fill(0);
	}
}
