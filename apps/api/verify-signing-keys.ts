import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	decodeProtectedHeader,
	exportJWK,
	generateKeyPair,
	importJWK,
	jwtVerify,
	SignJWT,
} from "jose";
import {
	getLuckyOsJwks,
	getPowerSyncJwks,
	issueBridgeToken,
	issuePowerSyncToken,
} from "./src/powersync";
import { loadSigningKeyRingFromJson, SIGNING_ALG } from "./src/signingKeys";

function check(condition: unknown, label: string) {
	if (!condition) throw new Error(`FAIL: ${label}`);
	console.log(`✓ ${label}`);
}

const userId = crypto.randomUUID();
const powerToken = await issuePowerSyncToken(userId);
const bridgeToken = await issueBridgeToken({ email: "employee@example.test", personId: userId });
const powerHeader = decodeProtectedHeader(powerToken);
const bridgeHeader = decodeProtectedHeader(bridgeToken);
const powerJwks = getPowerSyncJwks();
const luckyJwks = getLuckyOsJwks();

check(powerHeader.kid !== bridgeHeader.kid, "PowerSync a LuckyOS mají odlišné current kid");
check(
	!powerJwks.some((power) => luckyJwks.some((lucky) => power.n === lucky.n)),
	"JWKS nesdílejí žádný veřejný modulus",
);

const powerPublic = powerJwks.find((key) => key.kid === powerHeader.kid);
const luckyPublic = luckyJwks.find((key) => key.kid === bridgeHeader.kid);
if (!powerPublic || !luckyPublic) throw new Error("current public key missing");
const powerVerified = await jwtVerify(powerToken, await importJWK(powerPublic, SIGNING_ALG), {
	audience: "powersync",
	issuer: "watson-powersync",
});
check(powerVerified.payload.sub === userId, "PowerSync token má účelový issuer/audience/sub");
const bridgeVerified = await jwtVerify(bridgeToken, await importJWK(luckyPublic, SIGNING_ALG), {
	audience: "luckyos",
	issuer: "watson-luckyos",
});
check(bridgeVerified.payload.email === "employee@example.test", "bridge token ověří jen LuckyOS keyring");

let crossVerifyRejected = false;
try {
	await jwtVerify(bridgeToken, await importJWK(powerPublic, SIGNING_ALG));
} catch {
	crossVerifyRejected = true;
}
check(crossVerifyRejected, "PowerSync klíč nedokáže ověřit LuckyOS token");

// Overlap: current má private část, předchozí zůstává public-only v JWKS.
const currentPair = await generateKeyPair(SIGNING_ALG, { extractable: true });
const oldPair = await generateKeyPair(SIGNING_ALG, { extractable: true });
const currentPublic = await exportJWK(currentPair.publicKey);
const oldPublic = await exportJWK(oldPair.publicKey);
const currentPrivate = await exportJWK(currentPair.privateKey);
const currentKid = "current-test";
const oldKid = "old-overlap-test";
const overlap = await loadSigningKeyRingFromJson(
	"powersync",
	JSON.stringify({
		version: 1,
		currentKid,
		keys: [
			{ kid: currentKid, createdAt: new Date().toISOString(), publicJwk: currentPublic, privateJwk: currentPrivate },
			{ kid: oldKid, createdAt: new Date(0).toISOString(), publicJwk: oldPublic },
		],
	}),
);
check(overlap.publicJwks.length === 2, "rotace publikuje current i předchozí overlap klíč");
const overlapToken = await new SignJWT({ scope: "test" })
	.setProtectedHeader({ alg: SIGNING_ALG, kid: overlap.currentKid })
	.setExpirationTime("1m")
	.sign(overlap.privateKey);
check(decodeProtectedHeader(overlapToken).kid === currentKid, "nové tokeny podepisuje výhradně currentKid");

for (const name of ["powersync", "luckyos"] as const) {
	const path = fileURLToPath(new URL(`./.keys/${name}-keyring.json`, import.meta.url));
	check((statSync(path).mode & 0o777) === 0o600, `${name} private keyring má práva 0600`);
}

console.log("Signing key isolation/rotation verification passed.");
process.exit(0);
