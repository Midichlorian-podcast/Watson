import { type getDb, sql } from "@watson/db";

type Db = ReturnType<typeof getDb>;
export type SchedulingTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | SchedulingTx;
type Row = Record<string, unknown>;

export type MeetingBusyConflict = {
	assigneeId: string;
	assigneeName: string;
	startsAt: string;
	endsAt: string;
};

const uuidArray = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `,
	)}]::uuid[]`;

/**
 * Všechny meeting commandy zamykají stejnou sadu klíčů ve stejném pořadí.
 * Per-user UTC dny serializují překrývající se rezervace; samotný DB dotaz pod
 * zámkem pak rozhodne podle přesných instantů a délky.
 */
export async function lockMeetingSchedule(
	tx: SchedulingTx,
	input: {
		workspaceId: string;
		meetingId: string;
		participantIds: string[];
		startsAt: Date;
		endsAt: Date;
		extraKeys?: string[];
	},
) {
	const days = new Set<string>();
	for (
		let cursor = Date.UTC(
			input.startsAt.getUTCFullYear(),
			input.startsAt.getUTCMonth(),
			input.startsAt.getUTCDate(),
		);
		cursor <= input.endsAt.getTime();
		cursor += 86_400_000
	) {
		days.add(new Date(cursor).toISOString().slice(0, 10));
	}
	const keys = [
		`meeting-id:${input.meetingId}`,
		...(input.extraKeys ?? []),
		...[...new Set(input.participantIds)].flatMap((userId) =>
			[...days].map((day) => `meeting-schedule:${input.workspaceId}:${userId}:${day}`),
		),
	].sort();
	for (const key of keys) {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
	}
}

/** Časovaný úkol/porada řešitele je pro interní booking skutečný busy interval. */
export async function readMeetingBusyConflicts(
	db: QueryDb,
	input: {
		workspaceId: string;
		participantIds: string[];
		startsAt: Date;
		endsAt: Date;
		excludeTaskId?: string | null;
	},
): Promise<MeetingBusyConflict[]> {
	const participantIds = [...new Set(input.participantIds)];
	if (participantIds.length === 0) return [];
	const rows = (await db.execute(sql`
		SELECT a.user_id, u.name AS user_name, t.start_date,
		       t.start_date + (coalesce(t.duration_min, 30) * interval '1 minute') AS ends_at
		FROM assignments a
		JOIN tasks t ON t.id = a.task_id
		JOIN projects p ON p.id = t.project_id
		JOIN users u ON u.id = a.user_id
		WHERE p.workspace_id = ${input.workspaceId}
		  AND a.user_id = ANY(${uuidArray(participantIds)})
		  AND t.completed_at IS NULL
		  AND t.start_date IS NOT NULL
		  AND (${input.excludeTaskId ?? null}::uuid IS NULL OR t.id <> ${input.excludeTaskId ?? null}::uuid)
		  AND t.start_date < ${input.endsAt.toISOString()}::timestamptz
		  AND t.start_date + (coalesce(t.duration_min, 30) * interval '1 minute') > ${input.startsAt.toISOString()}::timestamptz
		ORDER BY t.start_date, a.user_id
	`)) as unknown as Row[];
	return rows.map((row) => ({
		assigneeId: String(row.user_id),
		assigneeName: String(row.user_name ?? ""),
		startsAt: new Date(String(row.start_date)).toISOString(),
		endsAt: new Date(String(row.ends_at)).toISOString(),
	}));
}
