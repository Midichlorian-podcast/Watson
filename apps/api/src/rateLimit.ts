import type { Context, Next } from "hono";

/**
 * Jednoduchý in-memory rate-limiter (fixed window per klíč). Baseline ochrana proti brute-force
 * (auth) a spam frontě (sync/write) pro malý interní tým. Pro víc instancí API nahradit
 * Redis-backed limiterem (Redis už je ve stacku pro BullMQ).
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

/** Občasný úklid expirovaných klíčů (bez časovače — amortizovaně při zápisu). */
function sweep(now: number) {
	if (store.size < 5000) return;
	for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}

/** Klíč klienta: IP z proxy hlaviček (za reverse proxy). Fallback „unknown". */
function clientKey(c: Context): string {
	const fwd = c.req.header("x-forwarded-for");
	if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
	return c.req.header("x-real-ip") ?? "unknown";
}

export function rateLimit(opts: {
	windowMs: number;
	max: number;
	name: string;
}) {
	return async (c: Context, next: Next) => {
		const now = Date.now();
		const key = `${opts.name}:${clientKey(c)}`;
		const b = store.get(key);
		if (!b || b.resetAt <= now) {
			store.set(key, { count: 1, resetAt: now + opts.windowMs });
			sweep(now);
			return next();
		}
		b.count += 1;
		if (b.count > opts.max) {
			const retry = Math.ceil((b.resetAt - now) / 1000);
			c.header("Retry-After", String(retry));
			return c.json({ error: "rate_limited" }, 429);
		}
		return next();
	};
}
