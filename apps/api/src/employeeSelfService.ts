/**
 * LuckyOS v1 employee self-service facade.
 *
 * Browser payloads are strict Watson commands. Provider person IDs, scopes and
 * error messages never cross the boundary; every provider response is parsed
 * and projected through an explicit allowlist before it reaches the client.
 */
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { env } from "./env";
import {
	isLuckyOsRevoked,
	type LuckyResult,
	recordLuckyOsHealth,
} from "./integrations";
import { type LuckyOsV1Result, luckyOsV1EmployeeFetch } from "./luckyOsV1";

const operationId = z.string().uuid();
const period = z.string().regex(/^(20[2-9][0-9]|2100)-(0[1-9]|1[0-2])$/);
const isoDate = z.string().date();
const finiteVersion = z.number().int().nonnegative();
const nullableText = (max: number) => z.string().max(max).nullable().optional();

const baseEntity = {
	id: z.string().min(1).max(255),
	version: z.number().int().positive(),
	created_at: nullableText(64),
	updated_at: nullableText(64),
};

const profileSchema = z
	.object({
		...baseEntity,
		name: nullableText(200),
		person_type: nullableText(100),
		email: nullableText(180),
		phone: nullableText(40),
		address: nullableText(300),
		bank_account: nullableText(60),
		is_active: z.boolean().nullable().optional(),
	})
	.passthrough();

const profileRequestSchema = z
	.object({
		...baseEntity,
		patch: z.record(z.string(), z.unknown()),
		field_decisions: z.record(z.string(), z.unknown()).optional(),
		status: nullableText(40),
		reviewer_note: nullableText(2_000),
		reviewed_at: nullableText(64),
	})
	.passthrough();

const attendanceRecordSchema = z
	.object({
		...baseEntity,
		date: z.string().date().nullable(),
		activity_type: z.enum(["training", "small_numbers", "other"]).nullable(),
		hours: z.number().finite().positive().max(12).nullable(),
		note: z.string().max(2_000).nullable(),
	})
	.passthrough();

const attendanceSubmissionSchema = z
	.object({
		...baseEntity,
		period_month: z.number().int().min(1).max(12).nullable(),
		period_year: z.number().int().min(2020).max(2100).nullable(),
		status: nullableText(40),
		submitted_at: nullableText(64),
		reviewed_at: nullableText(64),
		reviewer_note: nullableText(2_000),
		employee_note: nullableText(2_000),
		locked_totals_by_activity: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const choreographySchema = z
	.object({
		...baseEntity,
		name: nullableText(200),
		status: nullableText(40),
		type: nullableText(80),
		trainer_ids: z.array(z.string()).max(100).optional(),
	})
	.passthrough();

const smallNumberSchema = z
	.object({
		...baseEntity,
		choreography_id: nullableText(128),
		choreography_name: nullableText(200),
		period_month: z.number().int().min(1).max(12).nullable(),
		period_year: z.number().int().min(2020).max(2100).nullable(),
		hours_minutes: z.number().int().nonnegative().max(24 * 60).nullable(),
		note: nullableText(1_000),
		status: nullableText(40),
		reviewer_note: nullableText(2_000),
	})
	.passthrough();

const workItemSchema = z
	.object({
		id: z.string().uuid(),
		source_key: z.string().max(255),
		source_type: z.string().max(160),
		source_id: z.string().max(255).nullable(),
		kind: z.string().max(160),
		direction: z.enum(["employer_to_employee", "employee_to_employer"]),
		title: z.string().max(200),
		priority: z.enum(["low", "normal", "high", "urgent"]),
		required_response: z.array(z.string().max(64)).max(10),
		action: z.record(z.string(), z.unknown()),
		status: z.string().max(40),
		due_at: z.string().datetime({ offset: true }).nullable(),
		acknowledged_at: nullableText(64),
		submitted_at: nullableText(64),
		closed_at: nullableText(64),
		version: z.number().int().positive(),
		created_at: z.string().datetime({ offset: true }),
		updated_at: z.string().datetime({ offset: true }),
	})
	.strict();

const profileEnvelope = z
	.object({
		resource: z.literal("profile"),
		data: z.object({ profile: profileSchema }).passthrough(),
	})
	.passthrough();
const profileRequestsEnvelope = z
	.object({
		resource: z.literal("profile-change-requests"),
		data: z.object({ requests: z.array(profileRequestSchema).max(100) }).passthrough(),
	})
	.passthrough();
const attendanceEnvelope = z
	.object({
		resource: z.literal("attendance"),
		data: z
			.object({
				records: z.array(attendanceRecordSchema).max(366),
				submissions: z.array(attendanceSubmissionSchema).max(36),
			})
			.passthrough(),
	})
	.passthrough();
const smallNumbersEnvelope = z
	.object({
		resource: z.literal("small-numbers"),
		data: z
			.object({
				choreographies: z.array(choreographySchema).max(500),
				entries: z.array(smallNumberSchema).max(100),
			})
			.passthrough(),
	})
	.passthrough();
const workItemsEnvelope = z
	.object({ items: z.array(workItemSchema).max(100), next_cursor: z.string().max(500).nullable() })
	.passthrough();

const commandEnvelope = z
	.object({
		entity_type: z.string().min(1).max(160),
		entity: z.record(z.string(), z.unknown()),
		idempotency_replayed: z.boolean(),
	})
	.passthrough();

const profileChangeInput = z
	.object({
		operationId,
		patch: z
			.object({
				email: z.string().email().max(180).nullable().optional(),
				phone: z.string().trim().max(40).nullable().optional(),
				bankAccount: z.string().trim().max(60).nullable().optional(),
				address: z.string().trim().max(300).nullable().optional(),
			})
			.strict(),
	})
	.strict()
	.refine(
		(value) => Object.values(value.patch).some((entry) => entry != null && entry !== ""),
		{ message: "empty_patch" },
	);

const attendanceInput = z
	.object({
		operationId,
		period,
		expectedVersion: finiteVersion,
		action: z.enum(["save_draft", "submit"]),
		records: z
			.array(
				z
					.object({
						id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/),
						date: isoDate,
						activityType: z.enum(["training", "small_numbers", "other"]),
						hours: z.number().finite().positive().max(12),
						note: z.string().trim().min(1).max(2_000),
					})
					.strict(),
			)
			.max(200),
	})
	.strict()
	.superRefine((input, context) => {
		if (input.action === "submit" && input.records.length === 0) {
			context.addIssue({ code: "custom", path: ["records"], message: "records_required" });
		}
		if (new Set(input.records.map((row) => row.id)).size !== input.records.length) {
			context.addIssue({ code: "custom", path: ["records"], message: "duplicate_record" });
		}
		for (const [index, row] of input.records.entries()) {
			if (!row.date.startsWith(input.period)) {
				context.addIssue({ code: "custom", path: ["records", index, "date"], message: "period_mismatch" });
			}
		}
	});

const smallNumberInput = z
	.object({
		operationId,
		period,
		expectedVersion: finiteVersion,
		choreographyId: z.string().trim().min(1).max(128),
		hoursMinutes: z
			.number()
			.int()
			.nonnegative()
			.max(24 * 60)
			.refine((value) => [0, 15, 20, 30, 40, 45].includes(value % 60)),
		note: z.string().trim().max(1_000).nullable().optional(),
		status: z.enum(["draft", "submitted"]),
	})
	.strict();

const SAFE_PROVIDER_ERRORS = new Set([
	"access_denied",
	"access_revoked",
	"agenda_read_channel_mismatch",
	"agenda_write_channel_mismatch",
	"domain_target_not_found",
	"domain_version_or_state_conflict",
	"employee_not_found",
	"insufficient_scope",
	"invalid_domain_command",
	"rate_limited",
	"resource_not_supported",
]);

function safeProviderError(result: LuckyOsV1Result) {
	const root = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
	const nested = root.error && typeof root.error === "object"
		? root.error as Record<string, unknown>
		: {};
	const upstream = typeof nested.code === "string" ? nested.code : null;
	return upstream && SAFE_PROVIDER_ERRORS.has(upstream)
		? upstream
		: result.errorCode ?? "luckyos_upstream_error";
}

function safeProviderStatus(result: LuckyOsV1Result) {
	if (result.status === 504) return 504;
	if ([400, 401, 403, 404, 409, 413, 429, 503].includes(result.status)) return result.status;
	return 502;
}

function maskBankAccount(value: string | null | undefined) {
	if (!value) return null;
	const compact = value.replace(/\s+/g, "");
	return compact.length <= 4 ? `••••${compact}` : `•••• ${compact.slice(-4)}`;
}

function publicProfile(profile: z.infer<typeof profileSchema>) {
	return {
		name: profile.name ?? null,
		personType: profile.person_type ?? null,
		email: profile.email ?? null,
		phone: profile.phone ?? null,
		address: profile.address ?? null,
		bankAccountMasked: maskBankAccount(profile.bank_account),
		active: profile.is_active === true,
		version: profile.version,
	};
}

function publicProfileRequest(request: z.infer<typeof profileRequestSchema>) {
	const patch = request.patch;
	return {
		id: request.id,
		version: request.version,
		status: request.status ?? "unknown",
		fields: ["email", "phone", "bank_account", "address"].filter((key) => key in patch),
		reviewerNote: request.reviewer_note ?? null,
		updatedAt: request.updated_at ?? null,
	};
}

function publicAttendance(data: z.infer<typeof attendanceEnvelope>["data"], selectedPeriod: string) {
	const [year, month] = selectedPeriod.split("-").map(Number);
	const submission = data.submissions.find(
		(row) => row.period_year === year && row.period_month === month,
	);
	return {
		period: selectedPeriod,
		expectedVersion: submission?.version ?? 0,
		status: submission?.status ?? "not_started",
		reviewerNote: submission?.reviewer_note ?? null,
		updatedAt: submission?.updated_at ?? null,
		records: data.records
			.filter((row) => row.date?.startsWith(selectedPeriod))
			.map((row) => ({
				id: row.id,
				date: row.date,
				activityType: row.activity_type,
				hours: row.hours,
				note: row.note,
			})),
	};
}

function publicSmallNumbers(data: z.infer<typeof smallNumbersEnvelope>["data"], selectedPeriod: string) {
	const [year, month] = selectedPeriod.split("-").map(Number);
	return {
		period: selectedPeriod,
		choreographies: data.choreographies.map((row) => ({
			id: row.id,
			name: row.name ?? "—",
			status: row.status ?? "unknown",
		})),
		entries: data.entries
			.filter((row) => row.period_year === year && row.period_month === month)
			.map((row) => ({
				id: row.id,
				version: row.version,
				choreographyId: row.choreography_id,
				choreographyName: row.choreography_name,
				hoursMinutes: row.hours_minutes,
				note: row.note ?? null,
				status: row.status ?? "unknown",
				reviewerNote: row.reviewer_note ?? null,
				updatedAt: row.updated_at ?? null,
			})),
	};
}

function publicCommand(data: unknown) {
	const parsed = commandEnvelope.safeParse(data);
	if (!parsed.success) return null;
	const entity = parsed.data.entity;
	return {
		entityType: parsed.data.entity_type,
		entity: {
			id: typeof entity.id === "string" ? entity.id : null,
			status: typeof entity.status === "string" ? entity.status : null,
			version: typeof entity.version === "number" ? entity.version : null,
			period: typeof entity.period === "string" ? entity.period : null,
			savedRecords: typeof entity.saved_records === "number" ? entity.saved_records : null,
		},
		replayed: parsed.data.idempotency_replayed,
	};
}

async function recordResult(userId: string, result: LuckyOsV1Result) {
	try {
		await recordLuckyOsHealth(userId, { ok: result.ok, status: result.status });
	} catch {
		// Provider result remains authoritative even if the secondary health write fails.
	}
}

async function v1Request(
	userId: string,
	args: Omit<Parameters<typeof luckyOsV1EmployeeFetch>[0], "userId">,
) {
	const result = await luckyOsV1EmployeeFetch({ ...args, userId });
	await recordResult(userId, result);
	return result;
}

function resultError(result: LuckyOsV1Result) {
	return new Response(JSON.stringify({ error: safeProviderError(result) }), {
		status: safeProviderStatus(result),
		headers: { "content-type": "application/json", "cache-control": "private, no-store" },
	});
}

async function sessionUser(c: Context<{ Variables: { requestId: string } }>) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return session?.user ?? null;
}

function todayInZone(timezone: string | null | undefined) {
	const format = (timeZone: string) => {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(new Date());
		const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
		return `${value.year}-${value.month}-${value.day}`;
	};
	try {
		return format(timezone ?? "Europe/Prague");
	} catch {
		return format("Europe/Prague");
	}
}

export async function readLuckyOsV1Identity(userId: string) {
	if (await isLuckyOsRevoked(userId)) return { linked: false as const, reason: "luckyos_revoked" };
	const result = await v1Request(userId, {
		scopes: ["profile:read"],
		pathSuffix: "/profile",
	});
	if (!result.ok) {
		return {
			linked: false as const,
			reason: result.status === 403 ? "luckyos_identity_not_linked" : "luckyos_unavailable",
		};
	}
	const parsed = profileEnvelope.safeParse(result.data);
	if (!parsed.success) return { linked: false as const, reason: "luckyos_contract_rejected" };
	return {
		linked: true as const,
		person: { id: null, fullName: parsed.data.data.profile.name ?? null, personType: parsed.data.data.profile.person_type ?? null },
	};
}

function workItemHref(item: z.infer<typeof workItemSchema>) {
	const source = `${item.source_type} ${item.kind}`.toLowerCase();
	if (source.includes("attendance")) return "/zamestnanec#dochazka";
	if (source.includes("small") || source.includes("choreograph")) return "/zamestnanec#mala-cisla";
	if (source.includes("profile")) return "/zamestnanec#profil";
	if (source.includes("document") || source.includes("contract")) return "/zamestnanec#dokumenty";
	return "/zamestnanec";
}

function workItemNotificationType(item: z.infer<typeof workItemSchema>) {
	const source = `${item.source_type} ${item.kind}`.toLowerCase();
	if (source.includes("attendance")) return "attendance_reminder";
	if (source.includes("contract") && source.includes("sign")) return "contract_signature_required";
	if (source.includes("document")) return "missing_document";
	return item.source_type.slice(0, 64) || "employee_action";
}

export async function readLuckyOsV1Status(userId: string): Promise<LuckyResult> {
	if (await isLuckyOsRevoked(userId)) {
		return { ok: false, status: 423, data: null, revoked: true };
	}
	const [profileResult, itemsResult] = await Promise.all([
		v1Request(userId, { scopes: ["profile:read"], pathSuffix: "/profile" }),
		v1Request(userId, {
			scopes: ["work-items:read"],
			pathSuffix: "/work-items?limit=100&status=open,acknowledged,in_progress,needs_changes,rejected",
		}),
	]);
	if (!profileResult.ok || !itemsResult.ok) {
		const failed = !profileResult.ok ? profileResult : itemsResult;
		return { ok: false, status: failed.status, data: null };
	}
	const profile = profileEnvelope.safeParse(profileResult.data);
	const items = workItemsEnvelope.safeParse(itemsResult.data);
	if (!profile.success || !items.success) return { ok: false, status: 422, data: null };
	const person = profile.data.data.profile;
	const blockers = items.data.items.map((item) => ({
		type: workItemNotificationType(item),
		explanation: item.title,
		href: workItemHref(item),
	}));
	if (!person.bank_account) {
		blockers.unshift({
			type: "missing_bank_account",
			explanation: "Doplň bankovní účet pro personální evidenci.",
			href: "/zamestnanec#profil",
		});
	}
	const today = Date.now();
	const countdowns = items.data.items
		.filter((item) => item.due_at)
		.map((item) => ({
			key: item.id,
			label: item.title,
			due: item.due_at?.slice(0, 10) ?? null,
			days_remaining: item.due_at
				? Math.ceil((new Date(item.due_at).getTime() - today) / 86_400_000)
				: null,
			severity:
				item.priority === "urgent"
					? "urgent"
					: item.priority === "high"
						? "warning"
						: "info",
		}));
	return {
		ok: true,
		status: 200,
		data: {
			person: { full_name: person.name ?? undefined, person_type: person.person_type ?? undefined },
			readiness: {
				status: blockers.length === 0 ? "ready" : "blocked",
				blockers,
				missing_documents: [...new Set(items.data.items
					.filter((item) => /document|contract/i.test(`${item.source_type} ${item.kind}`))
					.map(() => "Dokument k doplnění"))],
			},
			deadlines: { computed_countdowns: countdowns },
			notifications: items.data.items.map((item) => ({
				id: item.id,
				type: workItemNotificationType(item),
				title: item.title,
				href: workItemHref(item),
				due: item.due_at?.slice(0, 10) ?? null,
				is_read: item.status !== "open",
			})),
		},
	};
}

export const employeeSelfServiceRoutes = new Hono<{ Variables: { requestId: string } }>();

employeeSelfServiceRoutes.use("/api/employee/self-service/*", async (c, next) => {
	await next();
	c.header("Cache-Control", "private, no-store, max-age=0");
});

employeeSelfServiceRoutes.get("/api/employee/self-service/profile", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const [profileResult, requestsResult] = await Promise.all([
		v1Request(user.id, { scopes: ["profile:read"], pathSuffix: "/profile" }),
		v1Request(user.id, {
			scopes: ["profile:read"],
			pathSuffix: "/profile-change-requests?limit=50",
		}),
	]);
	if (!profileResult.ok) return resultError(profileResult);
	if (!requestsResult.ok) return resultError(requestsResult);
	const profile = profileEnvelope.safeParse(profileResult.data);
	const requests = profileRequestsEnvelope.safeParse(requestsResult.data);
	if (!profile.success || !requests.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({
		profile: publicProfile(profile.data.data.profile),
		requests: requests.data.data.requests.map(publicProfileRequest),
		fetchedAt: new Date().toISOString(),
	});
});

employeeSelfServiceRoutes.post("/api/employee/self-service/profile-change", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	const parsed = profileChangeInput.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_profile_change" }, 422);
	const result = await v1Request(user.id, {
		scopes: ["profile:write"],
		pathSuffix: `/profile-change-requests/${parsed.data.operationId}/commands`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}`,
		body: {
			command: "profile.request_change",
			expected_version: 0,
			patch: {
				...(parsed.data.patch.email !== undefined ? { email: parsed.data.patch.email } : {}),
				...(parsed.data.patch.phone !== undefined ? { phone: parsed.data.patch.phone } : {}),
				...(parsed.data.patch.bankAccount !== undefined
					? { bank_account: parsed.data.patch.bankAccount }
					: {}),
				...(parsed.data.patch.address !== undefined ? { address: parsed.data.patch.address } : {}),
			},
		},
	});
	if (!result.ok) return resultError(result);
	const response = publicCommand(result.data);
	if (!response) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json(response, result.status === 201 ? 201 : 200);
});

employeeSelfServiceRoutes.get("/api/employee/self-service/attendance", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	const selected = period.safeParse(c.req.query("period"));
	if (!selected.success) return c.json({ error: "invalid_period" }, 422);
	const [year, month] = selected.data.split("-");
	const result = await v1Request(user.id, {
		scopes: ["attendance:read"],
		pathSuffix: `/attendance?period_year=${year}&period_month=${Number(month)}&limit=200`,
	});
	if (!result.ok) return resultError(result);
	const parsed = attendanceEnvelope.safeParse(result.data);
	if (!parsed.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({ attendance: publicAttendance(parsed.data.data, selected.data), fetchedAt: new Date().toISOString() });
});

employeeSelfServiceRoutes.post("/api/employee/self-service/attendance", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	const parsed = attendanceInput.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_attendance" }, 422);
	if (parsed.data.records.some((row) => row.date > todayInZone(user.timezone))) {
		return c.json({ error: "invalid_attendance" }, 422);
	}
	const result = await v1Request(user.id, {
		scopes: ["attendance:write"],
		pathSuffix: `/attendance/${parsed.data.period}/commands`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}`,
		body: {
			command: `attendance.${parsed.data.action}`,
			expected_version: parsed.data.expectedVersion,
			records: parsed.data.records.map((row) => ({
				id: row.id,
				date: row.date,
				activity_type: row.activityType,
				hours: row.hours,
				note: row.note,
			})),
		},
	});
	if (!result.ok) return resultError(result);
	const response = publicCommand(result.data);
	if (!response) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json(response, result.status === 201 ? 201 : 200);
});

employeeSelfServiceRoutes.get("/api/employee/self-service/small-numbers", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	const selected = period.safeParse(c.req.query("period"));
	if (!selected.success) return c.json({ error: "invalid_period" }, 422);
	const [year, month] = selected.data.split("-");
	const result = await v1Request(user.id, {
		scopes: ["small-numbers:read"],
		pathSuffix: `/small-numbers?period_year=${year}&period_month=${Number(month)}&limit=100`,
	});
	if (!result.ok) return resultError(result);
	const parsed = smallNumbersEnvelope.safeParse(result.data);
	if (!parsed.success) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json({ smallNumbers: publicSmallNumbers(parsed.data.data, selected.data), fetchedAt: new Date().toISOString() });
});

employeeSelfServiceRoutes.post("/api/employee/self-service/small-numbers", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	const parsed = smallNumberInput.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_small_number" }, 422);
	const result = await v1Request(user.id, {
		scopes: ["small-numbers:write"],
		pathSuffix: `/small-numbers/${parsed.data.period}/commands`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}`,
		body: {
			command: "small_numbers.save",
			expected_version: parsed.data.expectedVersion,
			choreography_id: parsed.data.choreographyId,
			hours_minutes: parsed.data.hoursMinutes,
			note: parsed.data.note ?? null,
			status: parsed.data.status,
		},
	});
	if (!result.ok) return resultError(result);
	const response = publicCommand(result.data);
	if (!response) return c.json({ error: "luckyos_contract_rejected" }, 502);
	return c.json(response, result.status === 201 ? 201 : 200);
});
