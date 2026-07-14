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
 * Restore wizard s dry-run a dedupem = F3 (plné CC-P0-14).
 */
import { createHash } from "node:crypto";
import { getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { auth } from "./auth";

export const exportRoutes = new Hono();

type Rows = Record<string, unknown>[];

/** JS pole → PG uuid[] parametr (postgres-js bez castu pole nebindne). */
const uuids = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((i) => sql`${i}`),
		sql`, `,
	)}]::uuid[]`;

/** Tabulky exportu: klíč → SQL scoped na workspace ids (param $ws) / user id. */
const EXPORT_QUERIES: Record<string, (ws: string[], userId: string) => ReturnType<typeof sql>> = {
	workspaces: (ws) => sql`SELECT * FROM workspaces WHERE id = ANY(${uuids(ws)})`,
	memberships: (ws) => sql`SELECT * FROM memberships WHERE workspace_id = ANY(${uuids(ws)})`,
	projects: (ws) => sql`SELECT * FROM projects WHERE workspace_id = ANY(${uuids(ws)})`,
	project_members: (ws) =>
		sql`SELECT pm.* FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	sections: (ws) =>
		sql`SELECT s.* FROM sections s JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	statuses: (ws) =>
		sql`SELECT st.* FROM statuses st LEFT JOIN projects p ON p.id = st.project_id WHERE p.workspace_id = ANY(${uuids(ws)}) OR st.workspace_id = ANY(${uuids(ws)})`,
	tasks: (ws) =>
		sql`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	assignments: (ws) =>
		sql`SELECT a.* FROM assignments a JOIN projects p ON p.id = a.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
	comments: (ws) =>
		sql`SELECT c.* FROM comments c JOIN tasks t ON t.id = c.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(${uuids(ws)})`,
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
	entity_links: (ws) => sql`SELECT * FROM entity_links WHERE workspace_id = ANY(${uuids(ws)})`,
	// porady BEZ obsahu: transcript a extraction patří účastníkům (rozhodnutí §15/3)
	meetings: (ws) =>
		sql`SELECT id, workspace_id, title, status, hub_task_id, series_id, prev_meeting_id, created_by, created_at, updated_at FROM meetings WHERE workspace_id = ANY(${uuids(ws)})`,
};

exportRoutes.get("/api/export", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const userId = session.user.id;
	const db = getDb();

	// scope: workspaces, kde jsem členem (guest = read-only návštěva → vynechat)
	const wsRows = (await db.execute(
		sql`SELECT workspace_id, role FROM memberships WHERE user_id = ${userId}`,
	)) as { workspace_id: string; role: string }[];
	const ws = wsRows.filter((r) => r.role !== "guest").map((r) => r.workspace_id);
	if (ws.length === 0) return c.json({ error: "no workspaces" }, 404);

	const tables: Record<string, Rows> = {};
	const counts: Record<string, number> = {};
	for (const [name, q] of Object.entries(EXPORT_QUERIES)) {
		const rows = (await db.execute(q(ws, userId))) as Rows;
		tables[name] = rows;
		counts[name] = rows.length;
	}

	const migrations = (await db.execute(
		sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
	)) as { n: number }[];

	const payload = JSON.stringify(tables);
	const manifest = {
		format: "watson-export",
		version: 1,
		exportedAt: new Date().toISOString(),
		schemaMigrations: migrations[0]?.n ?? null,
		scope: { workspaces: ws.length, userId },
		counts,
		// sha256 obsahu — restore pozná poškozený/oříznutý soubor
		checksum: createHash("sha256").update(payload).digest("hex"),
	};

	c.header("Content-Disposition", `attachment; filename="watson-export-${Date.now()}.json"`);
	return c.json({ manifest, tables });
});
