/** General mail adapter proof: strict inputs, SSRF guard, dual verification and vault isolation. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
	imapSmtpCredentialSchema,
	privateMailAddress,
	resolvePublicEndpoint,
	verifyImapSmtpCredential,
	type VerifyImapSmtpDependencies,
} from "./src/mailImapSmtp";
import { decryptMailContent, encryptMailContent } from "./src/mailContentVault";
import { decryptMailSecret, encryptMailSecret, parseMailVaultKeyring } from "./src/mailVault";

const credential = imapSmtpCredentialSchema.parse({
	purpose: "imap_smtp_mailbox",
	emailAddress: "owner@example.test",
	username: "owner@example.test",
	password: `app-${randomUUID()}`,
	imap: { host: "imap.example.test", port: 993, security: "tls" },
	smtp: { host: "smtp.example.test", port: 587, security: "starttls" },
});

assert.equal(imapSmtpCredentialSchema.safeParse({ ...credential, accessToken: "unexpected" }).success, false);
assert.equal(imapSmtpCredentialSchema.safeParse({ ...credential, smtp: { ...credential.smtp, port: 0 } }).success, false);

for (const address of [
	"127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.169.254", "172.31.1.1", "192.168.1.1",
	"198.18.0.1", "203.0.113.4", "::", "::1", "::ffff:7f00:1", "fc00::1", "fe80::1", "2001:db8::1",
]) assert.equal(privateMailAddress(address), true, `${address} must stay blocked`);
for (const address of ["8.8.8.8", "1.1.1.1", "203.1.1.1", "2606:4700:4700::1111"]) {
	assert.equal(privateMailAddress(address), false, `${address} must remain public`);
}
await assert.rejects(resolvePublicEndpoint("127.0.0.1"), /mail_endpoint_private/);

const trace: string[] = [];
const dependencies = {
	resolveEndpoint: async (host: string) => {
		trace.push(`resolve:${host}`);
		return host.startsWith("imap") ? "203.1.1.10" : "203.1.1.11";
	},
	createImap: (_value: unknown, host: string) => ({
		connect: async () => { trace.push(`imap-connect:${host}`); },
		getMailboxLock: async (mailbox: string) => ({ release: () => { trace.push(`imap-release:${mailbox}`); } }),
		logout: async () => { trace.push("imap-logout"); },
		close: () => { trace.push("imap-close"); },
	}),
	createSmtp: (_value: unknown, host: string) => ({
		verify: async () => { trace.push(`smtp-verify:${host}`); return true; },
		close: () => { trace.push("smtp-close"); },
	}),
} as unknown as VerifyImapSmtpDependencies;
await verifyImapSmtpCredential(credential, dependencies);
assert.deepEqual(trace, [
	"resolve:imap.example.test", "resolve:smtp.example.test", "imap-connect:203.1.1.10",
	"imap-release:INBOX", "imap-logout", "smtp-verify:203.1.1.11", "smtp-close",
]);

let smtpCreated = false;
await assert.rejects(verifyImapSmtpCredential(credential, {
	...dependencies,
	createImap: () => ({
		connect: async () => { throw new Error("authentication failed"); },
		getMailboxLock: async () => ({ release: () => undefined }),
		logout: async () => undefined,
		close: () => undefined,
	}) as never,
	createSmtp: () => { smtpCreated = true; return dependencies.createSmtp(credential, "203.1.1.11"); },
}), /authentication failed/);
assert.equal(smtpCreated, false, "SMTP must not be accepted after failed IMAP verification");

const accountId = randomUUID();
const ownerUserId = randomUUID();
const keyring = parseMailVaultKeyring(JSON.stringify({
	version: 1,
	currentKid: "imap-test",
	keys: { "imap-test": randomBytes(32).toString("base64url") },
}));
const secretContext = { accountId, ownerUserId, provider: "imap_smtp" as const, secretKind: "imap_smtp" as const };
const encryptedSecret = encryptMailSecret(secretContext, credential, keyring);
assert.equal(JSON.stringify(encryptedSecret).includes(credential.password), false);
assert.deepEqual(decryptMailSecret(secretContext, encryptedSecret, keyring), credential);

const content = { subject: "Provider-bound", textBody: "Only the matching adapter can open this." };
const contentEnvelope = encryptMailContent({ accountId, provider: "imap_smtp", providerMessageId: "imap-1-1" }, content, keyring);
assert.deepEqual(decryptMailContent({ accountId, provider: "imap_smtp", providerMessageId: "imap-1-1" }, contentEnvelope, keyring), content);
assert.throws(
	() => decryptMailContent({ accountId, provider: "google", providerMessageId: "imap-1-1" }, contentEnvelope, keyring),
	/mail_content_decryption_failed/,
);

console.log("IMAP/SMTP mail adapter: strict input, SSRF guard, dual verification and provider-bound vault passed.");
process.exit(0);
