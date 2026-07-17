/** F5 Mail M1: DB proof for personal tenant scope and encrypted credential envelopes. */
import "./src/env";
import {
	eq,
	getDb,
	mailAccountCredentials,
	mailAccounts,
	mailMessages,
	mailSyncStates,
	users,
	workspaces,
} from "@watson/db";
import { randomBytes, randomUUID } from "node:crypto";
import { encryptMailSecret, parseMailVaultKeyring } from "./src/mailVault";

const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

function sqlState(error: unknown) {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const candidate = current as { code?: unknown; cause?: unknown };
		if (typeof candidate.code === "string") return candidate.code;
		current = candidate.cause;
	}
	return null;
}

async function rejected(label: string, operation: () => Promise<unknown>, code = "23514") {
	try {
		await operation();
		check(label, false, "operation unexpectedly succeeded");
	} catch (error) {
		check(label, sqlState(error) === code, { code: sqlState(error) });
	}
}

async function main() {
	const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
	const [owner, stranger] = await db
		.insert(users)
		.values([
			{
				name: "Mail owner",
				email: `mail-owner-${stamp}@watson.test`,
				emailVerified: true,
			},
			{
				name: "Mail stranger",
				email: `mail-stranger-${stamp}@watson.test`,
				emailVerified: true,
			},
		])
		.returning({ id: users.id });
	if (!owner || !stranger) throw new Error("mail foundation users missing");
	const [personal, foreign] = await db
		.insert(workspaces)
		.values([
			{ name: `Mail personal ${stamp}`, ownerId: owner.id, isPersonal: true },
			{ name: `Mail foreign ${stamp}`, ownerId: stranger.id, isPersonal: true },
		])
		.returning({ id: workspaces.id });
	if (!personal || !foreign) throw new Error("mail foundation workspaces missing");

	try {
		await rejected("DB odmítne osobní mailbox v cizím workspace", () =>
			db.insert(mailAccounts).values({
				workspaceId: foreign.id,
				ownerUserId: owner.id,
				provider: "google",
				emailAddress: `cross-${stamp}@gmail.test`,
				providerAccountHash: "a".repeat(64),
			}),
		);

		await rejected("DB odmítne neallowlistovaný bezpečnostní error kód", () =>
			db.insert(mailAccounts).values({
				workspaceId: personal.id,
				ownerUserId: owner.id,
				provider: "google",
				emailAddress: `unsafe-${stamp}@gmail.test`,
				providerAccountHash: "b".repeat(64),
				lastErrorCode: "upstream said token=plaintext",
			}),
		);

		const accountId = randomUUID();
		const context = {
			accountId,
			ownerUserId: owner.id,
			provider: "google" as const,
			secretKind: "google_oauth" as const,
		};
		const keyring = parseMailVaultKeyring(
			JSON.stringify({
				version: 1,
				currentKid: "mail-foundation",
				keys: { "mail-foundation": randomBytes(32).toString("base64url") },
			}),
		);
		const plaintextToken = `refresh-${randomUUID()}-must-not-appear`;
		const envelope = encryptMailSecret(context, { refreshToken: plaintextToken }, keyring);
		await db.transaction(async (tx) => {
			await tx.insert(mailAccounts).values({
				id: accountId,
				workspaceId: personal.id,
				ownerUserId: owner.id,
				provider: "google",
				emailAddress: `owner-${stamp}@gmail.test`,
				providerAccountHash: "c".repeat(64),
				grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
				capabilities: ["read", "send"],
			});
			await tx.insert(mailAccountCredentials).values({
				accountId,
				secretKind: "google_oauth",
				...envelope,
			});
		});
		check("mailbox metadata a credential vzniknou společně", true);

		const [stored] = await db
			.select()
			.from(mailAccountCredentials)
			.where(eq(mailAccountCredentials.accountId, accountId));
		const serialized = JSON.stringify(stored);
		check(
			"uložený credential envelope neobsahuje plaintext token",
			Boolean(stored) && !serialized.includes(plaintextToken) && stored?.algorithm === "aes-256-gcm-v1",
			stored && { algorithm: stored.algorithm, keyId: stored.keyId },
		);

		await rejected("DB odmítne IMAP credential u Google účtu", () =>
			db
				.update(mailAccountCredentials)
				.set({ secretKind: "imap_smtp" })
				.where(eq(mailAccountCredentials.accountId, accountId)),
		);

		await rejected("partial sync bez history cursoru v DB nevznikne", () =>
			db.insert(mailSyncStates).values({
				accountId,
				status: "idle",
				syncMode: "partial",
			}),
		);
		await rejected("running sync bez úplného lease v DB nevznikne", () =>
			db.insert(mailSyncStates).values({
				accountId,
				status: "running",
				syncMode: "full",
			}),
		);
		const generation = randomUUID();
		await db.insert(mailSyncStates).values({
			accountId,
			status: "idle",
			syncMode: "full",
			fullSyncGeneration: generation,
		});
		await rejected("DB odmítne neplatné opaque provider message ID", () =>
			db.insert(mailMessages).values({
				accountId,
				providerMessageId: "provider id with spaces",
				providerThreadId: "thread-1",
				historyId: "1001",
				internalDate: new Date(),
				keyId: "mail-foundation",
				nonce: "A".repeat(16),
				authTag: "B".repeat(22),
				ciphertext: "C",
				lastSeenSyncGeneration: generation,
			}),
		);
		await db.insert(mailMessages).values({
			accountId,
			providerMessageId: "message-1",
			providerThreadId: "thread-1",
			historyId: "1001",
			internalDate: new Date(),
			keyId: "mail-foundation",
			nonce: "A".repeat(16),
			authTag: "B".repeat(22),
			ciphertext: "C",
			lastSeenSyncGeneration: generation,
		});

		await db.delete(mailAccounts).where(eq(mailAccounts.id, accountId));
		const [credentialsAfterDelete, syncAfterDelete, messagesAfterDelete] = await Promise.all([
			db
				.select({ accountId: mailAccountCredentials.accountId })
				.from(mailAccountCredentials)
				.where(eq(mailAccountCredentials.accountId, accountId)),
			db.select().from(mailSyncStates).where(eq(mailSyncStates.accountId, accountId)),
			db.select().from(mailMessages).where(eq(mailMessages.accountId, accountId)),
		]);
		check(
			"smazání mailboxu fyzicky odstraní credential, cursor i obsah",
			credentialsAfterDelete.length === 0 && syncAfterDelete.length === 0 && messagesAfterDelete.length === 0,
		);
	} finally {
		await db.delete(users).where(eq(users.id, owner.id));
		await db.delete(users).where(eq(users.id, stranger.id));
	}

	if (failed) throw new Error(`mail foundation failed: ${failed}`);
	console.log("\nMail M1 foundation: všechny kontroly prošly");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
