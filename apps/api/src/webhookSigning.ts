import { createHmac } from "node:crypto";
import { env } from "./env";

/** Derive one subscription-scoped secret without importing the API/auth route graph. */
export function webhookSigningSecret(subscriptionId: string): string {
	const root = env.publicWebhookSigningSecret;
	if (!root) throw new Error("public_webhook_signing_secret_missing");
	return `whsec_${createHmac("sha256", root).update(`watson-webhook:v1:${subscriptionId}`).digest("base64url")}`;
}
