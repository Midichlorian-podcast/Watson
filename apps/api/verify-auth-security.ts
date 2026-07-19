/** Invite-only auth, magic-link signup closure, TOTP enrollment and privileged 2FA gate. */
import "./src/env";
import { createHmac } from "node:crypto";
import { getDb, sql } from "@watson/db";

const API = process.env.AUTH_API ?? "http://127.0.0.1:8787";
const ORIGIN = "http://localhost:5173";
const db = getDb();
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`✓ ${label}`);
	else {
		failed++;
		console.error(`✗ ${label}: ${JSON.stringify(detail)}`);
	}
}

async function latestMagicToken() {
	return (
		(await db.execute(
			sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
		)) as { identifier: string }[]
	)[0]?.identifier;
}

async function login(email: string) {
	const sent = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN },
		body: JSON.stringify({ email, callbackURL: `${ORIGIN}/` }),
	});
	if (!sent.ok) throw new Error(`magic-link ${sent.status}`);
	const token = await latestMagicToken();
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const cookie = (verified.headers.getSetCookie?.() ?? [])
		.map((value) => value.split(";")[0])
		.join("; ");
	if (!cookie) throw new Error(`login cookie missing (${verified.status})`);
	return cookie;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(value: string) {
	let bits = "";
	for (const char of value.replace(/=+$/g, "").toUpperCase()) {
		const index = BASE32.indexOf(char);
		if (index < 0) throw new Error("invalid base32");
		bits += index.toString(2).padStart(5, "0");
	}
	const bytes: number[] = [];
	for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
		bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
	}
	return Buffer.from(bytes);
}

function totp(secret: string) {
	const counter = Math.floor(Date.now() / 30_000);
	const input = Buffer.alloc(8);
	input.writeBigUInt64BE(BigInt(counter));
	const digest = createHmac("sha1", decodeBase32(secret)).update(input).digest();
	const offset = (digest.at(-1) ?? 0) & 0x0f;
	const binary =
		(((digest[offset] ?? 0) & 0x7f) << 24) |
		(((digest[offset + 1] ?? 0) & 0xff) << 16) |
		(((digest[offset + 2] ?? 0) & 0xff) << 8) |
		((digest[offset + 3] ?? 0) & 0xff);
	return String(binary % 1_000_000).padStart(6, "0");
}

async function main() {
	const health = (await (await fetch(`${API}/health`)).json()) as {
		auth?: { signup?: string; twoFactor?: { privilegedWritesRequired?: boolean } };
	};
	check("health pravdivě hlásí invite-only", health.auth?.signup === "invite-only", health.auth);
	check(
		"health hlásí vynucení 2FA pro privilegované zápisy",
		health.auth?.twoFactor?.privilegedWritesRequired === true,
		health.auth,
	);

	const publicEmail = `public-signup-${Date.now()}@watson.test`;
	const signup = await fetch(`${API}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN },
		body: JSON.stringify({ email: publicEmail, password: "A-very-long-password-123!", name: "Public" }),
	});
	const publicCount = Number(
		((await db.execute(sql`SELECT count(*)::int AS n FROM users WHERE email = ${publicEmail}`)) as { n: number }[])[0]?.n,
	);
	check("password signup je serverově zakázaný", signup.status >= 400 && publicCount === 0, signup.status);

	const magicNewEmail = `magic-signup-${Date.now()}@watson.test`;
	const magicSent = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN },
		body: JSON.stringify({ email: magicNewEmail, callbackURL: `${ORIGIN}/` }),
	});
	const magicToken = await latestMagicToken();
	const magicVerify = await fetch(
		`${API}/api/auth/magic-link/verify?token=${magicToken}&callbackURL=${encodeURIComponent(`${ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const magicNewCount = Number(
		((await db.execute(sql`SELECT count(*)::int AS n FROM users WHERE email = ${magicNewEmail}`)) as { n: number }[])[0]?.n,
	);
	const magicLocation = magicVerify.headers.get("location") ?? "";
	check(
		"magic-link nesmí obejít invite-only registraci",
		magicSent.ok &&
			magicVerify.status === 302 &&
			/(error|signup|user)/i.test(magicLocation) &&
			magicNewCount === 0,
		{ sent: magicSent.status, verify: magicVerify.status, location: magicLocation, users: magicNewCount },
	);

	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const email = `auth-security-${suffix}@watson.test`;
	const invitedEmail = `invited-${suffix}@watson.test`;
	await db.execute(sql`
		INSERT INTO users (id, name, email, email_verified)
		VALUES (${userId}, 'Auth Security Test', ${email}, true)
	`);
	await db.execute(sql`
		INSERT INTO workspaces (id, name, is_personal, owner_id)
		VALUES (${workspaceId}, 'Auth Security Test', true, ${userId})
	`);
	await db.execute(sql`
		INSERT INTO memberships (user_id, workspace_id, role)
		VALUES (${userId}, ${workspaceId}, 'admin')
	`);
	try {
		let cookie = await login(email);
		let mutation = await fetch(`${API}/api/projects`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: "{}",
		});
		check("privilegovaný zápis bez 2FA je blokován", mutation.status === 403, mutation.status);
		check(
			"blokace vrací konkrétní enrollment code",
			((await mutation.json()) as { error?: string }).error === "two_factor_enrollment_required",
		);

		const enabled = await fetch(`${API}/api/auth/two-factor/enable`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: JSON.stringify({ issuer: "Watson" }),
		});
		const setup = (await enabled.json()) as { totpURI?: string; backupCodes?: string[] };
		check("passwordless magic-link účet může zahájit TOTP setup", enabled.ok && !!setup.totpURI, setup);
		check("setup vydá jednorázové recovery kódy", (setup.backupCodes?.length ?? 0) >= 5);
		if (!setup.totpURI) throw new Error("TOTP URI missing");
		const secret = new URL(setup.totpURI).searchParams.get("secret");
		if (!secret) throw new Error("TOTP secret missing");
		const verified = await fetch(`${API}/api/auth/two-factor/verify-totp`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: JSON.stringify({ code: totp(secret), trustDevice: true }),
		});
		const replacementCookies = (verified.headers.getSetCookie?.() ?? [])
			.map((value) => value.split(";")[0])
			.join("; ");
		if (replacementCookies) cookie = replacementCookies;
		check("platný TOTP setup dokončí", verified.ok, await verified.text());
		const securityRow = (
			(await db.execute(sql`
				SELECT u.two_factor_enabled, tf.verified, tf.backup_codes
				FROM users u LEFT JOIN two_factors tf ON tf.user_id = u.id
				WHERE u.id = ${userId}
			`)) as { two_factor_enabled: boolean; verified: boolean; backup_codes: string }[]
		)[0];
		check("DB potvrzuje enabled + verified", !!securityRow?.two_factor_enabled && !!securityRow.verified, securityRow);
		check(
			"recovery kódy nejsou uloženy čitelně",
			!!setup.backupCodes?.[0] && !securityRow?.backup_codes?.includes(setup.backupCodes[0]),
		);

		const rotated = await fetch(`${API}/api/auth/two-factor/generate-backup-codes`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: "{}",
		});
		const rotatedBody = (await rotated.json()) as { status?: boolean; backupCodes?: string[] };
		const rotatedSecurity = (
			(await db.execute(sql`SELECT backup_codes FROM two_factors WHERE user_id = ${userId}`)) as {
				backup_codes: string;
			}[]
		)[0];
		check(
			"uživatel může bezpečně otočit ztracené recovery kódy",
			rotated.ok && rotatedBody.status === true && (rotatedBody.backupCodes?.length ?? 0) >= 5,
			{ status: rotated.status, count: rotatedBody.backupCodes?.length },
		);
		check(
			"nová sada recovery kódů je v DB opět jen šifrovaná",
			!!rotatedBody.backupCodes?.[0] &&
				!rotatedSecurity?.backup_codes?.includes(rotatedBody.backupCodes[0]),
		);

		mutation = await fetch(`${API}/api/projects`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: "{}",
		});
		check(
			"po 2FA middleware zápis propustí k runtime validaci",
			mutation.status === 422,
			mutation.status,
		);

		const invite = await fetch(`${API}/api/workspaces/${workspaceId}/invite`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: JSON.stringify({ email: invitedEmail, name: "Invited User", role: "member" }),
		});
		const inviteBody = (await invite.json()) as { invited?: boolean; invitationId?: string };
		check(
			"adminská pozvánka nového účtu se trvale uloží a odešle",
			invite.ok && inviteBody.invited === true && !!inviteBody.invitationId,
			{ status: invite.status, body: inviteBody },
		);
		const inviteToken = await latestMagicToken();
		const accepted = await fetch(
			`${API}/api/auth/magic-link/verify?token=${inviteToken}&callbackURL=${encodeURIComponent(`${ORIGIN}/`)}`,
			{ redirect: "manual" },
		);
		const invitedRows = (await db.execute(sql`
			SELECT u.id,
			       EXISTS(SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.workspace_id = ${workspaceId} AND m.role = 'member') AS joined,
			       EXISTS(SELECT 1 FROM workspaces w WHERE w.owner_id = u.id AND w.is_personal) AS personal,
			       EXISTS(SELECT 1 FROM workspace_invitations i WHERE i.accepted_by = u.id AND i.accepted_at IS NOT NULL) AS accepted
			FROM users u WHERE lower(u.email) = ${invitedEmail}
		`)) as { id: string; joined: boolean; personal: boolean; accepted: boolean }[];
		check(
			"magic link vytvoří pouze pozvaný účet a atomicky jej přidá do týmu",
			accepted.status === 302 &&
				invitedRows.length === 1 &&
				!!invitedRows[0]?.joined &&
				!!invitedRows[0]?.personal &&
				!!invitedRows[0]?.accepted,
			{ status: accepted.status, row: invitedRows[0] },
		);
	} finally {
		await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
		await db.execute(sql`
			DELETE FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE lower(email) = ${invitedEmail})
		`);
		await db.execute(sql`DELETE FROM users WHERE lower(email) = ${invitedEmail}`);
		await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
	}

	if (failed) {
		console.error(`Auth security verification: ${failed} failed`);
		process.exit(1);
	}
	console.log("Auth security verification passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
