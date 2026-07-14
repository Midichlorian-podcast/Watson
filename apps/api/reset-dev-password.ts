/**
 * DEV utilita — nastaví heslo existujícího účtu na hodnotu, kterou zadáš TY přes NEW_PASSWORD.
 * Heslo hashuje better-auth (stejná funkce jako při loginu → 100% kompatibilní). Skript heslo
 * jen zahashuje a uloží; nikam ho neposílá.
 *
 * Spuštění (z kořene repa):
 *   cd apps/api && NEW_PASSWORD='ZvolSiHeslo123' npx tsx reset-dev-password.ts
 * Jiný účet:
 *   cd apps/api && EMAIL=adam@watson.test NEW_PASSWORD='...' npx tsx reset-dev-password.ts
 *
 * Účty s týmovým prostorem: demo@watson.test (Kancelář Praha). Po nastavení se přihlas
 * e-mailem + heslem na http://localhost:5180.
 */
import "./src/env"; // side-effect: načte kořenový .env → process.env.DATABASE_URL
import { accounts, and, eq, getDb, users } from "@watson/db";
import { hashPassword } from "better-auth/crypto";

async function main() {
	const email = process.env.EMAIL ?? "demo@watson.test";
	const pw = process.env.NEW_PASSWORD ?? "";
	if (pw.length < 8) {
		console.error(
			"❌ Nastav NEW_PASSWORD (min. 8 znaků). Např.:\n   NEW_PASSWORD='Watson123!' npx tsx reset-dev-password.ts",
		);
		process.exit(1);
	}
	const db = getDb();
	const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (!u) {
		console.error(`❌ Uživatel ${email} v DB nenalezen.`);
		process.exit(1);
	}
	const hash = await hashPassword(pw);
	const res = await db
		.update(accounts)
		.set({ password: hash, updatedAt: new Date() })
		.where(and(eq(accounts.userId, u.id), eq(accounts.providerId, "credential")))
		.returning({ id: accounts.id });
	if (!res.length) {
		console.error(`❌ Účet typu 'credential' pro ${email} nenalezen (nemá heslo).`);
		process.exit(1);
	}
	console.log(`✅ Heslo pro ${email} nastaveno. Přihlas se na http://localhost:5180 (e-mail + tvoje heslo).`);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
