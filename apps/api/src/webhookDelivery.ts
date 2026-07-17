/**
 * F8c webhook delivery worker.
 *
 * Delivery is at-least-once. Event IDs are stable, receivers should deduplicate
 * them. DNS is resolved before the request and the selected public address is
 * pinned into the socket options, preventing a DNS-rebinding hop to an internal
 * service. Redirects are never followed.
 */
import { createHmac } from "node:crypto";
import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { getDb, sql } from "@watson/db";
import { webhookSigningSecret } from "./publicApi";

const MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

type ClaimedDelivery = {
	id: string;
	attempt_count: number;
	subscription_id: string;
	endpoint_url: string;
	event_id: string;
	event_type: string;
	occurred_at: Date;
	payload: Record<string, unknown>;
};

type DeliveryResult = {
	ok: boolean;
	status: number | null;
	errorCode: string | null;
};

/** Numeric IPv4 comparison avoids the familiar string-prefix bypasses. */
function ipv4Number(address: string): number | null {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return null;
	}
	return (((parts[0] ?? 0) * 256 + (parts[1] ?? 0)) * 256 + (parts[2] ?? 0)) * 256 + (parts[3] ?? 0);
}

function inV4Range(value: number, base: string, bits: number): boolean {
	const baseValue = ipv4Number(base);
	if (baseValue === null) return true;
	const size = 2 ** (32 - bits);
	return value >= baseValue && value < baseValue + size;
}

export function isPublicWebhookAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		const value = ipv4Number(address);
		if (value === null) return false;
		return !([
			["0.0.0.0", 8],
			["10.0.0.0", 8],
			["100.64.0.0", 10],
			["127.0.0.0", 8],
			["169.254.0.0", 16],
			["172.16.0.0", 12],
			["192.0.0.0", 24],
			["192.0.2.0", 24],
			["192.168.0.0", 16],
			["198.18.0.0", 15],
			["198.51.100.0", 24],
			["203.0.113.0", 24],
			["224.0.0.0", 4],
			["240.0.0.0", 4],
		] satisfies [string, number][]).some(([base, bits]) => inV4Range(value, base, bits));
	}
	if (family === 6) {
		const normalized = address.toLowerCase();
		if (normalized === "::" || normalized === "::1") return false;
		// Reject every IPv4-mapped spelling (including hexadecimal forms such as
		// ::ffff:7f00:1) instead of trying to normalize it ourselves.
		if (normalized.startsWith("::ffff:")) return false;
		if (normalized.startsWith("64:ff9b:") || normalized.startsWith("100:")) return false;
		if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
		if (/^fe[89ab]/.test(normalized)) return false;
		if (normalized.startsWith("ff")) return false;
		if (normalized.startsWith("2001:db8:")) return false;
		return true;
	}
	return false;
}

async function resolvePinned(url: URL): Promise<{ address: string; family: 4 | 6; allowLocal: boolean }> {
	const allowLocal =
		process.env.NODE_ENV !== "production" &&
		url.protocol === "http:" &&
		["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	const rows = await dns.lookup(url.hostname, { all: true, verbatim: true });
	if (rows.length === 0) throw new Error("dns_empty");
	if (!allowLocal && rows.some((row) => !isPublicWebhookAddress(row.address))) {
		throw new Error("dns_private_address");
	}
	const selected = rows[0];
	if (!selected || (selected.family !== 4 && selected.family !== 6)) throw new Error("dns_invalid");
	return { address: selected.address, family: selected.family, allowLocal };
}

function errorCode(error: unknown): string {
	const code = (error as { code?: unknown }).code;
	if (error instanceof Error && error.message.startsWith("dns_")) return "endpoint_address_rejected";
	if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
	if (typeof code === "string" && code.startsWith("CERT_")) return "tls_error";
	if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENETUNREACH") {
		return "network_unavailable";
	}
	return "network_error";
}

export async function sendWebhook(input: {
	subscriptionId: string;
	endpointUrl: string;
	eventId: string;
	eventType: string;
	occurredAt: Date;
	payload: Record<string, unknown>;
}): Promise<DeliveryResult> {
	let url: URL;
	try {
		url = new URL(input.endpointUrl);
		if (url.username || url.password || url.hash) throw new Error("endpoint_invalid");
		if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
			throw new Error("endpoint_insecure");
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("endpoint_invalid");
	} catch {
		return { ok: false, status: null, errorCode: "endpoint_invalid" };
	}

	try {
		const pinned = await resolvePinned(url);
		if (url.protocol === "http:" && !pinned.allowLocal) {
			return { ok: false, status: null, errorCode: "endpoint_insecure" };
		}
		const body = JSON.stringify({
			id: input.eventId,
			type: input.eventType,
			apiVersion: "2026-07-17",
			occurredAt: input.occurredAt.toISOString(),
			data: input.payload,
		});
		const timestamp = Math.floor(Date.now() / 1_000).toString();
		const signature = createHmac("sha256", webhookSigningSecret(input.subscriptionId))
			.update(`${timestamp}.${body}`)
			.digest("hex");
		const transport = url.protocol === "https:" ? https : http;
		return await new Promise<DeliveryResult>((resolve) => {
			let settled = false;
			const finish = (result: DeliveryResult) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};
			const request = transport.request(
				{
					protocol: url.protocol,
					hostname: pinned.address,
					family: pinned.family,
					port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
					path: `${url.pathname}${url.search}`,
					method: "POST",
					servername: url.protocol === "https:" ? url.hostname : undefined,
					headers: {
						Host: url.host,
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(body),
						"User-Agent": "Watson-Webhooks/1.0",
						"Watson-Event-Id": input.eventId,
						"Watson-Event-Type": input.eventType,
						"Watson-Timestamp": timestamp,
						"Watson-Signature": `v1=${signature}`,
					},
				},
				(response) => {
					let received = 0;
					response.on("data", (chunk: Buffer) => {
						received += chunk.length;
						if (received > MAX_RESPONSE_BYTES) response.destroy();
					});
					response.on("end", () => {
						const status = response.statusCode ?? 0;
						if (status >= 200 && status < 300) finish({ ok: true, status, errorCode: null });
						else if (status >= 300 && status < 400)
							finish({ ok: false, status, errorCode: "redirect_rejected" });
						else finish({ ok: false, status, errorCode: `http_${status}` });
					});
				},
			);
			request.setTimeout(REQUEST_TIMEOUT_MS, () => {
				request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
			});
			request.on("error", (error) => finish({ ok: false, status: null, errorCode: errorCode(error) }));
			request.end(body);
		});
	} catch (error) {
		return { ok: false, status: null, errorCode: errorCode(error) };
	}
}

async function fanoutEvents(): Promise<number> {
	return getDb().transaction(async (tx) => {
		const events = (await tx.execute(sql`
			SELECT id, workspace_id, event_type, project_id, occurred_at
			FROM webhook_events
			WHERE fanout_at IS NULL
			ORDER BY occurred_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 100
		`)) as unknown as {
			id: string;
			workspace_id: string;
			event_type: string;
			project_id: string;
			occurred_at: Date;
		}[];
		for (const event of events) {
			await tx.execute(sql`
				INSERT INTO webhook_deliveries (subscription_id, event_id)
				SELECT s.id, ${event.id}::uuid
				FROM webhook_subscriptions s
				WHERE s.workspace_id = ${event.workspace_id}::uuid
					AND s.active
					AND s.created_at <= ${new Date(event.occurred_at).toISOString()}::timestamptz
					AND ${event.event_type} = ANY(s.event_types)
					AND ${event.project_id}::uuid = ANY(s.project_ids)
				ON CONFLICT (subscription_id, event_id) DO NOTHING
			`);
			await tx.execute(
				sql`UPDATE webhook_events SET fanout_at = now() WHERE id = ${event.id}::uuid`,
			);
			// An installation without a matching active subscription must not retain a
			// 30-day shadow history of every task mutation.
			await tx.execute(sql`
				DELETE FROM webhook_events e
				WHERE e.id = ${event.id}::uuid
					AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id = e.id)
			`);
		}
		return events.length;
	});
}

async function claimDeliveries(): Promise<ClaimedDelivery[]> {
	return (await getDb().execute(sql`
		WITH due AS (
			SELECT d.id
			FROM webhook_deliveries d
			JOIN webhook_subscriptions s ON s.id = d.subscription_id
			WHERE d.status = 'pending'
				AND d.next_attempt_at <= now()
				AND (d.lease_until IS NULL OR d.lease_until < now())
				AND s.active
			ORDER BY d.next_attempt_at, d.id
			FOR UPDATE OF d SKIP LOCKED
			LIMIT 10
		), claimed AS (
			UPDATE webhook_deliveries d SET
				lease_until = now() + interval '30 seconds',
				attempt_count = d.attempt_count + 1,
				updated_at = now()
			FROM due WHERE d.id = due.id
			RETURNING d.*
		)
		SELECT c.id, c.attempt_count, c.subscription_id, s.endpoint_url,
			e.id AS event_id, e.event_type, e.occurred_at, e.payload
		FROM claimed c
		JOIN webhook_subscriptions s ON s.id = c.subscription_id
		JOIN webhook_events e ON e.id = c.event_id
	`)) as unknown as ClaimedDelivery[];
}

function retrySeconds(attempt: number): number {
	return Math.min(21_600, 30 * 2 ** Math.max(0, attempt - 1));
}

async function recordResult(delivery: ClaimedDelivery, result: DeliveryResult): Promise<void> {
	const db = getDb();
	if (result.ok) {
		await db.transaction(async (tx) => {
			await tx.execute(sql`
				UPDATE webhook_deliveries SET status = 'delivered', lease_until = NULL,
					response_status = ${result.status}, last_error_code = NULL,
					delivered_at = now(), updated_at = now()
				WHERE id = ${delivery.id}::uuid
			`);
			await tx.execute(sql`
				UPDATE webhook_subscriptions SET failure_count = 0, last_attempt_at = now(),
					last_success_at = now(), last_error_code = NULL, updated_at = now()
				WHERE id = ${delivery.subscription_id}::uuid
			`);
		});
		return;
	}
	const dead = delivery.attempt_count >= MAX_ATTEMPTS;
	const retry = retrySeconds(delivery.attempt_count);
	await db.transaction(async (tx) => {
		await tx.execute(sql`
			UPDATE webhook_deliveries SET status = ${dead ? "dead" : "pending"}, lease_until = NULL,
				response_status = ${result.status}, last_error_code = ${result.errorCode ?? "network_error"},
				next_attempt_at = now() + (${retry} * interval '1 second'), updated_at = now()
			WHERE id = ${delivery.id}::uuid
		`);
		await tx.execute(sql`
			UPDATE webhook_subscriptions SET failure_count = failure_count + 1,
				last_attempt_at = now(), last_error_code = ${result.errorCode ?? "network_error"},
				updated_at = now()
			WHERE id = ${delivery.subscription_id}::uuid
		`);
	});
}

let cleanupTick = 0;
export async function runWebhookWorkerOnce(): Promise<{ fannedOut: number; delivered: number }> {
	const fannedOut = await fanoutEvents();
	const deliveries = await claimDeliveries();
	await Promise.all(
		deliveries.map(async (delivery) => {
			const result = await sendWebhook({
				subscriptionId: delivery.subscription_id,
				endpointUrl: delivery.endpoint_url,
				eventId: delivery.event_id,
				eventType: delivery.event_type,
				occurredAt: new Date(delivery.occurred_at),
				payload: delivery.payload,
			});
			await recordResult(delivery, result);
		}),
	);
	cleanupTick++;
	if (cleanupTick % 1_000 === 0) {
		await getDb().execute(sql`
			DELETE FROM webhook_events e
			WHERE e.occurred_at < now() - interval '30 days'
				AND NOT EXISTS (
					SELECT 1 FROM webhook_deliveries d
					WHERE d.event_id = e.id AND d.status = 'pending'
				)
		`);
	}
	return { fannedOut, delivered: deliveries.length };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerBusy = false;

export function startWebhookWorker(intervalMs = 5_000): void {
	if (workerTimer) return;
	workerTimer = setInterval(() => {
		if (workerBusy) return;
		workerBusy = true;
		void runWebhookWorkerOnce()
			.catch((error) => {
				console.error(
					JSON.stringify({
						level: "error",
						event: "webhook_worker_failed",
						name: error instanceof Error ? error.name : "UnknownError",
					}),
				);
			})
			.finally(() => {
				workerBusy = false;
			});
	}, intervalMs);
	workerTimer.unref?.();
	console.log(`[webhooks] worker běží (interval ${intervalMs / 1000}s)`);
}
