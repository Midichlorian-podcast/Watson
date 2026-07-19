/**
 * LuckyOS v1 employee documents, expenses and contract-signing facade.
 *
 * Watson never persists HR files or signature images. It validates the browser
 * input, derives the person and scopes server-side, and streams bytes through a
 * LuckyOS upload intent whose hash, MIME, owner and purpose are immutable.
 */
import { createHash } from "node:crypto";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { env } from "./env";
import { isLuckyOsRevoked, recordLuckyOsHealth } from "./integrations";
import {
	type LuckyOsV1FileResult,
	type LuckyOsV1Result,
	luckyOsV1EmployeeFetch,
	luckyOsV1EmployeeUpload,
	luckyOsV1PublishedDocument,
} from "./luckyOsV1";

export const EMPLOYEE_FILE_MAX_BYTES = 25 * 1024 * 1024;
const operationId = z.string().uuid();
const isoDate = z.string().date();
const nullableProviderText = (max: number) => z.string().max(max).nullable().optional();

const documentType = z.enum([
	"dpp_contract",
	"employment_contract",
	"tax_declaration",
	"bank_account_confirmation",
	"timesheet_support",
	"other",
]);

const employeeDocumentSchema = z
	.object({
		id: z.string().min(1).max(255),
		type: nullableProviderText(80),
		file_name: nullableProviderText(255),
		file_type: nullableProviderText(160),
		file_size_bytes: z.number().int().positive().max(EMPLOYEE_FILE_MAX_BYTES).nullable(),
		file_sha256: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.nullable(),
		note: nullableProviderText(1_000),
		review_status: nullableProviderText(40),
		review_note: nullableProviderText(2_000),
		valid_from: z.string().date().nullable(),
		valid_until: z.string().date().nullable(),
		created_at: nullableProviderText(64),
		updated_at: nullableProviderText(64),
	})
	.passthrough();

const expenseClaimSchema = z
	.object({
		id: z.string().min(1).max(255),
		title: nullableProviderText(180),
		amount: z.number().finite().positive().nullable(),
		currency: nullableProviderText(8),
		amount_czk: z.number().int().positive().nullable(),
		exchange_rate: z.number().finite().positive().nullable(),
		date: z.string().date().nullable(),
		payment_source: nullableProviderText(80),
		category: nullableProviderText(80),
		note: nullableProviderText(1_000),
		reimbursement_source: nullableProviderText(80),
		trainer_project_id: nullableProviderText(96),
		status: nullableProviderText(40),
		reviewer_note: nullableProviderText(2_000),
		reimbursed_at: nullableProviderText(64),
		receipt: z
			.object({
				file_name: nullableProviderText(255),
				mime_type: nullableProviderText(160),
				sha256: z
					.string()
					.regex(/^[a-f0-9]{64}$/)
					.nullable(),
			})
			.passthrough(),
		created_at: nullableProviderText(64),
		updated_at: nullableProviderText(64),
	})
	.passthrough();

const contractSchema = z
	.object({
		id: z
			.string()
			.min(1)
			.max(255)
			.regex(/^[A-Za-z0-9._:-]+$/),
		version: z.number().int().positive(),
		type: nullableProviderText(80),
		title: nullableProviderText(200),
		valid_from: z.string().date().nullable(),
		valid_until: z.string().date().nullable(),
		status: nullableProviderText(40),
		workflow_status: nullableProviderText(60),
		signed_date: z.string().date().nullable(),
		file_name: nullableProviderText(255),
		final_pdf_sha256: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.nullable(),
		locked_at: nullableProviderText(64),
		created_at: nullableProviderText(64),
		updated_at: nullableProviderText(64),
	})
	.passthrough();

const trainerProjectSchema = z
	.object({
		id: z.string().min(1).max(96),
		name: nullableProviderText(200),
		status: nullableProviderText(40),
		review_status: nullableProviderText(40),
	})
	.passthrough();

const publishedDocumentSchema = z
	.object({
		id: z.string().uuid(),
		document_type: z.string().max(80),
		period_year: z.number().int().min(2020).max(2100).nullable().optional(),
		period_month: z.number().int().min(1).max(12).nullable().optional(),
		title: z.string().max(200),
		version: z.number().int().positive(),
		file_name: z.string().max(255),
		mime_type: z.enum(["application/pdf", "application/octet-stream"]),
		size_bytes: z.number().int().positive().max(EMPLOYEE_FILE_MAX_BYTES),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		published_at: z.string().datetime({ offset: true }),
		withdrawn_at: z.string().datetime({ offset: true }).nullable(),
		updated_at: z.string().datetime({ offset: true }),
	})
	.passthrough();

const documentListEnvelope = z
	.object({
		documents: z.array(employeeDocumentSchema).max(100),
		next_cursor: z.string().max(500).nullable(),
	})
	.passthrough();
const expenseListEnvelope = z
	.object({
		claims: z.array(expenseClaimSchema).max(100),
		next_cursor: z.string().max(500).nullable(),
	})
	.passthrough();
const contractEnvelope = z
	.object({
		resource: z.literal("contracts"),
		data: z.object({ contracts: z.array(contractSchema).max(100) }).passthrough(),
	})
	.passthrough();
const trainerProjectsEnvelope = z
	.object({
		resource: z.literal("trainer-projects"),
		data: z.object({ projects: z.array(trainerProjectSchema).max(100) }).passthrough(),
	})
	.passthrough();
const publishedEnvelope = z
	.object({
		resource: z.literal("published-documents"),
		data: z.object({ documents: z.array(publishedDocumentSchema).max(100) }).passthrough(),
	})
	.passthrough();

const uploadIntentEnvelope = z
	.object({
		upload: z
			.object({
				id: z.string().uuid(),
				purpose: z.enum(["expense_receipt", "person_document", "lifecycle_document"]),
				work_item_id: z.string().uuid().nullable(),
				file_name: z.string().max(255),
				mime_type: z.string().max(160),
				size_bytes: z.number().int().positive().max(EMPLOYEE_FILE_MAX_BYTES),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
				status: z.enum(["created", "uploading", "uploaded", "attached", "consumed"]),
				expires_at: z.string().datetime({ offset: true }),
			})
			.strict(),
		upload_url: z.string().regex(/^\/api\/integrations\/watson\/v1\/uploads\/[a-f0-9-]+\/content$/),
		idempotency_replayed: z.boolean(),
	})
	.passthrough();

const uploadedFileEnvelope = z.object({ upload: uploadIntentEnvelope.shape.upload }).passthrough();
const documentCommandEnvelope = z
	.object({
		document: z.record(z.string(), z.unknown()),
		idempotency_replayed: z.boolean(),
	})
	.passthrough();
const expenseCommandEnvelope = z
	.object({
		claim: z.record(z.string(), z.unknown()),
		idempotency_replayed: z.boolean(),
	})
	.passthrough();
const contractCommandEnvelope = z
	.object({
		contract: z.record(z.string(), z.unknown()),
		signature: z.record(z.string(), z.unknown()),
		document: z.record(z.string(), z.unknown()),
		idempotency_replayed: z.boolean(),
	})
	.passthrough();

const documentFormSchema = z
	.object({
		operationId,
		type: documentType,
		note: z.string().trim().max(1_000).nullable(),
		validFrom: isoDate.nullable(),
		validUntil: isoDate.nullable(),
	})
	.strict()
	.refine((value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, {
		path: ["validUntil"],
		message: "invalid_validity",
	});

const expenseFormSchema = z
	.object({
		operationId,
		title: z.string().trim().min(1).max(180),
		amount: z.coerce.number().finite().positive().max(10_000_000),
		currency: z.enum(["CZK", "EUR", "USD", "PLN"]),
		exchangeRate: z.coerce.number().finite().positive().max(10_000).nullable(),
		date: isoDate,
		paymentSource: z.enum(["personal_cash", "personal_card", "studio_cash", "studio_card"]),
		category: z.enum([
			"costumes",
			"transport",
			"props",
			"refreshments",
			"entry_fees",
			"accommodation",
			"other_expense_claim",
		]),
		note: z.string().trim().max(1_000).nullable(),
		reimbursementSource: z.enum(["accounting", "internal_cash", "trainer_fund"]),
		trainerProjectId: z.string().trim().min(1).max(96).nullable(),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.currency === "CZK") !== (value.exchangeRate === null)) {
			context.addIssue({
				code: "custom",
				path: ["exchangeRate"],
				message: "invalid_exchange_rate",
			});
		}
		if ((value.reimbursementSource === "trainer_fund") !== (value.trainerProjectId !== null)) {
			context.addIssue({
				code: "custom",
				path: ["trainerProjectId"],
				message: "invalid_trainer_project",
			});
		}
	});

const contractSignInput = z
	.object({
		operationId,
		contractId: z
			.string()
			.min(1)
			.max(128)
			.regex(/^[A-Za-z0-9._:-]+$/),
		expectedVersion: z.number().int().positive(),
		consent: z.literal(true),
		fullName: z.string().trim().min(1).max(200),
		birthDate: isoDate,
		bankAccountSuffix: z
			.string()
			.trim()
			.regex(/^\d{4}$/)
			.nullable(),
		signatureDataUrl: z
			.string()
			.min(50)
			.max(2_000_000)
			.regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/),
	})
	.strict();

const SAFE_PROVIDER_ERRORS = new Set([
	"access_denied",
	"access_revoked",
	"agenda_read_channel_mismatch",
	"agenda_write_channel_mismatch",
	"command_unavailable",
	"contract_finalization_failed",
	"domain_target_not_found",
	"domain_version_or_state_conflict",
	"file_malware_detected",
	"file_scan_unavailable",
	"file_storage_unavailable",
	"file_upload_mismatch",
	"idempotency_conflict",
	"insufficient_scope",
	"invalid_file_finalize",
	"invalid_file_upload",
	"rate_limited",
	"signature_challenge_failed",
]);

function providerError(result: LuckyOsV1Result | LuckyOsV1FileResult) {
	const root =
		result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
	const nested =
		root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : {};
	const code = typeof nested.code === "string" ? nested.code : null;
	return code && SAFE_PROVIDER_ERRORS.has(code)
		? code
		: (result.errorCode ?? "luckyos_upstream_error");
}

function providerStatus(result: LuckyOsV1Result | LuckyOsV1FileResult) {
	if (result.status === 504) return 504;
	if ([400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 503].includes(result.status)) {
		return result.status;
	}
	return 502;
}

function errorResponse(result: LuckyOsV1Result | LuckyOsV1FileResult) {
	return new Response(JSON.stringify({ error: providerError(result) }), {
		status: providerStatus(result),
		headers: {
			"content-type": "application/json",
			"cache-control": "private, no-store",
		},
	});
}

async function sessionUser(c: Context<{ Variables: { requestId: string } }>) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return session?.user ?? null;
}

async function recordResult(userId: string, result: LuckyOsV1Result | LuckyOsV1FileResult) {
	try {
		await recordLuckyOsHealth(userId, { ok: result.ok, status: result.status });
	} catch {
		// The provider command remains authoritative if the secondary health write fails.
	}
}

async function request(
	userId: string,
	args: Omit<Parameters<typeof luckyOsV1EmployeeFetch>[0], "userId">,
) {
	const result = await luckyOsV1EmployeeFetch({ ...args, userId });
	await recordResult(userId, result);
	return result;
}

function publicDocument(document: z.infer<typeof employeeDocumentSchema>) {
	return {
		id: document.id,
		type: document.type ?? "other",
		fileName: document.file_name ?? "—",
		fileType: document.file_type ?? null,
		fileSizeBytes: document.file_size_bytes ?? null,
		note: document.note ?? null,
		reviewStatus: document.review_status ?? "unknown",
		reviewNote: document.review_note ?? null,
		validFrom: document.valid_from ?? null,
		validUntil: document.valid_until ?? null,
		createdAt: document.created_at ?? null,
		updatedAt: document.updated_at ?? null,
	};
}

function publicExpense(claim: z.infer<typeof expenseClaimSchema>) {
	return {
		id: claim.id,
		title: claim.title ?? "—",
		amount: claim.amount,
		currency: claim.currency,
		amountCzk: claim.amount_czk,
		exchangeRate: claim.exchange_rate,
		date: claim.date,
		paymentSource: claim.payment_source,
		category: claim.category,
		note: claim.note,
		reimbursementSource: claim.reimbursement_source,
		status: claim.status ?? "unknown",
		reviewerNote: claim.reviewer_note,
		reimbursedAt: claim.reimbursed_at,
		receipt: {
			fileName: claim.receipt.file_name,
			mimeType: claim.receipt.mime_type,
		},
		createdAt: claim.created_at,
		updatedAt: claim.updated_at,
	};
}

function publicContract(contract: z.infer<typeof contractSchema>) {
	return {
		id: contract.id,
		version: contract.version,
		type: contract.type ?? "unknown",
		title: contract.title ?? "—",
		validFrom: contract.valid_from,
		validUntil: contract.valid_until,
		status: contract.status ?? "unknown",
		workflowStatus: contract.workflow_status ?? "unknown",
		signedDate: contract.signed_date,
		fileName: contract.file_name,
		lockedAt: contract.locked_at,
		canSign:
			contract.type === "dpp" &&
			contract.workflow_status === "sent_to_employee" &&
			!contract.locked_at &&
			!contract.final_pdf_sha256,
		updatedAt: contract.updated_at,
	};
}

function publicPublished(document: z.infer<typeof publishedDocumentSchema>) {
	return {
		id: document.id,
		documentType: document.document_type,
		periodYear: document.period_year ?? null,
		periodMonth: document.period_month ?? null,
		title: document.title,
		version: document.version,
		fileName: document.file_name,
		mimeType: document.mime_type,
		sizeBytes: document.size_bytes,
		publishedAt: document.published_at,
		updatedAt: document.updated_at,
	};
}

function safeFileName(raw: string) {
	const normalized = raw
		.normalize("NFKC")
		.split("")
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 || character === "/" || character === "\\" ? " " : character;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	return (normalized || "employee-file").slice(0, 255);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
	return signature.every((value, index) => bytes[index] === value);
}

function isUtf8(bytes: Uint8Array) {
	if (bytes.slice(0, 4096).includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 4096));
		return true;
	} catch {
		return false;
	}
}

function verifiedMime(bytes: Uint8Array, fileName: string): string | null {
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".pdf") && startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
		return "application/pdf";
	}
	if (
		(lower.endsWith(".jpg") || lower.endsWith(".jpeg")) &&
		startsWith(bytes, [0xff, 0xd8, 0xff])
	) {
		return "image/jpeg";
	}
	if (lower.endsWith(".png") && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])) {
		return "image/png";
	}
	if (lower.endsWith(".gif") && startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
		return "image/gif";
	}
	if (
		lower.endsWith(".webp") &&
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
	) {
		return "image/webp";
	}
	const brand = String.fromCharCode(...bytes.slice(8, 12));
	if (
		startsWith(bytes.slice(4), [0x66, 0x74, 0x79, 0x70]) &&
		["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand) &&
		(lower.endsWith(".heic") || lower.endsWith(".heif"))
	) {
		return lower.endsWith(".heif") ? "image/heif" : "image/heic";
	}
	if (
		startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) &&
		lower.endsWith(".doc")
	) {
		return "application/msword";
	}
	if (startsWith(bytes, [0x50, 0x4b])) {
		if (lower.endsWith(".docx")) {
			return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
		}
		if (lower.endsWith(".xlsx")) {
			return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
		}
	}
	if (!isUtf8(bytes)) return null;
	if (lower.endsWith(".csv")) return "text/csv";
	if (lower.endsWith(".xml")) {
		const text = new TextDecoder()
			.decode(bytes.slice(0, 4096))
			.replace(/^\uFEFF/, "")
			.trimStart();
		return text.startsWith("<") ? "application/xml" : null;
	}
	if (lower.endsWith(".txt")) return "text/plain";
	return null;
}

export async function uploadEmployeeFile(args: {
	userId: string;
	operationId: string;
	purpose: "expense_receipt" | "person_document" | "lifecycle_document";
	file: File;
}) {
	const fileName = safeFileName(args.file.name);
	const bytes = new Uint8Array(await args.file.arrayBuffer());
	const mimeType = verifiedMime(bytes, fileName);
	if (!mimeType)
		return {
			ok: false as const,
			localError: "employee_file_type_not_allowed",
			status: 415,
		};
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const intent = await request(args.userId, {
		scopes: ["files:write"],
		pathSuffix: "/upload-intents",
		method: "POST",
		idempotencyKey: `watson:${args.userId}:${args.operationId}:upload`,
		body: {
			purpose: args.purpose,
			file_name: fileName,
			mime_type: mimeType,
			file_size_bytes: bytes.byteLength,
			file_sha256: sha256,
		},
	});
	if (!intent.ok) return { ok: false as const, result: intent };
	const parsedIntent = uploadIntentEnvelope.safeParse(intent.data);
	if (
		!parsedIntent.success ||
		parsedIntent.data.upload.purpose !== args.purpose ||
		parsedIntent.data.upload.file_name !== fileName ||
		parsedIntent.data.upload.mime_type !== mimeType ||
		parsedIntent.data.upload.size_bytes !== bytes.byteLength ||
		parsedIntent.data.upload.sha256 !== sha256 ||
		parsedIntent.data.upload_url !==
			`/api/integrations/watson/v1/uploads/${parsedIntent.data.upload.id}/content`
	) {
		return {
			ok: false as const,
			localError: "luckyos_contract_rejected",
			status: 502,
		};
	}
	const upload = await luckyOsV1EmployeeUpload({
		userId: args.userId,
		uploadId: parsedIntent.data.upload.id,
		bytes,
		correlationId: intent.correlationId,
	});
	await recordResult(args.userId, upload);
	if (!upload.ok && upload.status !== 409) return { ok: false as const, result: upload };
	if (upload.ok) {
		const parsedUpload = uploadedFileEnvelope.safeParse(upload.data);
		if (
			!parsedUpload.success ||
			parsedUpload.data.upload.id !== parsedIntent.data.upload.id ||
			parsedUpload.data.upload.sha256 !== sha256 ||
			parsedUpload.data.upload.size_bytes !== bytes.byteLength ||
			!["uploaded", "attached", "consumed"].includes(parsedUpload.data.upload.status)
		) {
			return {
				ok: false as const,
				localError: "luckyos_contract_rejected",
				status: 502,
			};
		}
	}
	return { ok: true as const, uploadId: parsedIntent.data.upload.id };
}

function formText(form: FormData, key: string) {
	const value = form.get(key);
	return typeof value === "string" ? value : "";
}

function optionalFormText(form: FormData, key: string) {
	const value = formText(form, key).trim();
	return value || null;
}

function localUploadError(error: { localError: string; status: number }) {
	return new Response(JSON.stringify({ error: error.localError }), {
		status: error.status,
		headers: {
			"content-type": "application/json",
			"cache-control": "private, no-store",
		},
	});
}

export const employeeFileRoutes = new Hono<{
	Variables: { requestId: string };
}>();

employeeFileRoutes.use("/api/employee/self-service/*", async (c, next) => {
	await next();
	c.header("Cache-Control", "private, no-store, max-age=0");
});

employeeFileRoutes.get("/api/employee/self-service/documents", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const [documentsResult, publishedResult] = await Promise.all([
		request(user.id, {
			scopes: ["documents:read"],
			pathSuffix: "/documents?limit=100",
		}),
		request(user.id, {
			scopes: ["documents:read"],
			pathSuffix: "/published-documents?limit=100",
		}),
	]);
	if (!documentsResult.ok) return errorResponse(documentsResult);
	if (!publishedResult.ok) return errorResponse(publishedResult);
	const documents = documentListEnvelope.safeParse(documentsResult.data);
	const published = publishedEnvelope.safeParse(publishedResult.data);
	if (!documents.success || !published.success)
		return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({
		documents: documents.data.documents.map(publicDocument),
		publishedDocuments: published.data.data.documents
			.filter((item) => !item.withdrawn_at)
			.map(publicPublished),
		fetchedAt: new Date().toISOString(),
	});
});

employeeFileRoutes.post("/api/employee/self-service/documents", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const form = await c.req.formData().catch(() => null);
	const file = form?.get("file");
	if (!form || !(file instanceof File) || file.size < 1 || file.size > EMPLOYEE_FILE_MAX_BYTES) {
		return c.json(
			{
				error:
					file instanceof File && file.size > EMPLOYEE_FILE_MAX_BYTES
						? "employee_file_too_large"
						: "invalid_employee_document",
			},
			file instanceof File && file.size > EMPLOYEE_FILE_MAX_BYTES ? 413 : 422,
		);
	}
	const parsed = documentFormSchema.safeParse({
		operationId: formText(form, "operationId"),
		type: formText(form, "type"),
		note: optionalFormText(form, "note"),
		validFrom: optionalFormText(form, "validFrom"),
		validUntil: optionalFormText(form, "validUntil"),
	});
	if (!parsed.success) return c.json({ error: "invalid_employee_document" }, 422);
	const upload = await uploadEmployeeFile({
		userId: user.id,
		operationId: parsed.data.operationId,
		purpose: "person_document",
		file,
	});
	if (!upload.ok) {
		if (upload.result) return errorResponse(upload.result);
		return localUploadError({
			localError: upload.localError ?? "employee_file_upload_failed",
			status: upload.status ?? 502,
		});
	}
	const result = await request(user.id, {
		scopes: ["documents:write"],
		pathSuffix: "/documents",
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}:document`,
		body: {
			id: parsed.data.operationId,
			upload_id: upload.uploadId,
			type: parsed.data.type,
			note: parsed.data.note,
			valid_from: parsed.data.validFrom,
			valid_until: parsed.data.validUntil,
		},
	});
	if (!result.ok) return errorResponse(result);
	const command = documentCommandEnvelope.safeParse(result.data);
	if (!command.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	const projected = employeeDocumentSchema.safeParse(command.data.document);
	if (!projected.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json(
		{
			document: publicDocument(projected.data),
			replayed: command.data.idempotency_replayed,
		},
		201,
	);
});

employeeFileRoutes.get("/api/employee/self-service/expenses", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const [result, projectsResult] = await Promise.all([
		request(user.id, {
			scopes: ["expenses:read"],
			pathSuffix: "/expense-claims?limit=100",
		}),
		request(user.id, {
			scopes: ["trainer-projects:read"],
			pathSuffix: "/trainer-projects?limit=100",
		}),
	]);
	if (!result.ok) return errorResponse(result);
	if (!projectsResult.ok) return errorResponse(projectsResult);
	const claims = expenseListEnvelope.safeParse(result.data);
	const projects = trainerProjectsEnvelope.safeParse(projectsResult.data);
	if (!claims.success || !projects.success)
		return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({
		claims: claims.data.claims.map(publicExpense),
		trainerProjects: projects.data.data.projects.map((project) => ({
			id: project.id,
			name: project.name ?? "—",
			status: project.status ?? "unknown",
			reviewStatus: project.review_status ?? "unknown",
		})),
		fetchedAt: new Date().toISOString(),
	});
});

employeeFileRoutes.post("/api/employee/self-service/expenses", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const form = await c.req.formData().catch(() => null);
	const file = form?.get("file");
	if (!form || !(file instanceof File) || file.size < 1 || file.size > EMPLOYEE_FILE_MAX_BYTES) {
		return c.json(
			{
				error:
					file instanceof File && file.size > EMPLOYEE_FILE_MAX_BYTES
						? "employee_file_too_large"
						: "invalid_employee_expense",
			},
			file instanceof File && file.size > EMPLOYEE_FILE_MAX_BYTES ? 413 : 422,
		);
	}
	const parsed = expenseFormSchema.safeParse({
		operationId: formText(form, "operationId"),
		title: formText(form, "title"),
		amount: formText(form, "amount"),
		currency: formText(form, "currency"),
		exchangeRate: optionalFormText(form, "exchangeRate"),
		date: formText(form, "date"),
		paymentSource: formText(form, "paymentSource"),
		category: formText(form, "category"),
		note: optionalFormText(form, "note"),
		reimbursementSource: formText(form, "reimbursementSource"),
		trainerProjectId: optionalFormText(form, "trainerProjectId"),
	});
	if (!parsed.success) return c.json({ error: "invalid_employee_expense" }, 422);
	const amountCzk = Math.round(parsed.data.amount * (parsed.data.exchangeRate ?? 1));
	if (amountCzk < 1 || amountCzk > 100_000_000)
		return c.json({ error: "invalid_employee_expense" }, 422);
	const upload = await uploadEmployeeFile({
		userId: user.id,
		operationId: parsed.data.operationId,
		purpose: "expense_receipt",
		file,
	});
	if (!upload.ok) {
		if (upload.result) return errorResponse(upload.result);
		return localUploadError({
			localError: upload.localError ?? "employee_file_upload_failed",
			status: upload.status ?? 502,
		});
	}
	const result = await request(user.id, {
		scopes: ["expenses:write"],
		pathSuffix: "/expense-claims",
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}:expense`,
		body: {
			id: parsed.data.operationId,
			upload_id: upload.uploadId,
			title: parsed.data.title,
			amount: parsed.data.amount,
			currency: parsed.data.currency,
			amount_czk: amountCzk,
			exchange_rate: parsed.data.exchangeRate,
			date: parsed.data.date,
			payment_source: parsed.data.paymentSource,
			category: parsed.data.category,
			note: parsed.data.note,
			reimbursement_source: parsed.data.reimbursementSource,
			trainer_project_id: parsed.data.trainerProjectId,
		},
	});
	if (!result.ok) return errorResponse(result);
	const command = expenseCommandEnvelope.safeParse(result.data);
	if (!command.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	const projected = expenseClaimSchema.safeParse(command.data.claim);
	if (!projected.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json(
		{
			claim: publicExpense(projected.data),
			replayed: command.data.idempotency_replayed,
		},
		201,
	);
});

employeeFileRoutes.get("/api/employee/self-service/contracts", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const result = await request(user.id, {
		scopes: ["contracts:read"],
		pathSuffix: "/contracts?limit=100",
	});
	if (!result.ok) return errorResponse(result);
	const contracts = contractEnvelope.safeParse(result.data);
	if (!contracts.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({
		contracts: contracts.data.data.contracts.map(publicContract),
		fetchedAt: new Date().toISOString(),
	});
});

employeeFileRoutes.post("/api/employee/self-service/contracts/sign", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const parsed = contractSignInput.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_contract_signature" }, 422);
	const result = await request(user.id, {
		scopes: ["contracts:write"],
		pathSuffix: `/contracts/${encodeURIComponent(parsed.data.contractId)}/sign`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}:contract`,
		body: {
			expected_version: parsed.data.expectedVersion,
			full_name: parsed.data.fullName,
			birth_date: parsed.data.birthDate,
			...(parsed.data.bankAccountSuffix
				? { bank_account_suffix: parsed.data.bankAccountSuffix }
				: {}),
			signature_data_url: parsed.data.signatureDataUrl,
		},
	});
	if (!result.ok) return errorResponse(result);
	const command = contractCommandEnvelope.safeParse(result.data);
	if (!command.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	const contract = contractSchema.safeParse(command.data.contract);
	if (!contract.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({
		contract: publicContract(contract.data),
		replayed: command.data.idempotency_replayed,
	});
});

employeeFileRoutes.get("/api/employee/self-service/published-documents/:id/content", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const documentId = z.string().uuid().safeParse(c.req.param("id"));
	if (!documentId.success) return c.json({ error: "invalid_published_document" }, 422);
	const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
	const result = await luckyOsV1PublishedDocument({
		userId: user.id,
		documentId: documentId.data,
		disposition,
	});
	await recordResult(user.id, result);
	if (!result.ok || !result.bytes || !result.mimeType) return errorResponse(result);
	return new Response(Buffer.from(result.bytes), {
		status: 200,
		headers: {
			"content-type": result.mimeType,
			"content-length": String(result.bytes.byteLength),
			"content-disposition": `${disposition}; filename="employee-document${result.mimeType === "application/pdf" ? ".pdf" : ""}"`,
			"cache-control": "private, no-store, max-age=0",
		},
	});
});
