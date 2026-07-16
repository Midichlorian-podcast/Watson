/**
 * CC-P0-14 (slice) — serverový VERSIONED export dat uživatele.
 *
 * Na rozdíl od lokálního exportu (apps/web/src/lib/backup.ts — jen to, co má
 * zařízení nasyncované) exportuje autoritativní stav ze serveru, s manifestem:
 * verze formátu, počet aplikovaných migrací (kompatibilita při budoucím
 * restore), počty řádků per tabulka a sha256 checksum obsahu.
 *
 * Scope = ACL: workspaces, kde je volající členem; guest workspace se
 * vynechává (host je read-only návštěva, ne vlastník dat). Přepisy porad
 * (transcript/extraction) se z privacy defaultu NEexportují — obsah patří
 * účastníkům (rozhodnutí §15/3), export je per-user, ne per-meeting ACL.
 *
 * Stejný modul obsahuje serverový restore s dry-runem, přesným dependency order,
 * conflict policy a auditem. Není to náhrada PostgreSQL PITR — viz ops/backup.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { auth } from "./auth";
import { env } from "./env";

export const exportRoutes = new Hono<{ Variables: { requestId: string } }>();

type Rows = Record<string, unknown>[];

const DEV_BACKUP_SECRET = "watson-dev-backup-signing-secret-not-for-production";
const backupSecret = env.backupSigningSecret ?? DEV_BACKUP_SECRET;

/** Referenční pořadí je zároveň explicitní inventář podporovaného restore. */
export const RESTORE_TABLE_ORDER = [
	"workspaces",
	"memberships",
	"projects",
	"project_members",
	"sections",
	"statuses",
	"project_custom_fields",
	"tasks",
	"task_dependencies",
	"task_custom_field_values",
	"task_polls",
	"task_poll_responses",
	"meetings",
	"assignments",
	"comments",
	"comment_decisions",
	"mentions",
	"comment_reactions",
	"attachments",
	"checklist_items",
	"labels",
	"task_labels",
	"task_occurrence_overrides",
	"task_user_colors",
	"reminders",
	"task_activity",
	"chains",
	"chain_steps",
	"goals",
	"goal_projects",
	"goal_milestones",
	"list_templates",
	"lists",
	"list_sections",
	"list_items",
	"contacts",
	"filters",
	"palettes",
	"calendar_links",
	"audit_events",
	"ai_suggestions",
	"ai_policies",
	"entity_links",
] as const;
type RestoreTable = (typeof RESTORE_TABLE_ORDER)[number];

/** JS pole → PG uuid[] parametr (postgres-js bez castu pole nebindne). */
const uuids = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((i) => sql`${i}`),
		sql`, `,
	)}]::uuid[]`;

/** Tabulky exportu: klíč → SQL scoped na workspace ids (param $ws) / user id. */
const EXPORT_QUERIES: Record<
	RestoreTable,
	(ws: string[], userId: string) => ReturnType<typeof sql>
> = {
	workspaces: (ws) => sql`SELECT * FROM workspaces WHERE id = ANY(${uuids(ws)})`,
	memberships: (ws) => sql`SELECT * FROM memberships WHERE workspace_id = ANY(${uuids(ws)})`,
	projects: (ws) => sql`SELECT * FROM projects WHERE workspace_id = ANY(${uuids(ws)})`,
	project_members: (ws) =>
		sql`SELECT pm.* FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	sections: (ws) =>
		sql`SELECT s.* FROM sections s JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	statuses: (ws) =>
		sql`SELECT st.* FROM statuses st LEFT JOIN projects p ON p.id = st.project_id WHERE p.workspace_id = ANY(${uuids(ws)}) OR st.workspace_id = ANY(${uuids(ws)})`,
	project_custom_fields: (ws) =>
		sql`SELECT f.* FROM project_custom_fields f JOIN projects p ON p.id = f.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	tasks: (ws) =>
		sql`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	task_dependencies: (ws) =>
		sql`SELECT d.* FROM task_dependencies d JOIN projects p ON p.id = d.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	task_custom_field_values: (ws) =>
		sql`SELECT v.* FROM task_custom_field_values v JOIN projects p ON p.id = v.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	task_polls: (ws) =>
		sql`SELECT poll.* FROM task_polls poll JOIN projects p ON p.id = poll.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	task_poll_responses: (ws) =>
		sql`SELECT response.* FROM task_poll_responses response JOIN projects p ON p.id = response.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	assignments: (ws) =>
		sql`SELECT a.* FROM assignments a JOIN projects p ON p.id = a.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	comments: (ws) =>
		sql`SELECT c.* FROM comments c JOIN tasks t ON t.id = c.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	comment_decisions: (ws) =>
		sql`SELECT d.* FROM comment_decisions d JOIN projects p ON p.id = d.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	mentions: (ws) =>
		sql`SELECT m.* FROM mentions m JOIN comments c ON c.id = m.comment_id JOIN tasks t ON t.id = c.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	comment_reactions: (ws) =>
		sql`SELECT r.* FROM comment_reactions r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	attachments: (ws) =>
		// Nové interní přílohy bez binárního obsahu nesmíme obnovit jako rozbité odkazy.
		// Export zde proto zachovává jen případné historické externí URL z doby před M1.
		sql`SELECT a.* FROM attachments a JOIN projects p ON p.id = a.project_id WHERE p.workspace_id = ANY(${uuids(ws)}) AND a.url NOT LIKE '/api/attachments/%'`,
	checklist_items: (ws) =>
		sql`SELECT ci.* FROM checklist_items ci JOIN projects p ON p.id = ci.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	labels: (ws) => sql`SELECT * FROM labels WHERE workspace_id = ANY(${uuids(ws)})`,
	task_labels: (ws) =>
		sql`SELECT tl.* FROM task_labels tl JOIN tasks t ON t.id = tl.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	task_occurrence_overrides: (ws) =>
		sql`SELECT o.* FROM task_occurrence_overrides o JOIN tasks t ON t.id = o.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	task_user_colors: (_ws, userId) =>
		sql`SELECT * FROM task_user_colors WHERE user_id = ${userId}`,
	reminders: (_ws, userId) => sql`SELECT * FROM reminders WHERE user_id = ${userId}`,
	task_activity: (ws) =>
		sql`SELECT ta.* FROM task_activity ta JOIN projects p ON p.id = ta.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	chains: (ws) =>
		sql`SELECT ch.* FROM chains ch JOIN projects p ON p.id = ch.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	chain_steps: (ws) =>
		sql`SELECT cs.* FROM chain_steps cs JOIN projects p ON p.id = cs.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	goals: (ws) => sql`SELECT * FROM goals WHERE workspace_id = ANY(${uuids(ws)})`,
	goal_projects: (ws) => sql`SELECT * FROM goal_projects WHERE workspace_id = ANY(${uuids(ws)})`,
	goal_milestones: (ws) =>
		sql`SELECT gm.* FROM goal_milestones gm JOIN goals g ON g.id = gm.goal_id WHERE g.workspace_id = ANY(${uuids(ws)})`,
	lists: (ws) => sql`SELECT * FROM lists WHERE workspace_id = ANY(${uuids(ws)})`,
	list_sections: (ws) =>
		sql`SELECT ls.* FROM list_sections ls JOIN lists l ON l.id = ls.list_id WHERE l.workspace_id = ANY(${uuids(ws)})`,
	list_items: (ws) =>
		sql`SELECT li.* FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.workspace_id = ANY(${uuids(ws)})`,
	list_templates: (ws) => sql`SELECT * FROM list_templates WHERE workspace_id = ANY(${uuids(ws)})`,
	contacts: (ws) => sql`SELECT * FROM contacts WHERE workspace_id = ANY(${uuids(ws)})`,
	filters: (ws, userId) =>
		sql`SELECT * FROM filters WHERE user_id = ${userId} OR workspace_id = ANY(${uuids(ws)})`,
	palettes: (ws, userId) =>
		sql`SELECT * FROM palettes WHERE user_id = ${userId} OR workspace_id = ANY(${uuids(ws)})`,
	calendar_links: (ws) =>
		sql`SELECT cl.* FROM calendar_links cl JOIN tasks t ON t.id = cl.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	audit_events: (ws) => sql`SELECT * FROM audit_events WHERE workspace_id = ANY(${uuids(ws)})`,
	ai_suggestions: (ws) => sql`SELECT * FROM ai_suggestions WHERE workspace_id = ANY(${uuids(ws)})`,
	ai_policies: (ws) => sql`SELECT * FROM ai_policies WHERE workspace_id = ANY(${uuids(ws)})`,
	entity_links: (ws) => sql`SELECT * FROM entity_links WHERE workspace_id = ANY(${uuids(ws)})`,
	// Metadata všech viditelných porad zachová vazby. Obsah je exportován pouze
	// zakladateli/účastníkovi; ostatním řádkům se privacy fields explicitně redigují.
	meetings: (ws, userId) => sql`
		SELECT m.id, m.workspace_id, m.title,
			CASE WHEN m.created_by = ${userId} OR EXISTS (
				SELECT 1 FROM assignments a WHERE a.task_id = m.hub_task_id AND a.user_id = ${userId}
			) THEN m.transcript ELSE NULL END AS transcript,
			m.status, m.hub_task_id, m.series_id, m.prev_meeting_id,
			CASE WHEN m.created_by = ${userId} OR EXISTS (
				SELECT 1 FROM assignments a WHERE a.task_id = m.hub_task_id AND a.user_id = ${userId}
			) THEN m.extraction ELSE NULL END AS extraction,
			m.created_by, m.created_at, m.updated_at
		FROM meetings m WHERE m.workspace_id = ANY(${uuids(ws)})`,
};

export function checksumTables(tables: Record<string, Rows>) {
	return createHash("sha256").update(JSON.stringify(tables)).digest("hex");
}

export function manifestSignature(input: {
	version: number;
	schemaMigrations: number | null;
	userId: string;
	checksum: string;
}) {
	return createHmac("sha256", backupSecret)
		.update(
			JSON.stringify({
				format: "watson-export",
				version: input.version,
				schemaMigrations: input.schemaMigrations,
				userId: input.userId,
				checksum: input.checksum,
			}),
		)
		.digest("hex");
}

exportRoutes.get("/api/export", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const userId = session.user.id;
	const db = getDb();

	// Restorable scope: jen prostory, za které nese volající administrátorskou
	// odpovědnost. Běžný member smí data číst/syncovat, ale nesmí je exportem
	// znovu vytvářet; osobní portability export je jiný produktový účel.
	const wsRows = (await db.execute(
		sql`
			SELECT m.workspace_id, m.role, w.owner_id
			FROM memberships m
			JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.user_id = ${userId}
			  AND (m.role IN ('manager', 'admin') OR w.owner_id = ${userId})
		`,
	)) as { workspace_id: string; role: string; owner_id: string | null }[];
	const ws = wsRows.map((r) => r.workspace_id);
	if (ws.length === 0) return c.json({ error: "no workspaces" }, 404);

	const tables: Record<string, Rows> = {};
	const counts: Record<string, number> = {};
	for (const name of RESTORE_TABLE_ORDER) {
		const q = EXPORT_QUERIES[name];
		const rows = (await db.execute(q(ws, userId))) as Rows;
		tables[name] = rows;
		counts[name] = rows.length;
	}

	const migrations = (await db.execute(
		sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
	)) as { n: number }[];

	const schemaMigrations = migrations[0]?.n ?? null;
	const checksum = checksumTables(tables);
	const unsignedManifest = {
		format: "watson-export",
		version: 2,
		exportedAt: new Date().toISOString(),
		schemaMigrations,
		scope: { workspaces: ws.length, userId, authority: "admin-or-owner" },
		counts,
		checksum,
		limitations: {
			meetingContent: "only creator or participant; other meeting rows are restored with redacted content",
			attachmentFiles: "server-stored attachment files and their metadata require a separate binary backup and are excluded",
			authAndSecrets: "accounts, sessions, tokens, push subscriptions and calendar credentials excluded",
		},
	};
	const manifest = {
		...unsignedManifest,
		signature: manifestSignature({
			version: unsignedManifest.version,
			schemaMigrations,
			userId,
			checksum,
		}),
	};

	c.header("Content-Disposition", `attachment; filename="watson-export-${Date.now()}.json"`);
	return c.json({ manifest, tables });
});

type RestoreManifest = {
	format: string;
	version: number;
	exportedAt: string;
	schemaMigrations: number | null;
	scope: { workspaces: number; userId: string };
	counts: Record<string, number>;
	checksum: string;
	signature: string;
};

type RestoreReport = {
	mode: "dry-run" | "apply";
	checksum: string;
	inserted: Record<string, number>;
	skippedExisting: Record<string, number>;
	totalInserted: number;
	totalSkippedExisting: number;
};

class DryRunRollback extends Error {
	constructor(readonly report: RestoreReport) {
		super("dry_run_rollback");
	}
}

function safeSqlState(error: unknown) {
	if (!error || typeof error !== "object") return null;
	const value = error as { code?: unknown; cause?: { code?: unknown } };
	return typeof value.code === "string"
		? value.code
		: typeof value.cause?.code === "string"
			? value.cause.code
			: null;
}

function sortTasksParentFirst(rows: Rows): Rows {
	const pending = new Map(rows.map((row) => [String(row.id), row]));
	const result: Rows = [];
	while (pending.size > 0) {
		let progressed = false;
		for (const [id, row] of pending) {
			const parent = typeof row.parent_id === "string" ? row.parent_id : null;
			if (!parent || !pending.has(parent)) {
				result.push(row);
				pending.delete(id);
				progressed = true;
			}
		}
		if (!progressed) throw new Error("task_parent_cycle_in_backup");
	}
	return result;
}

async function databaseColumns(db: ReturnType<typeof getDb>) {
	const rows = (await db.execute(sql`
		SELECT table_name, column_name, data_type
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = ANY(${sql`ARRAY[${sql.join(
			RESTORE_TABLE_ORDER.map((name) => sql`${name}`),
			sql`, `,
		)}]::text[]`})
	`)) as { table_name: string; column_name: string; data_type: string }[];
	const result = new Map<string, Map<string, string>>();
	for (const row of rows) {
		const columns = result.get(row.table_name) ?? new Map<string, string>();
		columns.set(row.column_name, row.data_type);
		result.set(row.table_name, columns);
	}
	return result;
}

function constantTimeHexEqual(a: string, b: string) {
	if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
	return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

async function validateRestore(
	db: ReturnType<typeof getDb>,
	backup: unknown,
	userId: string,
) {
	if (!backup || typeof backup !== "object") throw new Error("invalid_backup");
	const value = backup as { manifest?: RestoreManifest; tables?: Record<string, unknown> };
	const manifest = value.manifest;
	const rawTables = value.tables;
	if (!manifest || !rawTables || typeof rawTables !== "object") throw new Error("invalid_backup");
	if (manifest.format !== "watson-export" || manifest.version !== 2) {
		throw new Error("unsupported_backup_version");
	}
	if (manifest.scope?.userId !== userId) throw new Error("backup_owner_mismatch");
	if (!Number.isFinite(Date.parse(manifest.exportedAt))) throw new Error("invalid_export_time");
	const names = Object.keys(rawTables).sort();
	const expectedNames = [...RESTORE_TABLE_ORDER].sort();
	if (JSON.stringify(names) !== JSON.stringify(expectedNames)) throw new Error("table_inventory_mismatch");

	const columns = await databaseColumns(db);
	const tables: Record<string, Rows> = {};
	let totalRows = 0;
	for (const table of RESTORE_TABLE_ORDER) {
		const rows = rawTables[table];
		if (!Array.isArray(rows) || rows.length > 20_000) throw new Error(`invalid_table:${table}`);
		const allowed = columns.get(table);
		if (!allowed) throw new Error(`database_table_missing:${table}`);
		const ids = new Set<string>();
		for (const row of rows) {
			if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`invalid_row:${table}`);
			const record = row as Record<string, unknown>;
			if (typeof record.id !== "string" || !/^[0-9a-f-]{36}$/i.test(record.id)) {
				throw new Error(`invalid_id:${table}`);
			}
			if (ids.has(record.id)) throw new Error(`duplicate_id:${table}`);
			ids.add(record.id);
			for (const column of Object.keys(record)) {
				if (!allowed.has(column)) throw new Error(`unknown_column:${table}.${column}`);
			}
		}
		totalRows += rows.length;
		if (manifest.counts?.[table] !== rows.length) throw new Error(`count_mismatch:${table}`);
		tables[table] = rows as Rows;
	}
	if (totalRows > 50_000) throw new Error("backup_too_many_rows");
	const checksum = checksumTables(tables);
	if (!constantTimeHexEqual(checksum, manifest.checksum)) throw new Error("checksum_mismatch");
	const expectedSignature = manifestSignature({
		version: manifest.version,
		schemaMigrations: manifest.schemaMigrations,
		userId,
		checksum,
	});
	if (!constantTimeHexEqual(expectedSignature, manifest.signature)) throw new Error("signature_mismatch");
	const migrationRows = (await db.execute(
		sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
	)) as { n: number }[];
	const currentMigrations = migrationRows[0]?.n ?? 0;
	if ((manifest.schemaMigrations ?? 0) > currentMigrations) throw new Error("backup_schema_newer_than_server");
	return { manifest, tables, checksum, columns };
}

function quotedIdentifier(value: string) {
	// Volá se pouze pro explicitní table allowlist a column names načtené z
	// information_schema. Dodatečná regex kontrola drží sql.raw mimo vstup souboru.
	if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("unsafe_identifier");
	return sql.raw(`"${value}"`);
}

async function runRestoreTransaction(input: {
	db: ReturnType<typeof getDb>;
	tables: Record<string, Rows>;
	checksum: string;
	userId: string;
	requestId: string;
	mode: "dry-run" | "apply";
	conflictMode: "skip" | "fail";
	columns: Map<string, Map<string, string>>;
}): Promise<RestoreReport> {
	try {
		return await input.db.transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`restore:${input.userId}:${input.checksum}`}))`);
			await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
			await tx.execute(sql`SELECT set_config('watson.allow_poll_restore', 'on', true)`);

			const workspaceRows = input.tables.workspaces ?? [];
			const workspaceIds = workspaceRows.map((row) => String(row.id));
			const existing = workspaceIds.length
				? ((await tx.execute(sql`
					SELECT w.id, w.owner_id, m.role
					FROM workspaces w
					LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ${input.userId}
					WHERE w.id = ANY(${uuids(workspaceIds)})
				`)) as { id: string; owner_id: string | null; role: string | null }[])
				: [];
			for (const row of existing) {
				if (row.owner_id !== input.userId && row.role !== "admin" && row.role !== "manager") {
					throw new Error("restore_workspace_forbidden");
				}
			}
			const existingIds = new Set(existing.map((row) => row.id));
			const membershipRows = input.tables.memberships ?? [];
			for (const row of workspaceRows) {
				const id = String(row.id);
				if (existingIds.has(id)) continue;
				const hasAdminMembership = membershipRows.some(
					(member) => member.workspace_id === id && member.user_id === input.userId && member.role === "admin",
				);
				if (row.owner_id !== input.userId || !hasAdminMembership) throw new Error("new_workspace_ownership_mismatch");
			}

			const inserted: Record<string, number> = {};
			const skippedExisting: Record<string, number> = {};
			for (const table of RESTORE_TABLE_ORDER) {
				const rows = table === "tasks" ? sortTasksParentFirst(input.tables[table] ?? []) : input.tables[table] ?? [];
				inserted[table] = 0;
				skippedExisting[table] = 0;
				for (const row of rows) {
					const columnNames = Object.keys(row);
					const columnTypes = input.columns.get(table);
					if (!columnTypes) throw new Error(`database_table_missing:${table}`);
					const statement = sql`
						INSERT INTO ${quotedIdentifier(table)}
						(${sql.join(columnNames.map(quotedIdentifier), sql`, `)})
						VALUES (${sql.join(
							columnNames.map((column) =>
								columnTypes.get(column) === "jsonb" && row[column] !== null
									? sql`${JSON.stringify(row[column])}::jsonb`
									: sql`${row[column]}`,
							),
							sql`, `,
						)})
						ON CONFLICT (id) DO NOTHING
						RETURNING id
					`;
					const result = (await tx.execute(statement)) as { id: string }[];
					if (result.length === 1) inserted[table] += 1;
					else skippedExisting[table] += 1;
				}
				if (input.conflictMode === "fail" && skippedExisting[table] > 0) {
					throw new Error(`restore_conflict:${table}`);
				}
			}

			// Vynutí deferred FK i naše constraint triggers už v dry-runu, ještě před rollbackem.
			await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
			const report: RestoreReport = {
				mode: input.mode,
				checksum: input.checksum,
				inserted,
				skippedExisting,
				totalInserted: Object.values(inserted).reduce((a, b) => a + b, 0),
				totalSkippedExisting: Object.values(skippedExisting).reduce((a, b) => a + b, 0),
			};
			if (input.mode === "dry-run") throw new DryRunRollback(report);
			for (const workspaceId of workspaceIds) {
				await tx.execute(sql`
					INSERT INTO audit_events (workspace_id, actor_type, actor_user_id, entity, entity_id, action, diff, request_id)
					VALUES (${workspaceId}::uuid, 'user', ${input.userId}::uuid, 'backup', ${workspaceId}::uuid, 'restore',
						${JSON.stringify({ checksum: input.checksum, inserted: report.totalInserted, skippedExisting: report.totalSkippedExisting })}::jsonb,
						${input.requestId})
				`);
			}
			return report;
		});
	} catch (error) {
		if (error instanceof DryRunRollback) return error.report;
		throw error;
	}
}

exportRoutes.post("/api/restore", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "invalid_json" }, 400);
	}
	if (!body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
	const request = body as { mode?: unknown; conflictMode?: unknown; backup?: unknown };
	const mode = request.mode === "apply" ? "apply" : request.mode === "dry-run" ? "dry-run" : null;
	const conflictMode = request.conflictMode === "fail" ? "fail" : request.conflictMode === "skip" ? "skip" : null;
	if (!mode || !conflictMode) return c.json({ error: "invalid_restore_mode" }, 400);
	const db = getDb();
	try {
		const validated = await validateRestore(db, request.backup, session.user.id);
		const report = await runRestoreTransaction({
			db,
			tables: validated.tables,
			checksum: validated.checksum,
			columns: validated.columns,
			userId: session.user.id,
			requestId: c.get("requestId") ?? "restore",
			mode,
			conflictMode,
		});
		return c.json({ ok: true, report });
	} catch (error) {
		const code = error instanceof Error ? error.message : "restore_failed";
		const sqlState = safeSqlState(error);
		const status =
			code === "restore_workspace_forbidden" || code === "backup_owner_mismatch"
				? 403
				: code.startsWith("restore_conflict:")
					? 409
					: sqlState === "23503" || sqlState === "23514" || sqlState === "23505"
						? 422
						: 400;
		return c.json(
			{
				error: "restore_rejected",
				code: code.includes(backupSecret) ? "restore_failed" : code.slice(0, 160),
				...(sqlState ? { constraint: sqlState } : {}),
			},
			status,
		);
	}
});
