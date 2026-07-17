/** Uzavřený CI provider: ověří přítomnost bridge JWT a vrací minimální LuckyOS kontrakt. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.LUCKYOS_STUB_PORT ?? 8791);
const v1Receipts = new Map();
const v1Responses = new Map();
const v1Uploads = new Map();

async function requestBytes(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

async function requestBody(request) {
	return (await requestBytes(request)).toString("utf8");
}

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

const server = createServer(async (request, response) => {
	response.setHeader("content-type", "application/json");
	if (request.url === "/health") {
		response.end(JSON.stringify({ ok: true }));
		return;
	}
	const payload = tokenPayload(request.headers.authorization);
	const isV1 =
		payload?.aud === "lucky-os" &&
		payload?.iss === "watson" &&
		typeof payload?.watson_user_id === "string" &&
		typeof payload?.organization_id === "string" &&
		typeof payload?.scope === "string" &&
		typeof payload?.jti === "string" &&
		payload?.sub === payload?.watson_user_id &&
		payload?.email === undefined &&
		payload?.person_id === undefined;
	if (isV1 && request.url?.startsWith("/api/integrations/watson/v1/uploads/")) {
		const scopes = new Set(payload.scope.split(/\s+/));
		const match = new URL(request.url, "http://luckyos.test").pathname.match(
			/^\/api\/integrations\/watson\/v1\/uploads\/([a-f0-9-]+)\/content$/,
		);
		if (request.method !== "PUT" || !match || !scopes.has("files:write")) {
			response.statusCode = 403;
			response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
			return;
		}
		const upload = v1Uploads.get(match[1]);
		if (!upload) {
			response.statusCode = 404;
			response.end(JSON.stringify({ error: { code: "domain_target_not_found" } }));
			return;
		}
		const bytes = await requestBytes(request);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		if (bytes.length !== upload.size_bytes || sha256 !== upload.sha256) {
			response.statusCode = 409;
			response.end(JSON.stringify({ error: { code: "file_upload_mismatch" } }));
			return;
		}
		upload.status = upload.status === "consumed" ? "consumed" : "uploaded";
		response.end(
			JSON.stringify({
				upload,
				request_id: crypto.randomUUID(),
				correlation_id: request.headers["x-correlation-id"],
			}),
		);
		return;
	}
	if (isV1 && request.url?.startsWith("/api/integrations/watson/v1/published-documents/")) {
		const scopes = new Set(payload.scope.split(/\s+/));
		if (request.method !== "GET" || !scopes.has("documents:read")) {
			response.statusCode = 403;
			response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
			return;
		}
		const bytes = Buffer.from("%PDF-1.4\n% Watson LuckyOS verification\n%%EOF\n", "utf8");
		response.setHeader("content-type", "application/pdf");
		response.setHeader("content-length", String(bytes.length));
		response.end(bytes);
		return;
	}

	if (isV1 && request.url?.startsWith("/api/integrations/watson/v1/employees/")) {
		if (!request.headers["x-correlation-id"]) {
			response.statusCode = 400;
			response.end(JSON.stringify({ error: { code: "invalid_correlation_id" } }));
			return;
		}
		const url = new URL(request.url, "http://luckyos.test");
		const match = url.pathname.match(/^\/api\/integrations\/watson\/v1\/employees\/([^/]+)\/(.+)$/);
		if (!match) {
			response.statusCode = 404;
			response.end(JSON.stringify({ error: { code: "not_found" } }));
			return;
		}
		const providerPersonId = decodeURIComponent(match[1]);
		const remainder = match[2];
		const scopes = new Set(payload.scope.split(/\s+/));
		const resource = remainder.split("/", 1)[0];
		const readScope = {
			profile: "profile:read",
			"profile-change-requests": "profile:read",
			attendance: "attendance:read",
			"small-numbers": "small-numbers:read",
			"work-items": "work-items:read",
			documents: "documents:read",
			"published-documents": "documents:read",
			"expense-claims": "expenses:read",
			"trainer-projects": "trainer-projects:read",
			contracts: "contracts:read",
		}[resource];
		if (request.method === "GET" && (!readScope || !scopes.has(readScope))) {
			response.statusCode = 403;
			response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
			return;
		}
		if (request.method === "GET" && remainder === "profile") {
			response.end(JSON.stringify({
				resource: "profile",
				data: { profile: {
					id: providerPersonId,
					version: 3,
					name: "CI Employee v1",
					person_type: "dpp",
					email: "employee-v1@watson.test",
					phone: "+420 777 111 222",
					address: "Praha",
					bank_account: "123456789/0100",
					is_active: true,
					upstream_secret: "must-not-leak",
				} },
				request_id: crypto.randomUUID(),
				correlation_id: request.headers["x-correlation-id"],
			}));
			return;
		}
		if (request.method === "GET" && remainder === "work-items") {
			response.end(JSON.stringify({
				items: [{
					id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					source_key: "attendance:2026-07",
					source_type: "attendance",
					source_id: "2026-07",
					kind: "attendance_submission",
					direction: "employer_to_employee",
					title: "Odevzdej docházku za červenec",
					priority: "high",
					required_response: ["domain_action"],
					action: { resource: "attendance", upstream_secret: "must-not-leak" },
					status: "open",
					due_at: "2026-07-31T20:00:00.000Z",
					acknowledged_at: null,
					submitted_at: null,
					closed_at: null,
					version: 1,
					created_at: "2026-07-01T08:00:00.000Z",
					updated_at: "2026-07-01T08:00:00.000Z",
				}],
				next_cursor: null,
				request_id: crypto.randomUUID(),
				correlation_id: request.headers["x-correlation-id"],
			}));
			return;
		}
		if (request.method === "GET" && remainder === "profile-change-requests") {
			response.end(JSON.stringify({
				resource: "profile-change-requests",
				data: { requests: [{
					id: "profile-request-ci",
					version: 2,
					patch: { phone: "+420 777 000 000", bank_account: "must-not-leak" },
					field_decisions: { phone: "approved" },
					status: "pending",
					reviewer_note: "Čeká na kontrolu",
					created_at: "2026-07-01T08:00:00.000Z",
					updated_at: "2026-07-02T08:00:00.000Z",
					provider_only: "must-not-leak",
				}] },
			}));
			return;
		}
		if (request.method === "GET" && remainder === "attendance") {
			response.end(JSON.stringify({
				resource: "attendance",
				data: {
					records: [{
						id: "attendance-record-ci",
						version: 1,
						date: "2026-07-02",
						activity_type: "training",
						hours: 2.5,
						note: "Trénink",
						created_at: "2026-07-02T08:00:00.000Z",
						updated_at: "2026-07-02T08:00:00.000Z",
						provider_only: "must-not-leak",
					}],
					submissions: [{
						id: "attendance-submission-ci",
						version: 1,
						period_month: 7,
						period_year: 2026,
						status: "draft",
						submitted_at: null,
						reviewed_at: null,
						reviewer_note: null,
						employee_note: "Koncept",
						created_at: "2026-07-02T08:00:00.000Z",
						updated_at: "2026-07-02T08:00:00.000Z",
					}],
				},
			}));
			return;
		}
		if (request.method === "GET" && remainder === "small-numbers") {
			response.end(JSON.stringify({
				resource: "small-numbers",
				data: {
					choreographies: [{
						id: "choreography-ci",
						version: 1,
						name: "Sólová choreografie",
						status: "active",
						type: "solo",
						trainer_ids: [providerPersonId],
						created_at: "2026-07-01T08:00:00.000Z",
						updated_at: "2026-07-01T08:00:00.000Z",
					}],
					entries: [{
						id: "small-number-ci",
						version: 2,
						choreography_id: "choreography-ci",
						choreography_name: "Sólová choreografie",
						period_month: 7,
						period_year: 2026,
						hours_minutes: 90,
						note: "Rozpracováno",
						status: "draft",
						reviewer_note: null,
						created_at: "2026-07-03T08:00:00.000Z",
						updated_at: "2026-07-03T08:00:00.000Z",
					}],
				},
			}));
			return;
		}
		if (request.method === "GET" && remainder === "documents") {
			response.end(
				JSON.stringify({
					documents: [
						{
							id: "document-ci",
							type: "tax_declaration",
							file_name: "prohlaseni.pdf",
							file_type: "application/pdf",
							file_size_bytes: 1234,
							file_sha256: "a".repeat(64),
							note: null,
							review_status: "pending",
							review_note: null,
							valid_from: "2026-01-01",
							valid_until: "2026-12-31",
							created_at: "2026-07-01T08:00:00.000Z",
							updated_at: "2026-07-01T08:00:00.000Z",
							storage_file_id: "must-not-leak",
						},
					],
					next_cursor: null,
				}),
			);
			return;
		}
		if (request.method === "GET" && remainder === "published-documents") {
			response.end(
				JSON.stringify({
					resource: "published-documents",
					data: {
						documents: [
							{
								id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
								document_type: "payslip",
								period_year: 2026,
								period_month: 6,
								title: "Výplatnice červen 2026",
								version: 1,
								file_name: "vyplatnice.pdf",
								mime_type: "application/pdf",
								size_bytes: 1234,
								sha256: "b".repeat(64),
								published_at: "2026-07-10T08:00:00.000Z",
								withdrawn_at: null,
								updated_at: "2026-07-10T08:00:00.000Z",
								storage_file_id: "must-not-leak",
							},
						],
					},
				}),
			);
			return;
		}
		if (request.method === "GET" && remainder === "expense-claims") {
			response.end(
				JSON.stringify({
					claims: [
						{
							id: "expense-ci",
							title: "Jízdenka",
							amount: 120,
							currency: "CZK",
							amount_czk: 120,
							exchange_rate: null,
							date: "2026-07-15",
							payment_source: "personal_card",
							category: "transport",
							note: null,
							reimbursement_source: "accounting",
							trainer_project_id: null,
							status: "submitted",
							reviewer_note: null,
							reimbursed_at: null,
							receipt: {
								file_name: "jizdenka.pdf",
								mime_type: "application/pdf",
								sha256: "c".repeat(64),
								storage_file_id: "must-not-leak",
							},
							created_at: "2026-07-15T08:00:00.000Z",
							updated_at: "2026-07-15T08:00:00.000Z",
						},
					],
					next_cursor: null,
				}),
			);
			return;
		}
		if (request.method === "GET" && remainder === "trainer-projects") {
			response.end(
				JSON.stringify({
					resource: "trainer-projects",
					data: {
						projects: [
							{
								id: "trainer-project-ci",
								name: "Letní soustředění",
								status: "active",
								review_status: "approved",
								owner_trainer_ids: [providerPersonId],
							},
						],
					},
				}),
			);
			return;
		}
		if (request.method === "GET" && remainder === "contracts") {
			response.end(
				JSON.stringify({
					resource: "contracts",
					data: {
						contracts: [
							{
								id: "contract-ci",
								version: 4,
								type: "dpp",
								title: "DPP červenec–prosinec 2026",
								valid_from: "2026-07-01",
								valid_until: "2026-12-31",
								status: "draft",
								workflow_status: "sent_to_employee",
								signed_date: null,
								file_name: "dpp.pdf",
								final_pdf_sha256: null,
								locked_at: null,
								created_at: "2026-07-01T08:00:00.000Z",
								updated_at: "2026-07-15T08:00:00.000Z",
								employer_private_note: "must-not-leak",
							},
						],
					},
				}),
			);
			return;
		}
		if (request.method === "POST" && remainder === "upload-intents") {
			const key = request.headers["idempotency-key"];
			const raw = await requestBody(request);
			if (!scopes.has("files:write") || typeof key !== "string") {
				response.statusCode = 403;
				response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
				return;
			}
			const previous = v1Receipts.get(key);
			if (previous && previous !== raw) {
				response.statusCode = 409;
				response.end(JSON.stringify({ error: { code: "idempotency_conflict" } }));
				return;
			}
			if (previous) {
				response.statusCode = 201;
				response.setHeader("idempotency-replayed", "true");
				response.end(JSON.stringify(v1Responses.get(key)));
				return;
			}
			const body = JSON.parse(raw);
			const id = crypto.randomUUID();
			const upload = {
				id,
				purpose: body.purpose,
				work_item_id: null,
				file_name: body.file_name,
				mime_type: body.mime_type,
				size_bytes: body.file_size_bytes,
				sha256: body.file_sha256,
				status: "created",
				expires_at: "2026-07-18T08:00:00.000Z",
			};
			v1Uploads.set(id, upload);
			const result = {
				upload,
				upload_url: `/api/integrations/watson/v1/uploads/${id}/content`,
				idempotency_replayed: false,
				request_id: crypto.randomUUID(),
				correlation_id: request.headers["x-correlation-id"],
			};
			v1Receipts.set(key, raw);
			v1Responses.set(key, result);
			response.statusCode = 201;
			response.end(JSON.stringify(result));
			return;
		}
		if (
			request.method === "POST" &&
			(remainder === "documents" || remainder === "expense-claims")
		) {
			const key = request.headers["idempotency-key"];
			const raw = await requestBody(request);
			const requiredScope = remainder === "documents" ? "documents:write" : "expenses:write";
			if (!scopes.has(requiredScope) || typeof key !== "string") {
				response.statusCode = 403;
				response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
				return;
			}
			const previous = v1Receipts.get(key);
			if (previous && previous !== raw) {
				response.statusCode = 409;
				response.end(JSON.stringify({ error: { code: "idempotency_conflict" } }));
				return;
			}
			if (previous) {
				response.statusCode = 201;
				response.setHeader("idempotency-replayed", "true");
				response.end(JSON.stringify({ ...v1Responses.get(key), idempotency_replayed: true }));
				return;
			}
			const body = JSON.parse(raw);
			const upload = v1Uploads.get(body.upload_id);
			if (!upload || upload.status !== "uploaded") {
				response.statusCode = 409;
				response.end(JSON.stringify({ error: { code: "file_upload_mismatch" } }));
				return;
			}
			upload.status = "consumed";
			const entity =
				remainder === "documents"
					? {
							id: body.id,
							type: body.type,
							file_name: upload.file_name,
							file_type: upload.mime_type,
							file_size_bytes: upload.size_bytes,
							file_sha256: upload.sha256,
							note: body.note,
							review_status: "pending",
							review_note: null,
							valid_from: body.valid_from,
							valid_until: body.valid_until,
							created_at: "2026-07-17T08:00:00.000Z",
							updated_at: "2026-07-17T08:00:00.000Z",
							storage_file_id: "must-not-leak",
						}
					: {
							id: body.id,
							title: body.title,
							amount: body.amount,
							currency: body.currency,
							amount_czk: body.amount_czk,
							exchange_rate: body.exchange_rate,
							date: body.date,
							payment_source: body.payment_source,
							category: body.category,
							note: body.note,
							reimbursement_source: body.reimbursement_source,
							trainer_project_id: body.trainer_project_id,
							status: "submitted",
							reviewer_note: null,
							reimbursed_at: null,
							receipt: {
								file_name: upload.file_name,
								mime_type: upload.mime_type,
								sha256: upload.sha256,
								storage_file_id: "must-not-leak",
							},
							created_at: "2026-07-17T08:00:00.000Z",
							updated_at: "2026-07-17T08:00:00.000Z",
						};
			const result =
				remainder === "documents"
					? { document: entity, idempotency_replayed: false }
					: { claim: entity, idempotency_replayed: false };
			v1Receipts.set(key, raw);
			v1Responses.set(key, result);
			response.statusCode = 201;
			response.end(JSON.stringify(result));
			return;
		}
		if (request.method === "POST" && /^contracts\/[^/]+\/sign$/.test(remainder)) {
			const key = request.headers["idempotency-key"];
			const raw = await requestBody(request);
			if (!scopes.has("contracts:write") || typeof key !== "string") {
				response.statusCode = 403;
				response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
				return;
			}
			const previous = v1Receipts.get(key);
			if (previous && previous !== raw) {
				response.statusCode = 409;
				response.end(JSON.stringify({ error: { code: "idempotency_conflict" } }));
				return;
			}
			if (previous) {
				response.end(JSON.stringify({ ...v1Responses.get(key), idempotency_replayed: true }));
				return;
			}
			const body = JSON.parse(raw);
			if (
				body.full_name !== "CI Employee v1" ||
				body.birth_date !== "1990-01-02" ||
				body.bank_account_suffix !== "6789"
			) {
				response.statusCode = 400;
				response.end(JSON.stringify({ error: { code: "signature_challenge_failed" } }));
				return;
			}
			const result = {
				contract: {
					id: "contract-ci",
					version: 5,
					type: "dpp",
					title: "DPP červenec–prosinec 2026",
					valid_from: "2026-07-01",
					valid_until: "2026-12-31",
					status: "active",
					workflow_status: "active",
					signed_date: "2026-07-17",
					file_name: "dpp-final.pdf",
					final_pdf_sha256: "d".repeat(64),
					locked_at: "2026-07-17T08:00:00.000Z",
					created_at: "2026-07-01T08:00:00.000Z",
					updated_at: "2026-07-17T08:00:00.000Z",
				},
				signature: {
					signature_image_data_url: "must-not-leak",
					verification_method: "must-not-leak",
				},
				document: { storage_file_id: "must-not-leak" },
				idempotency_replayed: false,
			};
			v1Receipts.set(key, raw);
			v1Responses.set(key, result);
			response.end(JSON.stringify(result));
			return;
		}

		if (request.method === "POST" && remainder.endsWith("/commands")) {
			const writeScope = resource === "profile-change-requests"
				? "profile:write"
				: resource === "attendance"
					? "attendance:write"
					: resource === "small-numbers"
						? "small-numbers:write"
						: null;
			const key = request.headers["idempotency-key"];
			const raw = await requestBody(request);
			if (!writeScope || !scopes.has(writeScope) || typeof key !== "string") {
				response.statusCode = 403;
				response.end(JSON.stringify({ error: { code: "insufficient_scope" } }));
				return;
			}
			const previous = v1Receipts.get(key);
			if (previous && previous !== raw) {
				response.statusCode = 409;
				response.end(JSON.stringify({ error: { code: "domain_version_or_state_conflict" } }));
				return;
			}
			v1Receipts.set(key, raw);
			const command = JSON.parse(raw);
			const replayed = Boolean(previous);
			response.statusCode = command.expected_version === 0 ? 201 : 200;
			response.setHeader("idempotency-replayed", String(replayed));
			response.end(JSON.stringify({
				entity_type: resource,
				entity: {
					id: remainder.split("/")[1],
					status: command.status ?? (command.command === "attendance.submit" ? "submitted" : "draft"),
					version: Math.max(1, Number(command.expected_version) || 0),
					period: resource === "attendance" || resource === "small-numbers" ? remainder.split("/")[1] : null,
					saved_records: Array.isArray(command.records) ? command.records.length : null,
					upstream_secret: "must-not-leak",
				},
				idempotency_replayed: replayed,
				request_id: crypto.randomUUID(),
				correlation_id: request.headers["x-correlation-id"],
			}));
			return;
		}
		response.statusCode = 404;
		response.end(JSON.stringify({ error: { code: "resource_not_supported" } }));
		return;
	}
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
