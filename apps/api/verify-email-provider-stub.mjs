/** Lokální Resend-compatible stub pro CI. Nikdy neposílá síťový e-mail. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.EMAIL_STUB_PORT ?? 8792);
const receipts = new Map();
const messages = [];

function json(response, status, body) {
	response.writeHead(status, { "Content-Type": "application/json" });
	response.end(JSON.stringify(body));
}

createServer((request, response) => {
	if (request.method === "GET" && request.url === "/health")
		return json(response, 200, { ok: true });
	if (request.method === "GET" && request.url === "/messages")
		return json(response, 200, { messages });
	if (request.method !== "POST" || request.url !== "/emails")
		return json(response, 404, { error: "not_found" });
	if (request.headers.authorization !== "Bearer re_ci_provider_key")
		return json(response, 401, { error: "unauthorized" });
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		let body;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			return json(response, 400, { error: "invalid_json" });
		}
		const recipient = Array.isArray(body?.to) ? String(body.to[0] ?? "") : "";
		if (recipient.includes("email-rejected"))
			return json(response, 422, { error: "fixture_rejected" });
		if (
			recipient.includes("malformed") &&
			String(body?.subject ?? "").includes("test e-mailových připomínek")
		)
			return json(response, 200, { accepted: true, upstream_secret: "must-not-leak" });
		const key = String(request.headers["idempotency-key"] ?? "");
		if (key && receipts.has(key)) return json(response, 200, { id: receipts.get(key) });
		const id = `stub-${createHash("sha256").update(key || JSON.stringify(body)).digest("hex").slice(0, 24)}`;
		if (key) receipts.set(key, id);
		messages.push({ id, key, to: recipient, subject: String(body?.subject ?? "") });
		return json(response, 200, { id });
	});
}).listen(port, "127.0.0.1", () => {
	console.log(`[email-stub] listening on http://127.0.0.1:${port}`);
});
