#!/usr/bin/env node
import {
	createCipheriv,
	createDecipheriv,
	pbkdf2Sync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAGIC = Buffer.from("WATSONDB1\0", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PBKDF2_ITERATIONS = 310_000;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

function key(passphrase, salt) {
	return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

async function encrypt(input, output, passphrase) {
	const salt = randomBytes(SALT_BYTES);
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
	const destination = createWriteStream(output, { mode: 0o600 });
	destination.write(Buffer.concat([MAGIC, salt, iv]));
	await new Promise((resolve, reject) => {
		const source = createReadStream(input);
		const fail = (error) => reject(error);
		source.once("error", fail);
		cipher.once("error", fail);
		destination.once("error", fail);
		destination.once("finish", resolve);
		cipher.pipe(destination, { end: false });
		cipher.once("end", () => destination.end(cipher.getAuthTag()));
		source.pipe(cipher);
	});
}

async function decrypt(input, output, passphrase) {
	const size = statSync(input).size;
	if (size <= HEADER_BYTES + TAG_BYTES) throw new Error("encrypted backup is truncated");
	const header = Buffer.alloc(HEADER_BYTES);
	const authTag = Buffer.alloc(TAG_BYTES);
	const descriptor = openSync(input, "r");
	try {
		if (readSync(descriptor, header, 0, header.length, 0) !== header.length) {
			throw new Error("encrypted backup header is truncated");
		}
		if (readSync(descriptor, authTag, 0, authTag.length, size - TAG_BYTES) !== authTag.length) {
			throw new Error("encrypted backup authentication tag is truncated");
		}
	} finally {
		closeSync(descriptor);
	}
	const magic = header.subarray(0, MAGIC.length);
	if (magic.length !== MAGIC.length || !timingSafeEqual(magic, MAGIC)) {
		throw new Error("unsupported encrypted backup format");
	}
	const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
	const iv = header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
	const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
	decipher.setAuthTag(authTag);
	const destination = createWriteStream(output, { mode: 0o600 });
	await new Promise((resolve, reject) => {
		const source = createReadStream(input, {
			start: HEADER_BYTES,
			end: size - TAG_BYTES - 1,
		});
		const fail = (error) => reject(error);
		source.once("error", fail);
		decipher.once("error", fail);
		destination.once("error", fail);
		destination.once("finish", resolve);
		source.pipe(decipher).pipe(destination);
	});
}

async function selfTest() {
	const dir = mkdtempSync(join(tmpdir(), "watson-backup-crypto-"));
	try {
		const source = join(dir, "source");
		const encrypted = join(dir, "encrypted");
		const restored = join(dir, "restored");
		const tampered = join(dir, "tampered");
		const bytes = randomBytes(128 * 1024 + 17);
		writeFileSync(source, bytes, { mode: 0o600 });
		await encrypt(source, encrypted, "self-test-passphrase");
		await decrypt(encrypted, restored, "self-test-passphrase");
		if (!timingSafeEqual(bytes, readFileSync(restored))) throw new Error("round-trip mismatch");
		const changed = readFileSync(encrypted);
		changed[Math.floor(changed.length / 2)] ^= 1;
		writeFileSync(tampered, changed, { mode: 0o600 });
		let rejected = false;
		try {
			await decrypt(tampered, join(dir, "must-not-restore"), "self-test-passphrase");
		} catch {
			rejected = true;
		}
		if (!rejected) throw new Error("tampered ciphertext was accepted");
		console.log("AES-256-GCM backup crypto self-test passed.");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const [mode, input, output] = process.argv.slice(2);
if (mode === "self-test") {
	await selfTest();
} else {
	const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;
	if (!passphrase || passphrase.length < 20) {
		throw new Error("BACKUP_ENCRYPTION_PASSPHRASE must contain at least 20 characters");
	}
	if (!input || !output || (mode !== "encrypt" && mode !== "decrypt")) {
		throw new Error("Usage: crypto.mjs encrypt|decrypt INPUT OUTPUT");
	}
	try {
		if (mode === "encrypt") await encrypt(input, output, passphrase);
		else await decrypt(input, output, passphrase);
	} catch (error) {
		rmSync(output, { force: true });
		throw error;
	}
}
