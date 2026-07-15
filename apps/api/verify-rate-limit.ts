/** Distribuovaný limiter: atomická konkurence, reset okna a odolnost vůči spoofed XFF. */
import "./src/env";
import { consumeRateLimit } from "./src/rateLimit";

const API = process.env.RATE_LIMIT_API ?? "http://127.0.0.1:8790";
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

async function main(): Promise<void> {
	const key = `verify:${crypto.randomUUID()}`;
	const concurrent = await Promise.all(
		Array.from({ length: 25 }, () => consumeRateLimit({ key, windowMs: 1_000, max: 10 })),
	);
	check(
		"25 souběžných requestů sdílí jeden atomický čítač",
		concurrent.filter((result) => result.allowed).length === 10 &&
			Math.max(...concurrent.map((result) => result.count)) === 25,
		concurrent,
	);
	await new Promise((resolve) => setTimeout(resolve, 1_100));
	const reset = await consumeRateLimit({ key, windowMs: 1_000, max: 10 });
	check("po expiraci vznikne nové okno s count=1", reset.allowed && reset.count === 1, reset);

	// Server běží bez TRUST_PROXY: 21 různých uživatelem ovladatelných XFF hlaviček
	// proto nesmí vytvořit 21 bucketů a obejít max=20 na /api/watson/*.
	const responses = await Promise.all(
		Array.from({ length: 21 }, (_, i) =>
			fetch(`${API}/api/watson/rate-limit-probe-${crypto.randomUUID()}`, {
				headers: { "X-Forwarded-For": `198.51.100.${i + 1}` },
			}),
		),
	);
	const statuses = responses.map((response) => response.status);
	check(
		"spoofed X-Forwarded-For neobchází limit",
		statuses.filter((status) => status === 429).length === 1 &&
			statuses.filter((status) => status === 404).length === 20,
		statuses,
	);
	const limited = responses.find((response) => response.status === 429);
	check(
		"429 vrací Retry-After a budget hlavičky",
		Boolean(
			limited?.headers.get("retry-after") &&
				limited.headers.get("x-ratelimit-limit") === "20" &&
				limited.headers.get("x-ratelimit-remaining") === "0",
		),
		Object.fromEntries(limited?.headers ?? []),
	);

	if (failed) throw new Error(`${failed} rate-limit checks failed`);
	console.log("\nRate-limit checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
