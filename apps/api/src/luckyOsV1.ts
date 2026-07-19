/**
 * Signed LuckyOS v1 integration boundary.
 *
 * Inbound events provision opaque person routing IDs; outbound calls derive
 * that ID exclusively from the server-side binding. No browser request can
 * choose another person or mint its own scopes.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
	and,
	eq,
	getDb,
	integrationConnections,
	luckyOsEventInbox,
	luckyOsIdentityBindings,
	or,
	sql,
	users,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import {
	absenceProviderStatusSchema,
	parseLuckyOsAbsenceCases,
	reconcileLuckyOsAbsenceCases,
} from "./employeeAbsenceProjection";
import { env } from "./env";
import { issueLuckyOsV1Token } from "./powersync";

const EVENT_MAX_BYTES = 64 * 1024;
const PROVIDER_JSON_MAX_BYTES = 2 * 1024 * 1024;
const PROVIDER_FILE_MAX_BYTES = 25 * 1024 * 1024;
const WEBHOOK_CLOCK_SKEW_MS = 5 * 60_000;

const correlationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const eventEnvelopeSchema = z
	.object({
		schema_version: z.literal(1),
		event_id: z.string().uuid(),
		event_type: z.string().regex(/^employee\.[a-z0-9._-]{1,150}$/),
		organization_id: z.string().trim().min(1).max(255),
		aggregate: z
			.object({
				type: z.string().trim().min(1).max(160),
				id: z.string().trim().min(1).max(255),
				version: z.number().int().positive(),
			})
			.strict(),
		person_id: z.string().trim().min(1).max(255).nullable(),
		occurred_at: z.string().datetime({ offset: true }),
		correlation_id: correlationIdSchema,
		payload: z.record(z.string(), z.unknown()),
	})
	.strict();

const identityEventPayloadSchema = z
	.object({
		person_id: z.string().trim().min(1).max(255),
		watson_user_id: z.string().uuid(),
		status: z.enum(["pending", "active", "suspended", "revoked"]),
		reason_code: z.string().trim().min(1).max(64).nullable().optional(),
	})
	.strict();

type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
type IdentityEventPayload = z.infer<typeof identityEventPayloadSchema>;

class LuckyOsV1Error extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
		this.name = "LuckyOsV1Error";
	}
}

function jsonResponse(body: unknown, status = 200, replayed = false) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "private, no-store, max-age=0",
			...(replayed ? { "idempotency-replayed": "true" } : {}),
		},
	});
}

function webhookSecret(): string {
	const secret = env.luckyOs.webhookSigningSecret ?? "";
	if (secret.length < 32 || secret.length > 512) {
		throw new LuckyOsV1Error("luckyos_webhook_not_configured", 503);
	}
	return secret;
}

function validWebhookSignature(rawBody: string, timestamp: string, provided: string): boolean {
	const parsedTime = Date.parse(timestamp);
	if (!Number.isFinite(parsedTime) || Math.abs(Date.now() - parsedTime) > WEBHOOK_CLOCK_SKEW_MS) {
		return false;
	}
	if (!/^v1=[a-f0-9]{64}$/.test(provided)) return false;
	const expected = `v1=${createHmac("sha256", webhookSecret())
		.update(`${timestamp}.${rawBody}`, "utf8")
		.digest("hex")}`;
	return timingSafeEqual(Buffer.from(provided, "ascii"), Buffer.from(expected, "ascii"));
}

function hashBody(rawBody: string): string {
	return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function parseIdentityEvent(event: EventEnvelope): IdentityEventPayload | null {
	if (
		event.event_type !== "employee.access.changed" &&
		event.event_type !== "employee.access.revoked"
	) {
		return null;
	}
	if (event.aggregate.type !== "external_identity_link") {
		throw new LuckyOsV1Error("invalid_identity_event", 422);
	}
	const parsed = identityEventPayloadSchema.safeParse(event.payload);
	if (!parsed.success || event.person_id !== parsed.data.person_id) {
		throw new LuckyOsV1Error("invalid_identity_event", 422);
	}
	if ((event.event_type === "employee.access.revoked") !== (parsed.data.status === "revoked")) {
		throw new LuckyOsV1Error("invalid_identity_event", 422);
	}
	return parsed.data;
}

function isAbsenceCaseEvent(event: EventEnvelope) {
	if (event.aggregate.type !== "employee_domain_case" || !event.person_id) return false;
	const data =
		event.payload.data && typeof event.payload.data === "object"
			? (event.payload.data as Record<string, unknown>)
			: null;
	return data?.case_type === "absence";
}

const absenceCaseEventPayloadSchema = z
	.object({
		agenda: z.literal("assignments"),
		entity_type: z.literal("employee_domain_case"),
		entity_id: z.string().trim().min(1).max(255),
		version: z.number().int().positive(),
		change_type: z.enum(["upserted", "closed"]),
		data: z
			.object({
				case_type: z.literal("absence"),
				status: absenceProviderStatusSchema,
			})
			.passthrough(),
	})
	.passthrough();

function parseAbsenceCaseEvent(event: EventEnvelope) {
	if (!isAbsenceCaseEvent(event)) return null;
	if (!event.event_type.match(/^employee\.domain\.assignments\.(upserted|closed)$/)) {
		throw new LuckyOsV1Error("invalid_absence_event", 422);
	}
	const payload = absenceCaseEventPayloadSchema.safeParse(event.payload);
	if (
		!payload.success ||
		payload.data.entity_id !== event.aggregate.id ||
		payload.data.version !== event.aggregate.version ||
		(event.event_type.endsWith(".closed") &&
			!["resolved", "rejected", "cancelled"].includes(payload.data.data.status))
	) {
		throw new LuckyOsV1Error("invalid_absence_event", 422);
	}
	return payload.data.data.status;
}

async function applySignedEvent(args: {
	event: EventEnvelope;
	idempotencyKey: string;
	payloadHash: string;
}) {
	const db = getDb();
	const identity = parseIdentityEvent(args.event);
	return db.transaction(async (tx) => {
		// Serialize both uniqueness domains in a fixed order. A combined lock would
		// not protect event A/key B racing event C/key B.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`luckyos-idempotency:${args.idempotencyKey}`}, 0))`,
		);
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`luckyos-event:${args.event.event_id}`}, 0))`,
		);
		const existingReceipt = (
			await tx
				.select({
					eventId: luckyOsEventInbox.eventId,
					payloadHash: luckyOsEventInbox.payloadHash,
					disposition: luckyOsEventInbox.disposition,
					ownerUserId: luckyOsEventInbox.ownerUserId,
				})
				.from(luckyOsEventInbox)
				.where(
					or(
						eq(luckyOsEventInbox.eventId, args.event.event_id),
						eq(luckyOsEventInbox.idempotencyKey, args.idempotencyKey),
					),
				)
				.limit(1)
		)[0];
		if (existingReceipt) {
			if (
				existingReceipt.eventId !== args.event.event_id ||
				existingReceipt.payloadHash !== args.payloadHash
			) {
				throw new LuckyOsV1Error("idempotency_conflict", 409);
			}
			let ownerUserId = existingReceipt.ownerUserId;
			if (!ownerUserId && !identity && args.event.person_id) {
				ownerUserId =
					(
						await tx
							.select({ ownerUserId: luckyOsIdentityBindings.ownerUserId })
							.from(luckyOsIdentityBindings)
							.where(
								and(
									eq(luckyOsIdentityBindings.organizationId, args.event.organization_id),
									eq(luckyOsIdentityBindings.providerPersonId, args.event.person_id),
									eq(luckyOsIdentityBindings.status, "active"),
								),
							)
							.limit(1)
					)[0]?.ownerUserId ?? null;
				if (ownerUserId) {
					await tx
						.update(luckyOsEventInbox)
						.set({ ownerUserId })
						.where(eq(luckyOsEventInbox.eventId, existingReceipt.eventId));
				}
			}
			return {
				replayed: true,
				disposition: existingReceipt.disposition,
				ownerUserId,
			};
		}

		let ownerUserId: string | null = null;
		let status: "pending" | "processed" | "ignored" = "pending";
		let disposition = "queued_for_projection";
		let processedAt: Date | null = null;

		if (identity) {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`luckyos-identity:${identity.watson_user_id}`}, 0))`,
			);
			const user = (
				await tx
					.select({ id: users.id })
					.from(users)
					.where(eq(users.id, identity.watson_user_id))
					.limit(1)
			)[0];
			if (!user) {
				disposition = "identity_user_pending";
			} else {
				ownerUserId = user.id;
				const workspace = (
					await tx
						.select({ id: workspaces.id })
						.from(workspaces)
						.where(and(eq(workspaces.ownerId, user.id), eq(workspaces.isPersonal, true)))
						.limit(1)
				)[0];
				if (!workspace) throw new LuckyOsV1Error("personal_workspace_missing", 503);

				const current = (
					await tx
						.select()
						.from(luckyOsIdentityBindings)
						.where(eq(luckyOsIdentityBindings.ownerUserId, user.id))
						.limit(1)
				)[0];
				const sameProviderLink = current?.providerLinkId === args.event.aggregate.id;
				const personOwner = (
					await tx
						.select({ ownerUserId: luckyOsIdentityBindings.ownerUserId })
						.from(luckyOsIdentityBindings)
						.where(
							and(
								eq(luckyOsIdentityBindings.organizationId, args.event.organization_id),
								eq(luckyOsIdentityBindings.providerPersonId, identity.person_id),
							),
						)
						.limit(1)
				)[0];
				if (personOwner && personOwner.ownerUserId !== user.id) {
					throw new LuckyOsV1Error("identity_person_conflict", 409);
				}
				if (current && !sameProviderLink && current.status !== "revoked") {
					throw new LuckyOsV1Error("identity_link_conflict", 409);
				}
				if (
					current &&
					sameProviderLink &&
					args.event.aggregate.version < current.providerVersion
				) {
					status = "ignored";
					disposition = "stale_identity_event";
					processedAt = new Date();
				} else if (
					current &&
					sameProviderLink &&
					args.event.aggregate.version === current.providerVersion
				) {
					if (
						current.providerPersonId !== identity.person_id ||
						current.status !== identity.status
					) {
						throw new LuckyOsV1Error("identity_version_conflict", 409);
					}
					status = "ignored";
					disposition = "duplicate_identity_version";
					processedAt = new Date();
				} else {
					const now = new Date();
					const values = {
						workspaceId: workspace.id,
						organizationId: args.event.organization_id,
						providerLinkId: args.event.aggregate.id,
						providerPersonId: identity.person_id,
						status: identity.status,
						providerVersion: args.event.aggregate.version,
						lastEventId: args.event.event_id,
						lastEventAt: new Date(args.event.occurred_at),
						reasonCode: identity.reason_code ?? null,
					};
					if (current) {
						await tx
							.update(luckyOsIdentityBindings)
							.set(values)
							.where(eq(luckyOsIdentityBindings.id, current.id));
					} else {
						await tx.insert(luckyOsIdentityBindings).values({
							...values,
							ownerUserId: user.id,
						});
					}
					status = "processed";
					disposition = `identity_${identity.status}`;
					processedAt = now;
				}
			}
		}
		if (!identity && args.event.person_id) {
			ownerUserId =
				(
					await tx
						.select({ ownerUserId: luckyOsIdentityBindings.ownerUserId })
						.from(luckyOsIdentityBindings)
						.where(
							and(
								eq(luckyOsIdentityBindings.organizationId, args.event.organization_id),
								eq(luckyOsIdentityBindings.providerPersonId, args.event.person_id),
								eq(luckyOsIdentityBindings.status, "active"),
							),
						)
						.limit(1)
				)[0]?.ownerUserId ?? null;
			if (!ownerUserId) disposition = "projection_identity_pending";
		}

		await tx.insert(luckyOsEventInbox).values({
			eventId: args.event.event_id,
			idempotencyKey: args.idempotencyKey,
			payloadHash: args.payloadHash,
			organizationId: args.event.organization_id,
			eventType: args.event.event_type,
			aggregateType: args.event.aggregate.type,
			aggregateId: args.event.aggregate.id,
			aggregateVersion: args.event.aggregate.version,
			providerPersonId: args.event.person_id,
			ownerUserId,
			correlationId: args.event.correlation_id,
			payload: args.event.payload,
			status,
			disposition,
			occurredAt: new Date(args.event.occurred_at),
			processedAt,
		});
		return { replayed: false, disposition, ownerUserId };
	});
}

async function projectAbsenceEvent(
	event: EventEnvelope,
	eventStatus: z.infer<typeof absenceProviderStatusSchema>,
	ownerUserId: string,
	auditRequestId: string,
) {
	const result = await luckyOsV1EmployeeFetch({
		userId: ownerUserId,
		scopes: ["cases:read"],
		pathSuffix: "/cases?limit=100&include_closed=true",
		correlationId: event.correlation_id,
	});
	if (!result.ok) throw new Error("absence_projection_provider_failed");
	let cases: ReturnType<typeof parseLuckyOsAbsenceCases>;
	try {
		cases = parseLuckyOsAbsenceCases(result.data);
	} catch {
		throw new Error("absence_projection_contract_rejected");
	}
	const target = cases.find((item) => item.id === event.aggregate.id);
	if (!target) {
		throw new Error("absence_projection_case_missing");
	}
	if (
		target.version < event.aggregate.version ||
		(target.version === event.aggregate.version && eventStatus !== target.status)
	) {
		// LuckyOS can publish before its read model catches up. Keep the signed event
		// pending instead of acknowledging stale state; the exact replay is retryable.
		throw new Error("absence_projection_provider_not_caught_up");
	}
	try {
		await reconcileLuckyOsAbsenceCases(ownerUserId, cases, auditRequestId);
	} catch {
		throw new Error("absence_projection_reconcile_failed");
	}
	try {
		await getDb()
			.update(luckyOsEventInbox)
			.set({ status: "processed", disposition: "absence_projected", processedAt: new Date() })
			.where(eq(luckyOsEventInbox.eventId, event.event_id));
	} catch {
		throw new Error("absence_projection_receipt_failed");
	}
}

export const luckyOsV1Routes = new Hono<{ Variables: { requestId: string } }>();

/** LuckyOS → Watson signed outbox endpoint. It never accepts browser credentials. */
luckyOsV1Routes.post("/api/integrations/luckyos/v1/events", async (c) => {
	try {
		if (env.luckyOs.protocol !== "v1") {
			throw new LuckyOsV1Error("luckyos_v1_disabled", 503);
		}
		const contentLength = Number(c.req.header("content-length") ?? "0");
		if (Number.isFinite(contentLength) && contentLength > EVENT_MAX_BYTES) {
			throw new LuckyOsV1Error("payload_too_large", 413);
		}
		const rawBody = await c.req.text();
		if (Buffer.byteLength(rawBody, "utf8") > EVENT_MAX_BYTES) {
			throw new LuckyOsV1Error("payload_too_large", 413);
		}
		const timestamp = c.req.header("x-lucky-timestamp")?.trim() ?? "";
		const signature = c.req.header("x-lucky-signature")?.trim() ?? "";
		if (!validWebhookSignature(rawBody, timestamp, signature)) {
			throw new LuckyOsV1Error("invalid_webhook_signature", 401);
		}
		const idempotencyKey = c.req.header("idempotency-key")?.trim() ?? "";
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$/.test(idempotencyKey)) {
			throw new LuckyOsV1Error("invalid_idempotency_key", 400);
		}
		let json: unknown;
		try {
			json = JSON.parse(rawBody);
		} catch {
			throw new LuckyOsV1Error("invalid_json", 400);
		}
		const parsed = eventEnvelopeSchema.safeParse(json);
		if (!parsed.success) throw new LuckyOsV1Error("invalid_event", 422);
		if (!env.luckyOs.organizationId || parsed.data.organization_id !== env.luckyOs.organizationId) {
			throw new LuckyOsV1Error("organization_scope_mismatch", 403);
		}
		if (c.req.header("x-lucky-event-id")?.trim() !== parsed.data.event_id) {
			throw new LuckyOsV1Error("event_id_mismatch", 400);
		}
		const absenceEventStatus = parseAbsenceCaseEvent(parsed.data);
		const result = await applySignedEvent({
			event: parsed.data,
			idempotencyKey,
			payloadHash: hashBody(rawBody),
		});
		if (absenceEventStatus && result.disposition !== "absence_projected") {
			if (!result.ownerUserId) {
				throw new LuckyOsV1Error("absence_projection_identity_pending", 503);
			}
			try {
				await projectAbsenceEvent(
					parsed.data,
					absenceEventStatus,
					result.ownerUserId,
					c.get("requestId"),
				);
			} catch (error) {
				console.warn(
					JSON.stringify({
						level: "warn",
						event: "luckyos_absence_projection_retry",
						eventId: parsed.data.event_id,
						code:
							error instanceof Error && error.message.startsWith("absence_projection_")
								? error.message
								: "absence_projection_failed",
					}),
				);
				await getDb()
					.update(luckyOsEventInbox)
					.set({ status: "pending", disposition: "absence_projection_retry_required" })
					.where(eq(luckyOsEventInbox.eventId, parsed.data.event_id));
				throw new LuckyOsV1Error("absence_projection_unavailable", 503);
			}
		}
		return jsonResponse(
			{
				accepted: true,
				disposition: absenceEventStatus ? "absence_projected" : result.disposition,
			},
			result.replayed ? 200 : 202,
			result.replayed,
		);
	} catch (error) {
		const known =
			error instanceof LuckyOsV1Error ? error : new LuckyOsV1Error("luckyos_event_failed", 503);
		return jsonResponse({ error: known.code }, known.status);
	}
});

export type LuckyOsV1Result = {
	ok: boolean;
	status: number;
	data: unknown;
	correlationId: string;
	errorCode?: string;
};

export type LuckyOsV1FileResult = LuckyOsV1Result & {
	bytes?: Uint8Array;
	mimeType?: "application/pdf" | "application/octet-stream";
};

/** Resolve the active provider binding without exposing it to the client. */
export async function activeLuckyOsV1Binding(userId: string) {
	const db = getDb();
	const row = (
		await db
			.select({
				organizationId: luckyOsIdentityBindings.organizationId,
				providerPersonId: luckyOsIdentityBindings.providerPersonId,
				status: luckyOsIdentityBindings.status,
			})
			.from(luckyOsIdentityBindings)
			.where(eq(luckyOsIdentityBindings.ownerUserId, userId))
			.limit(1)
	)[0];
	const locallyRevoked = (
		await db
			.select({ revokedAt: integrationConnections.revokedAt })
			.from(integrationConnections)
			.where(
				and(
					eq(integrationConnections.ownerUserId, userId),
					eq(integrationConnections.provider, "luckyos"),
				),
			)
			.limit(1)
	)[0]?.revokedAt;
	if (locallyRevoked) return null;
	return row?.status === "active" ? row : null;
}

async function boundedResponseBytes(response: Response, maxBytes: number) {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const item = await reader.read();
		if (item.done) break;
		total += item.value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error("provider_response_too_large");
		}
		chunks.push(item.value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function readProviderJson(
	response: Response,
	correlationId: string,
): Promise<LuckyOsV1Result> {
	const advertisedSize = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(advertisedSize) && advertisedSize > PROVIDER_JSON_MAX_BYTES) {
		await response.body?.cancel();
		return {
			ok: false,
			status: 502,
			data: null,
			correlationId,
			errorCode: "luckyos_response_too_large",
		};
	}
	let bytes: Uint8Array;
	try {
		bytes = await boundedResponseBytes(response, PROVIDER_JSON_MAX_BYTES);
	} catch {
		return {
			ok: false,
			status: 502,
			data: null,
			correlationId,
			errorCode: "luckyos_response_too_large",
		};
	}
	let data: unknown = null;
	try {
		data = bytes.byteLength ? JSON.parse(Buffer.from(bytes).toString("utf8")) : null;
	} catch {
		return {
			ok: false,
			status: 502,
			data: null,
			correlationId,
			errorCode: "luckyos_invalid_response",
		};
	}
	return { ok: response.ok, status: response.status, data, correlationId };
}

async function v1FileAuthorization(userId: string, scopes: readonly string[]) {
	const binding = await activeLuckyOsV1Binding(userId);
	if (!binding || binding.organizationId !== env.luckyOs.organizationId) return null;
	const token = await issueLuckyOsV1Token({
		organizationId: binding.organizationId,
		watsonUserId: userId,
		scopes,
	});
	return { token };
}

/**
 * Person-scoped LuckyOS request. `pathSuffix` and scopes are internal adapter
 * constants, never user input. Mutations require a stable idempotency key.
 */
export async function luckyOsV1EmployeeFetch(args: {
	userId: string;
	scopes: readonly string[];
	pathSuffix: string;
	method?: "GET" | "POST";
	body?: unknown;
	idempotencyKey?: string;
	correlationId?: string;
}): Promise<LuckyOsV1Result> {
	const correlationId = args.correlationId ?? `watson-${crypto.randomUUID()}`;
	if (!correlationIdSchema.safeParse(correlationId).success) {
		throw new Error("invalid_luckyos_v1_correlation_id");
	}
	if (env.luckyOs.protocol !== "v1" || !env.luckyOs.baseUrl || !env.luckyOs.organizationId) {
		return {
			ok: false,
			status: 503,
			data: null,
			correlationId,
			errorCode: "luckyos_v1_not_configured",
		};
	}
	if (
		!args.pathSuffix.startsWith("/") ||
		args.pathSuffix.startsWith("//") ||
		args.pathSuffix.includes("..") ||
		args.pathSuffix.includes("://") ||
		args.pathSuffix.includes("#")
	) {
		throw new Error("invalid_luckyos_v1_path");
	}
	const method = args.method ?? "GET";
	if (method !== "GET" && !args.idempotencyKey) {
		throw new Error("luckyos_v1_idempotency_required");
	}
	if (
		args.idempotencyKey &&
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$/.test(args.idempotencyKey)
	) {
		throw new Error("invalid_luckyos_v1_idempotency_key");
	}
	const binding = await activeLuckyOsV1Binding(args.userId);
	if (!binding || binding.organizationId !== env.luckyOs.organizationId) {
		return {
			ok: false,
			status: 403,
			data: null,
			correlationId,
			errorCode: "luckyos_identity_not_linked",
		};
	}
	const token = await issueLuckyOsV1Token({
		organizationId: binding.organizationId,
		watsonUserId: args.userId,
		scopes: args.scopes,
	});
	const path = `/api/integrations/watson/v1/employees/${encodeURIComponent(binding.providerPersonId)}${args.pathSuffix}`;
	let response: Response;
	try {
		response = await fetch(new URL(path, env.luckyOs.baseUrl), {
			method,
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
			headers: {
				accept: "application/json",
				authorization: `Bearer ${token}`,
				"x-correlation-id": correlationId,
				...(args.idempotencyKey ? { "idempotency-key": args.idempotencyKey } : {}),
				...(args.body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: args.body === undefined ? undefined : JSON.stringify(args.body),
		});
	} catch (error) {
		const timeout = error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`);
		return {
			ok: false,
			status: timeout ? 504 : 502,
			data: null,
			correlationId,
			errorCode: timeout ? "luckyos_timeout" : "luckyos_unavailable",
		};
	}
	return readProviderJson(response, correlationId);
}

/** Upload verified bytes to an already-created, identity-bound LuckyOS intent. */
export async function luckyOsV1EmployeeUpload(args: {
	userId: string;
	uploadId: string;
	bytes: Uint8Array;
	correlationId?: string;
}): Promise<LuckyOsV1Result> {
	const correlationId = args.correlationId ?? `watson-${crypto.randomUUID()}`;
	if (!correlationIdSchema.safeParse(correlationId).success) {
		throw new Error("invalid_luckyos_v1_correlation_id");
	}
	if (!z.string().uuid().safeParse(args.uploadId).success || args.bytes.byteLength < 1) {
		throw new Error("invalid_luckyos_v1_upload");
	}
	if (args.bytes.byteLength > PROVIDER_FILE_MAX_BYTES) {
		return { ok: false, status: 413, data: null, correlationId, errorCode: "payload_too_large" };
	}
	const baseUrl = env.luckyOs.baseUrl;
	if (env.luckyOs.protocol !== "v1" || !baseUrl || !env.luckyOs.organizationId) {
		return {
			ok: false,
			status: 503,
			data: null,
			correlationId,
			errorCode: "luckyos_v1_not_configured",
		};
	}
	const authorization = await v1FileAuthorization(args.userId, ["files:write"]);
	if (!authorization) {
		return {
			ok: false,
			status: 403,
			data: null,
			correlationId,
			errorCode: "luckyos_identity_not_linked",
		};
	}
	let response: Response;
	try {
		response = await fetch(
			new URL(`/api/integrations/watson/v1/uploads/${args.uploadId}/content`, baseUrl),
			{
				method: "PUT",
				redirect: "error",
				signal: AbortSignal.timeout(60_000),
				headers: {
					accept: "application/json",
					authorization: `Bearer ${authorization.token}`,
					"content-type": "application/octet-stream",
					"content-length": String(args.bytes.byteLength),
					"x-correlation-id": correlationId,
				},
				body: Buffer.from(args.bytes),
			},
		);
	} catch (error) {
		const timeout = error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`);
		return {
			ok: false,
			status: timeout ? 504 : 502,
			data: null,
			correlationId,
			errorCode: timeout ? "luckyos_timeout" : "luckyos_unavailable",
		};
	}
	return readProviderJson(response, correlationId);
}

/** Download an authorized official document without exposing storage credentials. */
export async function luckyOsV1PublishedDocument(args: {
	userId: string;
	documentId: string;
	disposition: "inline" | "attachment";
	correlationId?: string;
}): Promise<LuckyOsV1FileResult> {
	const correlationId = args.correlationId ?? `watson-${crypto.randomUUID()}`;
	if (!correlationIdSchema.safeParse(correlationId).success) {
		throw new Error("invalid_luckyos_v1_correlation_id");
	}
	if (!z.string().uuid().safeParse(args.documentId).success) {
		throw new Error("invalid_luckyos_v1_document");
	}
	const baseUrl = env.luckyOs.baseUrl;
	if (env.luckyOs.protocol !== "v1" || !baseUrl || !env.luckyOs.organizationId) {
		return {
			ok: false,
			status: 503,
			data: null,
			correlationId,
			errorCode: "luckyos_v1_not_configured",
		};
	}
	const authorization = await v1FileAuthorization(args.userId, ["documents:read"]);
	if (!authorization) {
		return {
			ok: false,
			status: 403,
			data: null,
			correlationId,
			errorCode: "luckyos_identity_not_linked",
		};
	}
	let response: Response;
	try {
		const path = `/api/integrations/watson/v1/published-documents/${args.documentId}/content?disposition=${args.disposition}`;
		response = await fetch(new URL(path, baseUrl), {
			method: "GET",
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
			headers: {
				accept: "application/pdf, application/octet-stream",
				authorization: `Bearer ${authorization.token}`,
				"x-correlation-id": correlationId,
			},
		});
	} catch (error) {
		const timeout = error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`);
		return {
			ok: false,
			status: timeout ? 504 : 502,
			data: null,
			correlationId,
			errorCode: timeout ? "luckyos_timeout" : "luckyos_unavailable",
		};
	}
	if (!response.ok) return readProviderJson(response, correlationId);
	const advertisedSize = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(advertisedSize) && advertisedSize > PROVIDER_FILE_MAX_BYTES) {
		await response.body?.cancel();
		return {
			ok: false,
			status: 502,
			data: null,
			correlationId,
			errorCode: "luckyos_response_too_large",
		};
	}
	const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (mimeType !== "application/pdf" && mimeType !== "application/octet-stream") {
		await response.body?.cancel();
		return {
			ok: false,
			status: 502,
			data: null,
			correlationId,
			errorCode: "luckyos_invalid_response",
		};
	}
	try {
		const bytes = await boundedResponseBytes(response, PROVIDER_FILE_MAX_BYTES);
		if (bytes.byteLength < 1) {
			return {
				ok: false,
				status: 502,
				data: null,
				correlationId,
				errorCode: "luckyos_invalid_response",
			};
		}
		return { ok: true, status: 200, data: null, correlationId, bytes, mimeType };
	} catch {
		return {
			ok: false,
			status: 502,
			data: null,
			correlationId,
			errorCode: "luckyos_response_too_large",
		};
	}
}
