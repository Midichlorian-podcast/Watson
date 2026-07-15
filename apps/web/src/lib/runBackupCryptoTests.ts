import {
	decryptServerBackup,
	encryptServerBackup,
	type ServerBackup,
} from "./backup";

const backup: ServerBackup = {
	manifest: {
		format: "watson-export",
		version: 2,
		exportedAt: "2026-07-15T00:00:00.000Z",
		schemaMigrations: 38,
		scope: { workspaces: 1, userId: "00000000-0000-4000-8000-000000000001" },
		counts: { tasks: 1 },
		checksum: "checksum",
		signature: "signature",
	},
	tables: { tasks: [{ id: "secret-task", name: "Citlivý obsah" }] },
};

const passphrase = "correct horse battery staple";
const first = await encryptServerBackup(backup, passphrase);
const second = await encryptServerBackup(backup, passphrase);
if (first.ciphertext.includes("Citlivý obsah") || JSON.stringify(first).includes("secret-task")) {
	throw new Error("FAIL: ciphertext prozrazuje plaintext");
}
if (first.kdf.salt === second.kdf.salt || first.cipher.iv === second.cipher.iv) {
	throw new Error("FAIL: dva exporty znovu použily salt nebo IV");
}
const restored = (await decryptServerBackup(first, passphrase)) as ServerBackup;
if (restored.tables.tasks?.[0]?.name !== "Citlivý obsah") {
	throw new Error("FAIL: roundtrip změnil obsah");
}
let wrongPasswordRejected = false;
try {
	await decryptServerBackup(first, "wrong password value");
} catch {
	wrongPasswordRejected = true;
}
if (!wrongPasswordRejected) throw new Error("FAIL: chybné heslo nebylo odmítnuto");

console.log("Backup crypto: AES-GCM roundtrip, random salt/IV a wrong-password rejection prošly.");
process.exit(0);
