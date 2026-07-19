/** LuckyOS-backed vacation and absence requests for the employee surface. */
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import {
	absenceInstants,
	absenceKindSchema,
	absenceProviderStatusSchema,
	parseLuckyOsAbsenceCases,
	publicAbsenceCase,
	reconcileLuckyOsAbsenceCases,
	type NormalizedAbsenceCase,
} from "./employeeAbsenceProjection";
import { env } from "./env";
import { isLuckyOsRevoked, recordLuckyOsHealth } from "./integrations";
import { type LuckyOsV1Result, luckyOsV1EmployeeFetch } from "./luckyOsV1";

const operationId = z.string().uuid();
const isoDate = z.string().date();
const absenceRequestSchema = z
	.object({
		operationId,
		kind: absenceKindSchema,
		startDate: isoDate,
		endDate: isoDate,
		timezone: z.string().min(1).max(64),
		visibility: z.enum(["team", "private"]).default("team"),
		note: z.string().trim().max(2_000).nullable().default(null),
	})
	.strict();

const caseCommandEnvelope = z
	.object({
		entity_type: z.literal("employee_domain_case"),
		entity: z
			.object({
				id: z.string().uuid(),
				case_type: z.literal("absence"),
				status: absenceProviderStatusSchema,
				priority: z.enum(["low", "normal", "high", "urgent"]),
				version: z.number().int().positive(),
				created_at: z.string().datetime({ offset: true }),
			})
			.passthrough(),
		idempotency_replayed: z.boolean(),
	})
	.passthrough();

const SAFE_PROVIDER_ERRORS = new Set([
	"access_denied",
	"access_revoked",
	"agenda_read_channel_mismatch",
	"agenda_write_channel_mismatch",
	"domain_command_not_supported",
	"domain_version_or_state_conflict",
	"idempotency_conflict",
	"idempotency_in_progress",
	"insufficient_scope",
	"invalid_domain_command",
	"rate_limited",
]);

function providerError(result: LuckyOsV1Result) {
	const root =
		result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
	const nested =
		root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : {};
	const code = typeof nested.code === "string" ? nested.code : null;
	return code && SAFE_PROVIDER_ERRORS.has(code)
		? code
		: (result.errorCode ?? "luckyos_upstream_error");
}

function providerStatus(result: LuckyOsV1Result) {
	if (result.status === 504) return 504;
	if ([400, 401, 403, 404, 409, 410, 413, 422, 429, 503].includes(result.status)) {
		return result.status;
	}
	return 502;
}

function errorResponse(result: LuckyOsV1Result) {
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

async function request(
	userId: string,
	args: Omit<Parameters<typeof luckyOsV1EmployeeFetch>[0], "userId">,
) {
	const result = await luckyOsV1EmployeeFetch({ ...args, userId });
	try {
		await recordLuckyOsHealth(userId, { ok: result.ok, status: result.status });
	} catch {
		// Provider state is authoritative; health telemetry is secondary.
	}
	return result;
}

function subject(kind: z.infer<typeof absenceKindSchema>) {
	switch (kind) {
		case "vacation":
			return "Žádost o dovolenou";
		case "sickness":
			return "Hlášení pracovní neschopnosti";
		case "doctor":
			return "Žádost o pracovní volno – lékař";
		case "family_care":
			return "Žádost o pracovní volno – péče o blízkého";
		default:
			return "Žádost o evidenci absence";
	}
}

function knownCase(
	input: z.infer<typeof absenceRequestSchema>,
	instants: NonNullable<ReturnType<typeof absenceInstants>>,
	command: z.infer<typeof caseCommandEnvelope>,
): NormalizedAbsenceCase {
	return {
		id: command.entity.id,
		kind: input.kind,
		startDate: input.startDate,
		endDate: input.endDate,
		startsAt: instants.startsAt,
		endsAtExclusive: instants.endsAtExclusive,
		timezone: input.timezone,
		visibility: input.visibility,
		status: command.entity.status,
		priority: command.entity.priority,
		resolutionPublic: null,
		version: command.entity.version,
		createdAt: command.entity.created_at,
		updatedAt: command.entity.created_at,
	};
}

function overlaps(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
	return leftStart <= rightEnd && rightStart <= leftEnd;
}

export const employeeAbsenceRoutes = new Hono<{ Variables: { requestId: string } }>();

employeeAbsenceRoutes.use("/api/employee/self-service/absences*", async (c, next) => {
	await next();
	c.header("Cache-Control", "private, no-store, max-age=0");
});

employeeAbsenceRoutes.get("/api/employee/self-service/absences", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const result = await request(user.id, {
		scopes: ["cases:read"],
		pathSuffix: "/cases?limit=100&include_closed=true",
	});
	if (!result.ok) return errorResponse(result);
	let cases: NormalizedAbsenceCase[];
	try {
		cases = parseLuckyOsAbsenceCases(result.data);
	} catch {
		return c.json({ error: "luckyos_contract_rejected" }, 502);
	}
	try {
		await reconcileLuckyOsAbsenceCases(user.id, cases, c.get("requestId"));
	} catch {
		return c.json({ error: "absence_projection_unavailable" }, 503);
	}
	return c.json({
		cases: cases.map(publicAbsenceCase),
		fetchedAt: new Date().toISOString(),
	});
});

employeeAbsenceRoutes.post("/api/employee/self-service/absences", async (c) => {
	const user = await sessionUser(c);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (env.luckyOs.protocol !== "v1") return c.json({ error: "luckyos_v1_required" }, 409);
	if (await isLuckyOsRevoked(user.id)) return c.json({ error: "luckyos_revoked" }, 423);
	const parsed = absenceRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_absence_request" }, 422);
	const instants = absenceInstants(parsed.data.startDate, parsed.data.endDate, parsed.data.timezone);
	if (!instants) return c.json({ error: "invalid_absence_request" }, 422);
	const currentResult = await request(user.id, {
		scopes: ["cases:read"],
		pathSuffix: "/cases?limit=100&include_closed=true",
	});
	if (!currentResult.ok) return errorResponse(currentResult);
	let currentCases: NormalizedAbsenceCase[];
	try {
		currentCases = parseLuckyOsAbsenceCases(currentResult.data);
	} catch {
		return c.json({ error: "luckyos_contract_rejected" }, 502);
	}
	try {
		await reconcileLuckyOsAbsenceCases(user.id, currentCases, c.get("requestId"));
	} catch {
		return c.json({ error: "absence_projection_unavailable" }, 503);
	}
	if (
		currentCases.some(
			(item) =>
				item.id !== parsed.data.operationId &&
				!["rejected", "cancelled"].includes(item.status) &&
				overlaps(item.startDate, item.endDate, parsed.data.startDate, parsed.data.endDate),
		)
	) {
		return c.json({ error: "absence_overlap" }, 409);
	}
	const result = await request(user.id, {
		scopes: ["assignments:write", "cases:write"],
		pathSuffix: `/cases/${parsed.data.operationId}/commands`,
		method: "POST",
		idempotencyKey: `watson:${user.id}:${parsed.data.operationId}:absence`,
		body: {
			command: "case.create",
			expected_version: 0,
			case_type: "absence",
			target_type: null,
			target_id: null,
			subject: subject(parsed.data.kind),
			message:
				parsed.data.note ??
				"Žádám o evidenci absence v uvedeném období. Podrobnosti jsou ve strukturovaných datech žádosti.",
			priority: "normal",
			due_at: null,
			data: {
				schema_version: 1,
				absence_kind: parsed.data.kind,
				start_date: parsed.data.startDate,
				end_date: parsed.data.endDate,
				starts_at: instants.startsAt,
				ends_at_exclusive: instants.endsAtExclusive,
				timezone: parsed.data.timezone,
				visibility: parsed.data.visibility,
			},
			upload_id: null,
		},
	});
	if (!result.ok) return errorResponse(result);
	const command = caseCommandEnvelope.safeParse(result.data);
	if (!command.success || command.data.entity.id !== parsed.data.operationId) {
		return c.json({ error: "luckyos_contract_rejected" }, 502);
	}
	const item = knownCase(parsed.data, instants, command.data);
	try {
		await reconcileLuckyOsAbsenceCases(user.id, [item], c.get("requestId"));
	} catch {
		// LuckyOS already accepted the command. A projection outage must be honest
		// and retryable with the same operation id, never reported as a new request.
		return c.json({ error: "absence_projection_unavailable" }, 503);
	}
	return c.json(
		{ absence: publicAbsenceCase(item), replayed: command.data.idempotency_replayed },
		command.data.idempotency_replayed ? 200 : 201,
	);
});
