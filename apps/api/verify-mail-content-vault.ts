import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { decryptMailContent, encryptMailContent } from "./src/mailContentVault";
import { parseMailVaultKeyring } from "./src/mailVault";

const keyring = parseMailVaultKeyring(
	JSON.stringify({
		version: 1,
		currentKid: "mail-content-test",
		keys: { "mail-content-test": randomBytes(32).toString("base64url") },
	}),
);
const context = {
	accountId: randomUUID(),
	provider: "google" as const,
	providerMessageId: "msg-content-001",
};
const content = {
	subject: "Citlivý předmět",
	from: "sender@example.test",
	textBody: "Tělo zprávy, které nesmí být v databázi čitelné.",
};

const envelope = encryptMailContent(context, content, keyring);
assert.equal(envelope.algorithm, "aes-256-gcm-v1");
assert.equal(JSON.stringify(envelope).includes(content.subject), false);
assert.deepEqual(decryptMailContent(context, envelope, keyring), content);
console.log("  ✓ obsah zprávy je roundtrip a envelope neobsahuje plaintext");

assert.throws(
	() =>
		decryptMailContent(
			{ ...context, providerMessageId: "msg-content-002" },
			envelope,
			keyring,
		),
	/mail_content_decryption_failed/,
);
console.log("  ✓ AAD nedovolí přesun ciphertextu k jiné zprávě");

const bytes = Buffer.from(envelope.ciphertext, "base64url");
bytes[0] = (bytes[0] ?? 0) ^ 1;
assert.throws(
	() =>
		decryptMailContent(
			context,
			{ ...envelope, ciphertext: bytes.toString("base64url") },
			keyring,
		),
	/mail_content_decryption_failed/,
);
console.log("  ✓ změna skutečného ciphertext bajtu fail-closed selže");

console.log("\nMail content vault: všechny kontroly prošly");
