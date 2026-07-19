import { getConnInfo } from "@hono/node-server/conninfo";
import { getDb, sql } from "@watson/db";
import type { Context, Next } from "hono";
import { auth } from "./auth";
import { env } from "./env";

type LimitResult = { allowed: boolean; count: number; retryAfter: number };
let cleanupTick = 0;

/** Surové proxy hlavičky se ignorují, dokud deployment výslovně nepovolí TRUST_PROXY=1. */
function clientAddress(c: Context): string {
	if (env.trustProxy) {
		const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
		if (forwarded && forwarded.length <= 64) return forwarded;
		const real = c.req.header("x-real-ip")?.trim();
		if (real && real.length <= 64) return real;
	}
	try {
		return getConnInfo(c).remote.address ?? "unknown";
	} catch {
		// Test adaptéry bez Node bindings sdílejí konzervativní bucket; nikdy nevěří
		// uživatelem ovladatelné hlavičce jako fallbacku.
		return "unknown";
	}
}

async function rateLimitPrincipal(
	c: Context,
	scope: "ip" | "session-or-ip",
): Promise<string> {
	if (scope === "session-or-ip") {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (session?.user.id) return `user:${session.user.id}`;
	}
	return `ip:${clientAddress(c)}`;
}

async function opaqueClientKey(name: string, principal: string): Promise<string> {
	const input = new TextEncoder().encode(
		`${env.authSecret ?? "watson-dev-rate-limit"}:${principal}`,
	);
	const digest = await crypto.subtle.digest("SHA-256", input);
	return `${name}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Atomický count+reset v PostgreSQL — bezpečný při retry i mezi více API procesy. */
export async function consumeRateLimit(input: {
	key: string;
	windowMs: number;
	max: number;
}): Promise<LimitResult> {
	const db = getDb();
	const seconds = Math.max(1, Math.ceil(input.windowMs / 1000));
	const rows = (await db.execute(sql`
		INSERT INTO api_rate_limits (key, count, window_started_at, expires_at)
		VALUES (${input.key}, 1, now(), now() + (${seconds} * interval '1 second'))
		ON CONFLICT (key) DO UPDATE SET
			count = CASE WHEN api_rate_limits.expires_at <= now() THEN 1 ELSE api_rate_limits.count + 1 END,
			window_started_at = CASE WHEN api_rate_limits.expires_at <= now() THEN now() ELSE api_rate_limits.window_started_at END,
			expires_at = CASE WHEN api_rate_limits.expires_at <= now()
				THEN now() + (${seconds} * interval '1 second') ELSE api_rate_limits.expires_at END
		RETURNING count, GREATEST(1, ceil(extract(epoch from (expires_at - now()))))::int AS retry_after
	`)) as unknown as { count: number; retry_after: number }[];
	const row = rows[0] ?? { count: input.max + 1, retry_after: seconds };

	// Amortizovaný úklid bez timeru; chybu cleanupu nenecháme měnit výsledek limitu.
	cleanupTick++;
	if (cleanupTick % 1_000 === 0) {
		void db
			.execute(sql`DELETE FROM api_rate_limits WHERE expires_at < now() - interval '1 day'`)
			.catch(() => undefined);
	}
	return {
		allowed: row.count <= input.max,
		count: row.count,
		retryAfter: row.retry_after,
	};
}

export function rateLimit(opts: {
	windowMs: number;
	max: number;
	name: string;
	/** Auth/callback endpointy = ip; doménové endpointy = user s IP fallbackem. */
	scope?: "ip" | "session-or-ip";
}) {
	return async (c: Context, next: Next) => {
		try {
			const principal = await rateLimitPrincipal(c, opts.scope ?? "ip");
			const key = await opaqueClientKey(opts.name, principal);
			const result = await consumeRateLimit({ key, windowMs: opts.windowMs, max: opts.max });
			c.header("X-RateLimit-Limit", String(opts.max));
			c.header("X-RateLimit-Remaining", String(Math.max(0, opts.max - result.count)));
			if (!result.allowed) {
				c.header("Retry-After", String(result.retryAfter));
				return c.json({ error: "rate_limited" }, 429);
			}
			return next();
		} catch (error) {
			console.error(
				JSON.stringify({
					level: "error",
					event: "rate_limiter_unavailable",
					name: error instanceof Error ? error.name : "UnknownError",
				}),
			);
			// Fail closed: při výpadku autoritativního limitu neotevřít brute-force/AI endpoint.
			c.header("Retry-After", "30");
			return c.json({ error: "rate_limiter_unavailable" }, 503);
		}
	};
}
