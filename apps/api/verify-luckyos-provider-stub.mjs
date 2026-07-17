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
				person: {
					id: `ci-${payload.sub}`,
					full_name: "CI Employee",
					person_type: "dpp",
					private_email: payload.email,
				},
				readiness: {
					status: "blocked",
					blockers: [
						{
							type: "missing_document",
							explanation: "Doplň potvrzení pro personální evidenci.",
							href: "/employee/documents",
							internal_rule_id: "must-not-leak",
						},
					],
					missing_documents: ["potvrzeni"],
					upstream_secret: "must-not-leak",
				},
				deadlines: {
					attendance_due_day: 10,
					payroll_day: 15,
					computed_countdowns: [
						{
							key: "attendance",
							label: "Odevzdat docházku",
							due: "2026-08-10",
							days_remaining: 3,
							severity: "urgent",
							provider_only: "must-not-leak",
						},
					],
				},
				dpp_progress: { hours_used: 120, hours_limit: 300 },
				submissions: {
					attendance: [
						{
							id: "attendance-ci",
							status: "submitted",
							period_month: 7,
							period_year: 2026,
							provider_only: "must-not-leak",
						},
					],
				},
				notifications: [
					{
						id: "ci-missing-document",
						type: "missing_document",
						title: "Doplň potvrzení",
						message: "Potvrzení je potřeba před uzávěrkou.",
						href: "/employee/documents",
						due: "2026-08-10",
						is_read: false,
					},
					{
						id: "ci-payroll-ready",
						type: "payroll_ready",
						title: "Výplatní podklady připravené",
						href: "https://internal.example.test/payroll",
						is_read: true,
					},
				],
				upstream_secret: "must-not-leak",
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
