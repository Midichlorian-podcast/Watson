/**
 * Regresní test CC-P0-08: obsah a akce Mailu jsou demo a nesmí tvrdit
 * neověřený stav. Account lifecycle a owner-only read/send M1 mají explicitní
 * allowlist claimů, které dokládá API E2E + mail static contract.
 *
 * 1) Žádný UI text v src/mail nesmí tvrdit „odesláno / doručeno / připojeno /
 *    (za)šifrováno" bez explicitního demo/simulace kontextu NA STEJNÉM řádku.
 * 2) Permanentní MailDemoBanner musí zůstat v shellu modulu, obou composerech
 *    a v mailových sekcích globálního Nastavení.
 *
 * Spuštění: pnpm --filter @watson/web test (tsx src/mail/runClaimsTest.ts)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAIL_DIR = join(import.meta.dirname, ".");
const FORBIDDEN =
	/(odesláno|doručeno|připojeno|připojena|zašifrováno|šifrováno|šifrovaně|šifrovan[áéý]|připojení funguje)/i;
// Stemy kvůli českému skloňování (demo/demu, simulace/simulaci). „993" povoluje
// faktické popisy IMAP protokolu (993 = šifrovaný port), ne stav dat.
const ALLOWED = /(dem[ou]|simulac|nešifrov|neopustil|993)/i;
const VERIFIED_ACCOUNT_CLAIMS: Record<string, RegExp[]> = {
	"AdminScreen.tsx": [/Pošta přes skutečný OAuth a šifrovaný vault/],
	"NastaveniScreen.tsx": [/Google účet připojíš přes OAuth; heslo Watson nikdy nevidí a credential ukládá šifrovaně/],
	"MailSub.tsx": [/zatím nepřipojeno/],
	"MailboxWizard.tsx": [
		/Schránka je ověřená\. Šifrovaná synchronizace IMAP a odesílání přes SMTP běží na pozadí/,
		/Credential i synchronizovaný obsah jsou šifrované a odesílání má desetisekundové Zpět/,
	],
	"PersonalMailWorkspace.tsx": [
		/Watson zprávy synchronizuje šifrovaně\. Heslo nevidí a obsah zpřístupní jen vlastníkovi účtu/,
		/Skutečný šifrovaný příjem, odesílání, hledání a Watson pohledy/,
	],
	"PersonalMailComposer.tsx": [
		/Watson bezpečně zachová mailové vlákno.*Skutečné odeslání přes připojený účet.*obsah je ve frontě šifrovaný/,
	],
};

let failed = 0;
const fail = (msg: string) => {
	failed++;
	console.error(`  ✗ ${msg}`);
};

// ── 1) sken falešných tvrzení ──
for (const f of readdirSync(MAIL_DIR).filter((x) => x.endsWith(".tsx"))) {
	const lines = readFileSync(join(MAIL_DIR, f), "utf8").split("\n");
	lines.forEach((raw, i) => {
		const trimmed = raw.trim();
		// čisté komentáře neklamou uživatele — sken cílí na renderovaný text
		if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
		if (ALLOWED.test(raw)) return;
		// řádkový komentář za kódem nesmí schovat nález v kódu, ale sám o sobě nevadí
		const code = raw.replace(/\/\/.*$/, "");
		if (VERIFIED_ACCOUNT_CLAIMS[f]?.some((claim) => claim.test(code))) return;
		if (FORBIDDEN.test(code)) {
			fail(`${f}:${i + 1} tvrdí neověřený stav bez demo/simulace: ${trimmed.slice(0, 90)}`);
		}
	});
}
if (failed === 0) console.log("  ✓ žádné tvrzení o odeslání/připojení/šifrování bez demo kontextu");

// ── 2) banner zůstává na místě ──
const mustHaveBanner: [string, number][] = [
	["MailScreen.tsx", 1],
	["NewMessage.tsx", 1],
	["FloatComposer.tsx", 1],
	["../screens/Nastaveni.tsx", 2],
	["../components/PeekPanel.tsx", 1],
];
for (const [rel, min] of mustHaveBanner) {
	const src = readFileSync(join(MAIL_DIR, rel), "utf8");
	const n = (src.match(/MailDemoBanner/g) ?? []).length;
	if (n < min + 1) {
		// +1 za import
		fail(`${rel}: očekávám aspoň ${min}× vykreslený <MailDemoBanner>, nalezeno ${Math.max(0, n - 1)}`);
	} else {
		console.log(`  ✓ ${rel}: MailDemoBanner přítomen`);
	}
}

if (failed > 0) {
	console.error(`\nMail demo-claims test: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nMail demo-claims test: vše prošlo");
