/** Uzavřený CI provider: ověří přítomnost bridge JWT a vrací minimální LuckyOS kontrakt. */
import { createServer } from "node:http";

const port = Number(process.env.LUCKYOS_STUB_PORT ?? 8791);

function tokenPayload(header) {
	const raw = header?.startsWith("Bearer ") ? header.slice(7) : "";
	const payload = raw.split(".")[1];
	if (!payload) return null;
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

const server = createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	if (request.url === "/health") {
		response.end(JSON.stringify({ ok: true }));
		return;
	}
	const payload = tokenPayload(request.headers.authorization);
	if (!payload || payload.aud !== "luckyos" || typeof payload.email !== "string") {
		response.statusCode = 401;
		response.end(JSON.stringify({ error: "invalid_bridge_token" }));
		return;
	}
	if (request.url?.startsWith("/api/employee/me")) {
		if (payload.email.includes("integration-malformed")) {
			response.end(JSON.stringify({ person: { upstream_secret: "must-not-leak" } }));
			return;
		}
		response.end(
			JSON.stringify({
				user: { email: payload.email, role: "employee" },
				person: { id: `ci-${payload.sub}`, full_name: "CI Employee", person_type: "dpp" },
			}),
		);
		return;
	}
	if (request.url?.startsWith("/api/employee/status")) {
		response.end(
			JSON.stringify({
				person: { id: `ci-${payload.sub}`, full_name: "CI Employee", person_type: "dpp" },
				readiness: { status: "ready", blockers: [], missing_documents: [] },
				deadlines: {},
				notifications: [],
			}),
		);
		return;
	}
	response.end(JSON.stringify({ ok: true }));
});

server.listen(port, "127.0.0.1", () => {
	process.stdout.write(`LuckyOS CI stub listening on ${port}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
