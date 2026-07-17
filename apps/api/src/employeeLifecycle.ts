/**
 * Online-only LuckyOS onboarding/offboarding facade.
 *
 * LuckyOS remains the HR system of record. Watson exposes a bounded public
 * projection and sends explicit, idempotent employee responses; it never stores
 * lifecycle answers, HR payloads or uploaded lifecycle documents locally.
 */
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { EMPLOYEE_FILE_MAX_BYTES, uploadEmployeeFile } from "./employeeFiles";
import { env } from "./env";
import { isLuckyOsRevoked, recordLuckyOsHealth } from "./integrations";
import {
	type LuckyOsV1FileResult,
	type LuckyOsV1Result,
	luckyOsV1EmployeeFetch,
} from "./luckyOsV1";

const operationId = z.string().uuid();
const lifecycleType = z.enum(["onboarding", "offboarding"]);
const lifecycleStatus = z.enum([
	"invited",
	"in_progress",
	"submitted",
	"needs_changes",
	"completed",
	"cancelled",
]);
const responseType = z.enum([
	"confirmation",
	"text",
	"form",
	"consent",
	"decline",
	"question",
]);
const itemKey = z.string().trim().min(1).max(160);
const timestamp = z.string().datetime({ offset: true });

const lifecycleInstanceSchema = z
	.object({
		id: z.string().uuid(),
		lifecycle_type: lifecycleType,
		status: lifecycleStatus,
		title: z.string().trim().min(1).max(240),
		public_payload: z.record(z.string(), z.unknown()),
		required_item_keys: z.array(itemKey).min(1).max(100),
		completed_item_keys: z.array(itemKey).max(100),
		due_at: timestamp.nullable(),
		submitted_at: timestamp.nullable(),
		completed_at: timestamp.nullable(),
		cancelled_at: timestamp.nullable(),
		version: z.number().int().positive(),
		created_at: timestamp,
		updated_at: timestamp,
	})
	.passthrough()
	.superRefine((value, context) => {
		const required = new Set(value.required_item_keys);
		if (required.size !== value.required_item_keys.length) {
			context.addIssue({ code: "custom", path: ["required_item_keys"], message: "duplicate_keys" });
		}
		if (new Set(value.completed_item_keys).size !== value.completed_item_keys.length) {
			context.addIssue({ code: "custom", path: ["completed_item_keys"], message: "duplicate_keys" });
		}
		for (const key of value.completed_item_keys) {
			if (!required.has(key)) {
				context.addIssue({ code: "custom", path: ["completed_item_keys"], message: "unknown_key" });
			}
		}
	});

const lifecycleEnvelope = z
	.object({
		resource: lifecycleType,
		data: z.object({ instances: z.array(lifecycleInstanceSchema).max(100) }).strict(),
	})
	.passthrough();

const itemMetadata = z
	.object({
		key: itemKey,
		label: z.string().trim().min(1).max(200),
		description: z.string().trim().min(1).max(1_000).nullable().optional(),
		response_type: z
			.enum(["confirmation", "text", "form", "file", "consent", "decline", "question"])
			.optional(),
	})
	.strict();
const publicMetadata = z.object({ items: z.array(itemMetadata).max(100).optional() }).passthrough();

const jsonResponseInput = z
	.object({
		operationId,
		lifecycleType,
		lifecycleId: z.string().uuid(),
		expectedVersion: z.number().int().positive(),
		itemKey,
		responseType,
		value: z.string().trim().max(5_000).nullable(),
		confirmed: z.boolean(),
	})
	.strict()
	.superRefine((value, context) => {
		if (["confirmation", "consent"].includes(value.responseType) && !value.confirmed) {
			context.addIssue({ code: "custom", path: ["confirmed"], message: "confirmation_required" });
		}
		if (
			["text", "form", "decline", "question"].includes(value.responseType) &&
			!value.value
		) {
			context.addIssue({ code: "custom", path: ["value"], message: "value_required" });
		}
	});

const fileResponseInput = z
	.object({
		operationId,
		lifecycleType,
		lifecycleId: z.string().uuid(),
		expectedVersion: z.coerce.number().int().positive(),
		itemKey,
	})
	.strict();

const commandEnvelope = z
	.object({
		entity_type: z.enum(["onboarding_instance", "offboarding_instance"]),
		entity: lifecycleInstanceSchema,
		idempotency_replayed: z.boolean(),
	})
	.passthrough();

const SAFE_PROVIDER_ERRORS = new Set([
	"domain_target_not_found",
	"domain_version_or_state_conflict",
	"file_malware_detected",
	"file_scan_unavailable",
	"file_storage_unavailable",
	"file_upload_mismatch",
	"idempotency_conflict",
	"insufficient_scope",
	"invalid_domain_command",
	"invalid_file_upload",
	"rate_limited",
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
		headers: { "content-type": "application/json", "cache-control": "private, no-store" },
	});
}

async function sessionUser(c: Context<{ Variables: { requestId: string } }>) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return session?.user ?? null;
}

async function request(
	userId: string,
	args: Omit<Parameters<typeof luckyOsV1EmployeeFetch>[0], "userId">,
) {
	const result = await luckyOsV1EmployeeFetch({ ...args, userId });
	try {
		await recordLuckyOsHealth(userId, { ok: result.ok, status: result.status });
	} catch {
		// LuckyOS remains authoritative even when secondary health storage is unavailable.
	}
	return result;
}

const COMMON_LABELS: Record<string, string> = {
	personal_details: "Osobní údaje",
	bank_account: "Bankovní účet",
	tax_declaration: "Daňové prohlášení",
	contract: "Pracovní smlouva",
	health_and_safety: "Bezpečnost práce",
	equipment: "Vybavení",
	access_return: "Vrácení přístupů",
	equipment_return: "Vrácení vybavení",
	handover: "Předání práce",
};

function fallbackLabel(key: string) {
	if (COMMON_LABELS[key]) return COMMON_LABELS[key];
	const normalized = key.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
	return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : key;
}

function publicLifecycle(instance: z.infer<typeof lifecycleInstanceSchema>) {
	const parsedMetadata = publicMetadata.safeParse(instance.public_payload);
	const metadata = new Map(
		(parsedMetadata.success ? (parsedMetadata.data.items ?? []) : []).map((item) => [item.key, item]),
	);
	const completed = new Set(instance.completed_item_keys);
	return {
		id: instance.id,
		type: instance.lifecycle_type,
		status: instance.status,
		title: instance.title,
		items: instance.required_item_keys.map((key) => {
			const item = metadata.get(key);
			return {
				key,
				label: item?.label ?? fallbackLabel(key),
				description: item?.description ?? null,
				suggestedResponseType: item?.response_type ?? "confirmation",
				completed: completed.has(key),
			};
		}),
		completedCount: instance.completed_item_keys.length,
		totalCount: instance.required_item_keys.length,
		dueAt: instance.due_at,
		submittedAt: instance.submitted_at,
		completedAt: instance.completed_at,
		cancelledAt: instance.cancelled_at,
		version: instance.version,
		createdAt: instance.created_at,
		updatedAt: instance.updated_at,
	};
}

function responsePayload(input: z.infer<typeof jsonResponseInput>) {
	switch (input.responseType) {
		case "confirmation":
			return { confirmed: true };
		case "consent":
			return { consented: true };
		case "text":
			return { text: input.value };
		case "form":
			return { value: input.value };
		case "question":
			return { question: input.value };
		case "decline":
			return { reason: input.value };
	}
}

function validateCommandResult(
	data: unknown,
	expected: { lifecycleType: z.infer<typeof lifecycleType>; lifecycleId: string; expectedVersion: number },
) {
	const parsed = commandEnvelope.safeParse(data);
	if (
		!parsed.success ||
		parsed.data.entity_type !== `${expected.lifecycleType}_instance` ||
		parsed.data.entity.id !== expected.lifecycleId ||
		parsed.data.entity.lifecycle_type !== expected.lifecycleType ||
		parsed.data.entity.version <= expected.expectedVersion
	) {
		return null;
	}
	return parsed.data;
}

function formText(form: FormData, key: string) {
	const value = form.get(key);
	return typeof value === "string" ? value : "";
}

export const employeeLifecycleRoutes = new Hono<{ Variables: { requestId: string } }>();

employeeLifecycleRoutes.use("/api/employee/self-service/*", async (c, next) => {
	await next();
	c.header("Cache-Control", "private, no-store, max-age=0");
});

employeeLifecycleRoutes.get("/api/employee/self-service/lifecycle", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const [onboardingResult, offboardingResult] = await Promise.all([
		request(user.id, {
			scopes: ["onboarding:read"],
			pathSuffix: "/onboarding?limit=100&include_closed=true",
		}),
		request(user.id, {
			scopes: ["offboarding:read"],
			pathSuffix: "/offboarding?limit=100&include_closed=true",
		}),
	]);
	if (!onboardingResult.ok) return errorResponse(onboardingResult);
	if (!offboardingResult.ok) return errorResponse(offboardingResult);
	const onboarding = lifecycleEnvelope.safeParse(onboardingResult.data);
	const offboarding = lifecycleEnvelope.safeParse(offboardingResult.data);
	if (
		!onboarding.success ||
		onboarding.data.resource !== "onboarding" ||
		!offboarding.success ||
		offboarding.data.resource !== "offboarding"
	) {
		return c.json({ error: "luckyos_contract_rejected" }, 502);
	}
	return c.json({
		instances: [...onboarding.data.data.instances, ...offboarding.data.data.instances]
			.map(publicLifecycle)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
		fetchedAt: new Date().toISOString(),
	});
});

employeeLifecycleRoutes.post("/api/employee/self-service/lifecycle/respond", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const parsed = jsonResponseInput.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_lifecycle_response" }, 422);
	const result = await request(user.id, {
		scopes: [`${parsed.data.lifecycleType}:write`],
		pathSuffix: `/${parsed.data.lifecycleType}/${parsed.data.lifecycleId}/commands`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}:lifecycle`,
		body: {
			command: "lifecycle.respond",
			expected_version: parsed.data.expectedVersion,
			item_key: parsed.data.itemKey,
			response_type: parsed.data.responseType,
			response: responsePayload(parsed.data),
		},
	});
	if (!result.ok) return errorResponse(result);
	const command = validateCommandResult(result.data, parsed.data);
	if (!command) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({ instance: publicLifecycle(command.entity), replayed: command.idempotency_replayed });
});

employeeLifecycleRoutes.post("/api/employee/self-service/lifecycle/respond-file", async (c) => {
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
						: "invalid_lifecycle_response",
			},
			file instanceof File && file.size > EMPLOYEE_FILE_MAX_BYTES ? 413 : 422,
		);
	}
	const parsed = fileResponseInput.safeParse({
		operationId: formText(form, "operationId"),
		lifecycleType: formText(form, "lifecycleType"),
		lifecycleId: formText(form, "lifecycleId"),
		expectedVersion: formText(form, "expectedVersion"),
		itemKey: formText(form, "itemKey"),
	});
	if (!parsed.success) return c.json({ error: "invalid_lifecycle_response" }, 422);
	const upload = await uploadEmployeeFile({
		userId: user.id,
		operationId: parsed.data.operationId,
		purpose: "lifecycle_document",
		file,
	});
	if (!upload.ok) {
		if ("result" in upload && upload.result) return errorResponse(upload.result);
		return c.json(
			{ error: ("localError" in upload && upload.localError) || "employee_file_upload_failed" },
			("status" in upload && upload.status ? upload.status : 502) as 413 | 415 | 502,
		);
	}
	const result = await request(user.id, {
		scopes: [`${parsed.data.lifecycleType}:write`],
		pathSuffix: `/${parsed.data.lifecycleType}/${parsed.data.lifecycleId}/commands`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}:lifecycle`,
		body: {
			command: "lifecycle.respond",
			expected_version: parsed.data.expectedVersion,
			item_key: parsed.data.itemKey,
			response_type: "file",
			response: { upload_id: upload.uploadId },
		},
	});
	if (!result.ok) return errorResponse(result);
	const command = validateCommandResult(result.data, parsed.data);
	if (!command) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({ instance: publicLifecycle(command.entity), replayed: command.idempotency_replayed });
});
