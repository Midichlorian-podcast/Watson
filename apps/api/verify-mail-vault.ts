import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
	decryptMailSecret,
	encryptMailSecret,
	parseMailVaultKeyring,
	type MailVaultContext,
} from "./src/mailVault";

const oldKey = randomBytes(32).toString("base64url");
const currentKey = randomBytes(32).toString("base64url");
const keyring = parseMailVaultKeyring(
	JSON.stringify({
		version: 1,
		currentKid: "mail-2026-07",
		keys: { "mail-2026-06": oldKey, "mail-2026-07": currentKey },
	}),
);
const context: MailVaultContext = {
	accountId: randomUUID(),
	ownerUserId: randomUUID(),
	provider: "google",
	secretKind: "google_oauth",
};
const secret = {
	accessToken: "access-token-must-never-appear-in-db",
	refreshToken: "refresh-token-must-never-appear-in-db",
	expiresAt: "2026-07-17T12:00:00.000Z",
};

const first = encryptMailSecret(context, secret, keyring);
const second = encryptMailSecret(context, secret, keyring);
assert.equal(first.algorithm, "aes-256-gcm-v1");
assert.equal(first.keyId, "mail-2026-07");
assert.notEqual(first.nonce, second.nonce);
assert.notEqual(first.ciphertext, second.ciphertext);
assert.equal(JSON.stringify(first).includes(secret.accessToken), false);
assert.deepEqual(decryptMailSecret(context, first, keyring), secret);
console.log("  ✓ credential je autentizovaně šifrovaný a každý zápis má nový nonce");

assert.throws(
	() => decryptMailSecret({ ...context, accountId: randomUUID() }, first, keyring),
	/mail_vault_decryption_failed/,
);
console.log("  ✓ ciphertext nelze přesunout k jinému mailbox účtu (AAD)");

const changedBytes = Buffer.from(first.ciphertext, "base64url");
changedBytes[0] = (changedBytes[0] ?? 0) ^ 1;
const changed = changedBytes.toString("base64url");
assert.throws(
	() => decryptMailSecret(context, { ...first, ciphertext: changed }, keyring),
	/mail_vault_decryption_failed/,
);
console.log("  ✓ poškozený ciphertext fail-closed neprojde");

const oldRing = parseMailVaultKeyring(
	JSON.stringify({ version: 1, currentKid: "mail-2026-06", keys: { "mail-2026-06": oldKey } }),
);
const oldEnvelope = encryptMailSecret(context, secret, oldRing);
assert.deepEqual(decryptMailSecret(context, oldEnvelope, keyring), secret);
console.log("  ✓ overlap keyring přečte starý envelope po rotaci");

const retiredRing = parseMailVaultKeyring(
	JSON.stringify({ version: 1, currentKid: "mail-2026-07", keys: { "mail-2026-07": currentKey } }),
);
assert.throws(() => decryptMailSecret(context, oldEnvelope, retiredRing), /mail_vault_key_unavailable/);
console.log("  ✓ po vědomém vyřazení starého klíče se starý envelope neotevře");

for (const invalid of [
	undefined,
	"{broken",
	JSON.stringify({ version: 1, currentKid: "missing", keys: { current: currentKey } }),
	JSON.stringify({ version: 1, currentKid: "current", keys: { current: "too-short" } }),
]) {
	assert.throws(() => parseMailVaultKeyring(invalid));
}
console.log("  ✓ neúplný nebo slabý keyring je odmítnut bez fallback klíče");

console.log("\nMail credential vault: všechny kontroly prošly");
