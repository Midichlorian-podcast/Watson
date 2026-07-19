/**
 * Privacy-minimised LuckyOS absence projection.
 *
 * LuckyOS remains the HR system of record. Watson stores only the dates,
 * visibility and approval state needed by its own calendar, scheduling guard
 * and notification hold. Employee notes and employer resolution text never
 * enter this projection or its audit log.
 */
import { randomUUID } from "node:crypto";
import {
	and,
	auditEvents,
	availabilityBlocks,
	eq,
	getDb,
	memberships,
	sql,
} from "@watson/db";
import {
	calendarDayDistance,
	nextValidZonedDateTimeToIso,
	shiftCalendarDate,
} from "@watson/shared";
import { z } from "zod";

export const absenceKindSchema = z.enum([
	"vacation",
	"sickness",
	"doctor",
	"family_care",
	"other",
]);
export const absenceProviderStatusSchema = z.enum([
	"submitted",
	"in_review",
	"needs_employee",
	"resolved",
	"rejected",
	"cancelled",
]);

const absenceDataSchema = z
	.object({
		schema_version: z.literal(1),
		absence_kind: absenceKindSchema,
		start_date: z.string().date(),
		end_date: z.string().date(),
		starts_at: z.string().datetime({ offset: true }),
		ends_at_exclusive: z.string().datetime({ offset: true }),
		timezone: z.string().min(1).max(64),
		visibility: z.enum(["team", "private"]),
	})
	.passthrough();

const providerCaseSchema = z
	.object({
		id: z.string().uuid(),
		case_type: z.string().min(1).max(80),
		employee_payload: z.record(z.string(), z.unknown()),
		status: absenceProviderStatusSchema,
		priority: z.enum(["low", "normal", "high", "urgent"]),
		resolution_public: z.string().max(10_000).nullable(),
		version: z.number().int().positive(),
		created_at: z.string().datetime({ offset: true }),
		updated_at: z.string().datetime({ offset: true }),
		closed_at: z.string().datetime({ offset: true }).nullable(),
	})
	.passthrough();

const casesEnvelopeSchema = z
	.object({
		resource: z.literal("cases"),
		data: z.object({ cases: z.array(providerCaseSchema).max(100) }).passthrough(),
	})
	.passthrough();

export type AbsenceKind = z.infer<typeof absenceKindSchema>;
export type AbsenceProviderStatus = z.infer<typeof absenceProviderStatusSchema>;
export type NormalizedAbsenceCase = {
	id: string;
	kind: AbsenceKind;
	startDate: string;
	endDate: string;
	startsAt: string;
	endsAtExclusive: string;
	timezone: string;
	visibility: "team" | "private";
	status: AbsenceProviderStatus;
	priority: "low" | "normal" | "high" | "urgent";
	resolutionPublic: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export function absenceInstants(startDate: string, endDate: string, timezone: string) {
	if (calendarDayDistance(startDate, endDate) < 0 || calendarDayDistance(startDate, endDate) > 365) {
		return null;
	}
	const startsAt = nextValidZonedDateTimeToIso(startDate, "00:00:00", timezone);
	const endsAtExclusive = nextValidZonedDateTimeToIso(
		shiftCalendarDate(endDate, 1),
		"00:00:00",
		timezone,
	);
	if (!startsAt || !endsAtExclusive || Date.parse(endsAtExclusive) <= Date.parse(startsAt)) return null;
	return { startsAt, endsAtExclusive };
}

function normalizeAbsenceCase(input: z.infer<typeof providerCaseSchema>): NormalizedAbsenceCase | null {
	if (input.case_type !== "absence") return null;
	const data = absenceDataSchema.safeParse(input.employee_payload);
	if (!data.success) throw new Error("luckyos_absence_contract_rejected");
	const expected = absenceInstants(data.data.start_date, data.data.end_date, data.data.timezone);
	if (
		!expected ||
		expected.startsAt !== data.data.starts_at ||
		expected.endsAtExclusive !== data.data.ends_at_exclusive
	) {
		throw new Error("luckyos_absence_contract_rejected");
	}
	return {
		id: input.id,
		kind: data.data.absence_kind,
		startDate: data.data.start_date,
		endDate: data.data.end_date,
		startsAt: data.data.starts_at,
		endsAtExclusive: data.data.ends_at_exclusive,
		timezone: data.data.timezone,
		visibility: data.data.visibility,
		status: input.status,
		priority: input.priority,
		resolutionPublic: input.resolution_public,
		version: input.version,
		createdAt: input.created_at,
		updatedAt: input.updated_at,
	};
}

export function parseLuckyOsAbsenceCases(value: unknown): NormalizedAbsenceCase[] {
	const envelope = casesEnvelopeSchema.safeParse(value);
	if (!envelope.success) throw new Error("luckyos_absence_contract_rejected");
	const cases: NormalizedAbsenceCase[] = [];
	for (const item of envelope.data.data.cases) {
		const normalized = normalizeAbsenceCase(item);
		if (normalized) cases.push(normalized);
	}
	return cases;
}

export function publicAbsenceCase(item: NormalizedAbsenceCase) {
	return {
		id: item.id,
		kind: item.kind,
		startDate: item.startDate,
		endDate: item.endDate,
		timezone: item.timezone,
		visibility: item.visibility,
		status: item.status,
		resolutionPublic: item.resolutionPublic,
		version: item.version,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
	};
}

function approvalState(status: AbsenceProviderStatus) {
	if (status === "resolved") return { approvalStatus: "approved" as const, cancelled: false };
	if (status === "rejected") return { approvalStatus: "rejected" as const, cancelled: true };
	if (status === "cancelled") return { approvalStatus: "cancelled" as const, cancelled: true };
	return { approvalStatus: "pending" as const, cancelled: false };
}

/** Upserts the same read-only projection into every Watson workspace the employee belongs to. */
export async function reconcileLuckyOsAbsenceCases(
	userId: string,
	cases: readonly NormalizedAbsenceCase[],
	requestId: string | null,
) {
	const db = getDb();
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`luckyos-absence:${userId}`}, 0))`,
		);
		const workspaceRows = await tx
			.select({ workspaceId: memberships.workspaceId })
			.from(memberships)
			.where(eq(memberships.userId, userId));
		let created = 0;
		let updated = 0;
		let unchanged = 0;
		for (const { workspaceId } of workspaceRows) {
			for (const item of cases) {
				const state = approvalState(item.status);
				const [before] = await tx
					.select()
					.from(availabilityBlocks)
					.where(
						and(
							eq(availabilityBlocks.workspaceId, workspaceId),
							eq(availabilityBlocks.userId, userId),
							eq(availabilityBlocks.source, "luckyos"),
							eq(availabilityBlocks.externalId, item.id),
						),
					)
					.limit(1);
				const cancelledAt = state.cancelled ? (before?.cancelledAt ?? new Date()) : null;
				if (!before) {
					const [block] = await tx
						.insert(availabilityBlocks)
						.values({
							id: randomUUID(),
							workspaceId,
							userId,
							kind: "absence",
							startsAt: new Date(item.startsAt),
							endsAt: new Date(item.endsAtExclusive),
							timezone: item.timezone,
							label: null,
							visibility: item.visibility,
							source: "luckyos",
							approvalStatus: state.approvalStatus,
							externalId: item.id,
							createdBy: userId,
							cancelledAt,
						})
						.returning();
					if (!block) throw new Error("absence_projection_insert_failed");
					await tx.insert(auditEvents).values({
						workspaceId,
						actorType: "system",
						entity: "availability_blocks",
						entityId: block.id,
						action: "luckyos_absence_project",
						diff: {
							userId,
							source: "luckyos",
							externalId: item.id,
							approvalStatus: state.approvalStatus,
							startsAt: item.startsAt,
							endsAt: item.endsAtExclusive,
							visibility: item.visibility,
						},
						requestId,
					});
					created++;
					continue;
				}
				const changed =
					before.kind !== "absence" ||
					before.startsAt.toISOString() !== item.startsAt ||
					before.endsAt.toISOString() !== item.endsAtExclusive ||
					before.timezone !== item.timezone ||
					before.visibility !== item.visibility ||
					before.approvalStatus !== state.approvalStatus ||
					Boolean(before.cancelledAt) !== state.cancelled;
				if (!changed) {
					unchanged++;
					continue;
				}
				const [block] = await tx
					.update(availabilityBlocks)
					.set({
						kind: "absence",
						startsAt: new Date(item.startsAt),
						endsAt: new Date(item.endsAtExclusive),
						timezone: item.timezone,
						label: null,
						visibility: item.visibility,
						approvalStatus: state.approvalStatus,
						cancelledAt,
						version: before.version + 1,
						updatedAt: new Date(),
					})
					.where(
						and(eq(availabilityBlocks.id, before.id), eq(availabilityBlocks.version, before.version)),
					)
					.returning();
				if (!block) throw new Error("absence_projection_stale");
				await tx.insert(auditEvents).values({
					workspaceId,
					actorType: "system",
					entity: "availability_blocks",
					entityId: block.id,
					action: "luckyos_absence_update",
					before: {
						approvalStatus: before.approvalStatus,
						startsAt: before.startsAt,
						endsAt: before.endsAt,
						visibility: before.visibility,
					},
					diff: {
						userId,
						externalId: item.id,
						approvalStatus: state.approvalStatus,
						startsAt: item.startsAt,
						endsAt: item.endsAtExclusive,
						visibility: item.visibility,
					},
					requestId,
				});
				updated++;
			}
		}
		return { created, updated, unchanged, workspaces: workspaceRows.length };
	});
}
