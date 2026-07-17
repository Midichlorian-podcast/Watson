/** End-to-end proof of LuckyOS v1 identity provisioning and M2M boundary. */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const organizationId = "watson-luckyos-v1-test";
const webhookSecret = "watson-luckyos-v1-webhook-test-secret-2026";
process.env.LUCKYOS_PROTOCOL = "v1";
process.env.LUCKYOS_ORGANIZATION_ID = organizationId;
process.env.LUCKYOS_WEBHOOK_SIGNING_SECRET = webhookSecret;
process.env.LUCKYOS_BASE_URL = process.env.LUCKYOS_BASE_URL || "http://127.0.0.1:8791";
process.env.LUCKYOS_MOCK = "0";

const {
	and,
	eq,
	getDb,
	inArray,
	integrationConnections,
	luckyOsEventInbox,
	luckyOsIdentityBindings,
	users,
	workspaces,
} = await import("@watson/db");
const { luckyOsV1EmployeeFetch, luckyOsV1Routes } = await import("./src/luckyOsV1");

const db = getDb();
const userId = randomUUID();
const secondUserId = randomUUID();
const workspaceId = randomUUID();
const secondWorkspaceId = randomUUID();
const providerPersonId = `person-${randomUUID()}`;
const aggregateId = randomUUID();
const createdEventIds: string[] = [];

function event(args: {
	version: number;
	status: "pending" | "active" | "suspended" | "revoked";
	userId?: string;
	personId?: string;
	organization?: string;
	eventId?: string;
	aggregateId?: string;
}) {
	const eventId = args.eventId ?? randomUUID();
	createdEventIds.push(eventId);
	const personId = args.personId ?? providerPersonId;
	return {
		schema_version: 1,
		event_id: eventId,
		event_type:
			args.status === "revoked" ? "employee.access.revoked" : "employee.access.changed",
		organization_id: args.organization ?? organizationId,
		aggregate: {
			type: "external_identity_link",
			id: args.aggregateId ?? aggregateId,
			version: args.version,
		},
		person_id: personId,
		occurred_at: new Date().toISOString(),
		correlation_id: `correlation-${eventId}`,
		payload: {
			person_id: personId,
			watson_user_id: args.userId ?? userId,
			status: args.status,
			reason_code: args.status === "revoked" ? "offboarding" : null,
		},
	};
}

async function deliver(
	payload: ReturnType<typeof event>,
	idempotencyKey: string,
	options: { signature?: string; timestamp?: string } = {},
) {
	const rawBody = JSON.stringify(payload);
	const timestamp = options.timestamp ?? new Date().toISOString();
	const signature =
		options.signature ??
		`v1=${createHmac("sha256", webhookSecret)
			.update(`${timestamp}.${rawBody}`, "utf8")
			.digest("hex")}`;
	return luckyOsV1Routes.request(
		new Request("http://watson.test/api/integrations/luckyos/v1/events", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": idempotencyKey,
				"x-lucky-event-id": payload.event_id,
				"x-lucky-timestamp": timestamp,
				"x-lucky-signature": signature,
			},
			body: rawBody,
		}),
	);
}

try {
	await db.insert(users).values([
		{ id: userId, name: "Lucky v1 Employee", email: `lucky-v1-${userId}@watson.test` },
		{
			id: secondUserId,
			name: "Lucky v1 Other",
			email: `lucky-v1-${secondUserId}@watson.test`,
		},
	]);
	await db.insert(workspaces).values([
		{ id: workspaceId, name: "Personal Lucky v1", ownerId: userId, isPersonal: true },
		{
			id: secondWorkspaceId,
			name: "Personal Lucky v1 Other",
			ownerId: secondUserId,
			isPersonal: true,
		},
	]);

	const unsignedPayload = event({ version: 1, status: "active" });
	let response = await deliver(unsignedPayload, `lucky-test:${randomUUID()}`, {
		signature: `v1=${"0".repeat(64)}`,
	});
	assert.equal(response.status, 401, "unsigned/forged event must fail");

	const wrongTenant = event({ version: 1, status: "active", organization: "other-org" });
	response = await deliver(wrongTenant, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 403, "cross-tenant event must fail");

	const active = event({ version: 1, status: "active" });
	const activeKey = `lucky-test:${randomUUID()}`;
	response = await deliver(active, activeKey);
	assert.equal(response.status, 202);
	assert.deepEqual(await response.json(), { accepted: true, disposition: "identity_active" });
	assert.match(response.headers.get("cache-control") ?? "", /no-store/);

	response = await deliver(active, activeKey);
	assert.equal(response.status, 200, "lost response retry must replay");
	assert.equal(response.headers.get("idempotency-replayed"), "true");

	const conflictingReplay = event({ version: 1, status: "active" });
	response = await deliver(conflictingReplay, activeKey);
	assert.equal(response.status, 409, "same idempotency key with another body must conflict");

	let binding = (
		await db
			.select()
			.from(luckyOsIdentityBindings)
			.where(eq(luckyOsIdentityBindings.ownerUserId, userId))
			.limit(1)
	)[0];
	assert.ok(binding);
	assert.equal(binding.providerPersonId, providerPersonId);
	assert.equal(binding.organizationId, organizationId);
	assert.equal(binding.status, "active");
	assert.equal(binding.providerVersion, 1);

	const suspended = event({ version: 2, status: "suspended" });
	response = await deliver(suspended, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 202);
	const stale = event({ version: 1, status: "active" });
	response = await deliver(stale, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 202);
	assert.deepEqual(await response.json(), {
		accepted: true,
		disposition: "stale_identity_event",
	});
	binding = (
		await db
			.select()
			.from(luckyOsIdentityBindings)
			.where(eq(luckyOsIdentityBindings.ownerUserId, userId))
			.limit(1)
	)[0];
	assert.equal(binding?.status, "suspended", "out-of-order event must not downgrade state");
	assert.equal(binding?.providerVersion, 2);

	const reactivated = event({ version: 3, status: "active" });
	response = await deliver(reactivated, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 202);

	const crossOwner = event({
		version: 1,
		status: "active",
		userId: secondUserId,
		personId: providerPersonId,
	});
	response = await deliver(crossOwner, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 409, "one LuckyOS person cannot bind two Watson users");

	const provider = await luckyOsV1EmployeeFetch({
		userId,
		scopes: ["profile:read"],
		pathSuffix: "/profile",
		correlationId: `correlation-${randomUUID()}`,
	});
	assert.equal(provider.ok, true);
	assert.deepEqual(provider.data, {
		resource: "profile",
		data: { status: "available" },
		provider_person_id: providerPersonId,
		watson_user_id: userId,
		organization_id: organizationId,
		scope: "profile:read",
	});
	await assert.rejects(
		() =>
			luckyOsV1EmployeeFetch({
				userId,
				scopes: ["profile:write"],
				pathSuffix: "/profile/x/commands",
				method: "POST",
				body: {},
			}),
		/luckyos_v1_idempotency_required/,
	);

	const revoked = event({ version: 4, status: "revoked" });
	response = await deliver(revoked, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 202);
	const afterRevoke = await luckyOsV1EmployeeFetch({
		userId,
		scopes: ["profile:read"],
		pathSuffix: "/profile",
	});
	assert.equal(afterRevoke.status, 403);
	assert.equal(afterRevoke.errorCode, "luckyos_identity_not_linked");

	const replacementLinkId = randomUUID();
	const replacement = event({
		version: 1,
		status: "active",
		aggregateId: replacementLinkId,
	});
	response = await deliver(replacement, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 202, "a new provider link may replace only a revoked link");
	binding = (
		await db
			.select()
			.from(luckyOsIdentityBindings)
			.where(eq(luckyOsIdentityBindings.ownerUserId, userId))
			.limit(1)
	)[0];
	assert.equal(binding?.providerLinkId, replacementLinkId);
	assert.equal(binding?.providerVersion, 1);

	const [localConnection] = await db
		.insert(integrationConnections)
		.values({
			workspaceId,
			ownerUserId: userId,
			provider: "luckyos",
			status: "revoked",
			scopes: [],
			capabilities: [],
			revokedAt: new Date(),
		})
		.returning({ id: integrationConnections.id });
	assert.ok(localConnection);
	const locallyRevoked = await luckyOsV1EmployeeFetch({
		userId,
		scopes: ["profile:read"],
		pathSuffix: "/profile",
	});
	assert.equal(locallyRevoked.status, 403, "Watson-side revoke must precede token issuance");
	await db
		.update(integrationConnections)
		.set({ status: "configured", revokedAt: null })
		.where(eq(integrationConnections.id, localConnection.id));

	const finalRevocation = event({
		version: 2,
		status: "revoked",
		aggregateId: replacementLinkId,
	});
	response = await deliver(finalRevocation, `lucky-test:${randomUUID()}`);
	assert.equal(response.status, 202);

	const inbox = await db
		.select({ status: luckyOsEventInbox.status, disposition: luckyOsEventInbox.disposition })
		.from(luckyOsEventInbox)
		.where(and(eq(luckyOsEventInbox.eventId, finalRevocation.event_id)));
	assert.deepEqual(inbox, [{ status: "processed", disposition: "identity_revoked" }]);

	console.log("LuckyOS v1 verification passed: signed identity, replay, tenant, ordering, revoke and M2M scope.");
} finally {
	if (createdEventIds.length) {
		await db.delete(luckyOsEventInbox).where(inArray(luckyOsEventInbox.eventId, createdEventIds));
	}
	await db.delete(luckyOsIdentityBindings).where(
		inArray(luckyOsIdentityBindings.ownerUserId, [userId, secondUserId]),
	);
	await db.delete(integrationConnections).where(
		inArray(integrationConnections.ownerUserId, [userId, secondUserId]),
	);
	await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId, secondWorkspaceId]));
	await db.delete(users).where(inArray(users.id, [userId, secondUserId]));
}

process.exit(0);
