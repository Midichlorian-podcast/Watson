import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicWebhookAddress, sendWebhook } from "./src/webhookDelivery";

test("webhook address policy blocks local, link-local, private and documentation networks", () => {
	for (const address of [
		"0.0.0.0",
		"10.2.3.4",
		"100.64.0.1",
		"127.0.0.1",
		"169.254.169.254",
		"172.16.0.1",
		"192.168.1.1",
		"198.18.0.1",
		"198.51.100.2",
		"203.0.113.4",
		"240.0.0.1",
		"::",
		"::1",
		"::ffff:7f00:1",
		"::ffff:127.0.0.1",
		"64:ff9b::7f00:1",
		"fc00::1",
		"fe80::1",
		"2001:db8::1",
	]) {
		assert.equal(isPublicWebhookAddress(address), false, address);
	}
	assert.equal(isPublicWebhookAddress("8.8.8.8"), true);
	assert.equal(isPublicWebhookAddress("1.1.1.1"), true);
	assert.equal(isPublicWebhookAddress("2606:4700:4700::1111"), true);
});

test("delivery rejects malformed endpoint credentials before network access", async () => {
	const result = await sendWebhook({
		subscriptionId: crypto.randomUUID(),
		endpointUrl: "https://user:password@example.com/hook",
		eventId: crypto.randomUUID(),
		eventType: "task.created",
		occurredAt: new Date(),
		payload: {},
	});
	assert.deepEqual(result, { ok: false, status: null, errorCode: "endpoint_invalid" });
});
