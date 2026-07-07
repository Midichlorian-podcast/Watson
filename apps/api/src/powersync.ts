/**
 * PowerSync backend integrace:
 *  - JWKS endpoint (RS256) — PowerSync service jím ověřuje klientské tokeny,
 *  - token endpoint — vydá krátkodobý JWT (sub = user id) přihlášenému uživateli,
 *  - write endpoint — aplikuje upload frontu klienta (CRUD) do Postgresu s kontrolou práv.
 *
 * Write-path je GENERALIZOVANÝ: registr tabulek (TABLES) s whitelistem sloupců a row-level
 * kontrolou (R5) přes členství v projektu. Přidat tabulku = přidat záznam do registru,
 * žádné natvrdo psané SQL per tabulka.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import { auth } from "./auth";

const KID = "watson-dev-1";
const ALG = "RS256";
const AUDIENCE = "powersync";
const keyDir = fileURLToPath(new URL("../.keys", import.meta.url));
const keyFile = fileURLToPath(
	new URL("../.keys/powersync-key.json", import.meta.url),
);

let privateKey: CryptoKey;
let publicJwk: JWK;

async function loadKeys() {
	if (existsSync(keyFile)) {
		const stored = JSON.parse(readFileSync(keyFile, "utf8")) as {
			privateJwk: JWK;
			publicJwk: JWK;
		};
		privateKey = (await importJWK(stored.privateJwk, ALG)) as CryptoKey;
		publicJwk = stored.publicJwk;
		return;
	}
	const { privateKey: priv, publicKey: pub } = await generateKeyPair(ALG, {
		extractable: true,
	});
	privateKey = priv as CryptoKey;
	const privateJwk = await exportJWK(priv);
	publicJwk = { ...(await exportJWK(pub)), kid: KID, alg: ALG, use: "sig" };
	if (!existsSync(keyDir)) mkdirSync(keyDir, { recursive: true });
	writeFileSync(keyFile, JSON.stringify({ privateJwk, publicJwk }, null, 2));
	console.log("[watson-api] vygenerován nový PowerSync RSA keypair (.keys/)");
}
await loadKeys();

/** Krátkodobý JWT pro PowerSync (sub = user id). */
async function issueToken(userId: string) {
	return new SignJWT({})
		.setProtectedHeader({ alg: ALG, kid: KID })
		.setSubject(userId)
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.setExpirationTime("10m")
		.sign(privateKey);
}

export const powersyncRoutes = new Hono();

/** JWKS — PowerSync service sem chodí pro veřejné klíče. */
powersyncRoutes.get("/api/powersync/jwks", (c) =>
	c.json({ keys: [publicJwk] }),
);

/** Vydá PowerSync token přihlášenému uživateli + endpoint sync služby. */
powersyncRoutes.get("/api/powersync/token", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const token = await issueToken(session.user.id);
	return c.json({
		token,
		powersync_url: process.env.POWERSYNC_URL || "http://localhost:8080",
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Registr zapisovatelných tabulek
// ─────────────────────────────────────────────────────────────────────────────

type ColType = "text" | "int" | "bool" | "ts";

interface TableDef {
	/** Zapisovatelné sloupce → typ (pro správný cast SQLite→Postgres). `id` se řeší zvlášť. */
	columns: Record<string, ColType>;
	/** Má sloupec `updated_at` (nastaví se now() při zápisu). */
	hasUpdatedAt: boolean;
	/** Sloupec autora — na PUT se vyplní serverovým userId (atribuce, R10). */
	creatorCol?: string;
	/** Sloupec „vlastníka" (user_id) — server VŽDY přepíše na session userId (PUT i PATCH).
	 *  Brání padělání identity: osobní připomínky / barvy / audit-log nelze zapsat cizím jménem. */
	ownerCol?: string;
	/** Append-only tabulka (audit log): PATCH a DELETE jsou zakázané. */
	appendOnly?: boolean;
	/** Minimální projektová role pro zápis (default „editor"). commenter smí jen komentáře/overlaye. */
	minRole?: "commenter" | "editor" | "manager";
	/** Sloupce, jejichž změna vyžaduje roli „manager" (owner_id/visibility/archivace projektu). */
	managerCols?: string[];
	/** PATCH/DELETE smí jen autor (creatorCol) nebo manager projektu (komentáře). */
	authorEditOnly?: boolean;
	/** Jak zjistit project_id pro membership kontrolu (R5). `self` = řádek JE projekt (id). */
	projectVia?:
		| { kind: "column"; col: string }
		| { kind: "task"; col: string }
		| { kind: "self" };
	/** Workspace-scoped tabulky (cíle): membership kontrola přes memberships.workspace_id. */
	workspaceVia?: { kind: "column"; col: string };
	/** FK sloupce na řádek (se sloupcem project_id), jehož projekt musí být útočníkův —
	 *  brání cross-project referenci (parent_id/section_id/status_id). */
	refProjectCols?: { col: string; table: string }[];
	/** Sloupce s user_id, které musí být členem projektu řádku (assignments.user_id). */
	memberCols?: string[];
}

/** Pořadí projektových rolí (R5) — vyšší číslo = víc práv. */
const PROJECT_ROLE_RANK: Record<string, number> = {
	commenter: 1,
	editor: 2,
	manager: 3,
};

const TABLES: Record<string, TableDef> = {
	tasks: {
		columns: {
			project_id: "text",
			section_id: "text",
			parent_id: "text",
			name: "text",
			description: "text",
			priority: "int",
			color: "text",
			due_date: "ts",
			start_date: "ts",
			deadline: "ts",
			duration_min: "int",
			days: "int",
			sort_order: "int",
			recurrence: "text",
			recurrence_rule: "text",
			recurrence_basis: "text",
			assignment_mode: "text",
			status_id: "text",
			completed_at: "ts",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		projectVia: { kind: "column", col: "project_id" },
		refProjectCols: [
			{ col: "parent_id", table: "tasks" },
			{ col: "section_id", table: "sections" },
			{ col: "status_id", table: "statuses" },
		],
	},
	sections: {
		columns: { project_id: "text", name: "text", position: "int" },
		hasUpdatedAt: false,
		projectVia: { kind: "column", col: "project_id" },
	},
	// Editace projektu (název/barva/ikona/layout/viditelnost/archivace). `self` = členství
	// se ověřuje vůči SAMOTNÉMU projektu → editovat/archivovat smí jen člen; vytvoření nového
	// projektu přes write-path tím pádem NEjde (člen ještě neexistuje) — to řeší server/API.
	// Záměrně bez `workspace_id` (přesun mezi prostory není klientská operace).
	projects: {
		columns: {
			name: "text",
			color: "text",
			icon: "text",
			default_layout: "text",
			visibility: "text",
			kind: "text",
			owner_id: "text",
			status: "text",
			delivery_date: "ts",
			definition_of_done: "text",
			archived_at: "ts",
		},
		hasUpdatedAt: true,
		// Přejmenování/barvu smí editor; převod vlastnictví, viditelnost a archivaci jen manager.
		managerCols: ["owner_id", "visibility", "status", "archived_at"],
		projectVia: { kind: "self" },
	},
	statuses: {
		columns: {
			project_id: "text",
			name: "text",
			color: "text",
			position: "int",
			is_done: "bool",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "column", col: "project_id" },
	},
	assignments: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			completed_at: "ts",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "task", col: "task_id" },
		memberCols: ["user_id"],
	},
	comments: {
		columns: { task_id: "text", project_id: "text", body: "text" },
		hasUpdatedAt: true,
		creatorCol: "author_id",
		minRole: "commenter",
		authorEditOnly: true,
		projectVia: { kind: "task", col: "task_id" },
	},
	task_occurrence_overrides: {
		columns: {
			task_id: "text",
			project_id: "text",
			occ_date: "text",
			done: "bool",
			skipped: "bool",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "task", col: "task_id" },
	},
	// R6 — per-uživatelská barva úkolu (overlay nad tasks; syncuje se jen vlastní barva).
	task_user_colors: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			color: "text",
		},
		hasUpdatedAt: true,
		minRole: "commenter",
		ownerCol: "user_id", // barvu smí každý nastavit jen SOBĚ
		projectVia: { kind: "task", col: "task_id" },
	},
	reminders: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			type: "text",
			remind_at: "ts",
			offset_min: "int",
			channel: "text",
		},
		hasUpdatedAt: false,
		minRole: "commenter",
		ownerCol: "user_id", // připomínka je osobní → nelze injektovat push cizímu uživateli
		projectVia: { kind: "task", col: "task_id" },
	},
	// Historie úprav úkolu (audit log). Neměnný append-only záznam; autora dosadí server.
	task_activity: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			field: "text",
			old_value: "text",
			new_value: "text",
		},
		hasUpdatedAt: false,
		appendOnly: true, // audit log nelze měnit ani mazat
		ownerCol: "user_id", // „kdo změnil" = session uživatel, nepadělatelné
		projectVia: { kind: "task", col: "task_id" },
	},
	// Postupy (štafeta). Pozn.: server-authored advance (překlopení step_state) přijde s #27;
	// zde je generický zápis pro založení/úpravu řetězce členem projektu.
	chains: {
		columns: {
			project_id: "text",
			workspace_id: "text",
			template_id: "text",
			name: "text",
			description: "text",
			anchor_date: "ts",
			state: "text",
			sched_mode: "text",
			skip_weekend: "int",
			completed_at: "ts",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		projectVia: { kind: "column", col: "project_id" },
	},
	chain_steps: {
		columns: {
			chain_id: "text",
			task_id: "text",
			project_id: "text",
			position: "int",
			gate: "text",
			step_state: "text",
			// Plánovací offsety (Kotva/Řetězec) — builder je zapisuje, musí projít do Postgresu.
			anchor_offset: "int",
			gap_days: "int",
			activated_at: "ts",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "column", col: "project_id" },
		refProjectCols: [{ col: "task_id", table: "tasks" }],
	},
	// Cíle — workspace-scoped (membership přes memberships, ne project_members).
	goals: {
		columns: {
			workspace_id: "text",
			name: "text",
			scope: "text",
			metric: "text",
			target: "int",
			due_date: "ts",
			period: "text",
			periodic: "text",
			period_start: "ts",
			filter_person_id: "text",
			filter_keyword: "text",
			owner_id: "text",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
	goal_projects: {
		columns: { goal_id: "text", project_id: "text", workspace_id: "text" },
		hasUpdatedAt: false,
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
	goal_milestones: {
		columns: {
			goal_id: "text",
			workspace_id: "text",
			label: "text",
			done: "bool",
			position: "int",
		},
		hasUpdatedAt: false,
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
};

type Op = "PUT" | "PATCH" | "DELETE";
type Db = ReturnType<typeof getDb>;
// biome-ignore lint: drizzle execute vrací driver-specific řádky
type Rows = any;

/**
 * Deterministická chyba dat/omezení Postgresu (class 22 = data exception, 23 = integrity
 * constraint) → 400, ať klient op zahodí a NEblokuje upload frontu (500 = PowerSync retry forever).
 * POZOR: SQLSTATE není jen 5 číslic — např. `22P02` (invalid_text_representation, neplatné UUID/enum)
 * má písmeno. Dřívější `^(22|23)\d{3}$` ho minul → vracelo 500 → zaseklá fronta a ztráta offline dat.
 */
function isDeterministicDbError(err: unknown): boolean {
	const code = (err as { code?: string }).code;
	return typeof code === "string" && /^(22|23)[0-9A-Za-z]{3}$/.test(code);
}

function coerce(type: ColType, v: unknown): unknown {
	if (v == null) return null;
	if (type === "int") return typeof v === "number" ? v : Number(v);
	if (type === "bool")
		return v === true || v === 1 || v === "1" || v === "true";
	return String(v); // text + ts (ISO string → timestamptz cast Postgresem)
}

async function projectViaTask(
	db: Db,
	taskId: string | null,
): Promise<string | null> {
	if (!taskId) return null;
	const rows = (await db.execute(
		sql`SELECT project_id AS pid FROM tasks WHERE id = ${taskId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.pid as string) ?? null;
}

/** Cílový projekt řádku z PŘÍCHOZÍCH DAT (kam se řádek umístí). */
async function projectFromData(
	db: Db,
	def: TableDef,
	data: Record<string, unknown>,
	id: string,
): Promise<string | null> {
	const via = def.projectVia;
	if (!via) return null;
	if (via.kind === "self") return id;
	const v = (data[via.col] as string) ?? null;
	return via.kind === "column" ? v : projectViaTask(db, v);
}

/** Současný projekt EXISTUJÍCÍHO řádku z DB. */
async function projectFromDb(
	db: Db,
	table: string,
	def: TableDef,
	id: string,
): Promise<string | null> {
	const via = def.projectVia;
	if (!via) return null;
	if (via.kind === "self") {
		const rows = (await db.execute(
			sql`SELECT id AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
		)) as Rows;
		return (rows[0]?.v as string) ?? null;
	}
	const rows = (await db.execute(
		sql`SELECT ${sql.raw(via.col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	const v = (rows[0]?.v as string) ?? null;
	return via.kind === "column" ? v : projectViaTask(db, v);
}

/** Projekt řádku libovolné tabulky se sloupcem project_id (tasks/sections/statuses). */
async function projectOfRow(
	db: Db,
	table: string,
	id: string,
): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT project_id AS pid FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.pid as string) ?? null;
}

async function isProjectMember(
	db: Db,
	projectId: string,
	userId: string,
): Promise<boolean> {
	const rows = (await db.execute(
		sql`SELECT 1 AS ok FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`,
	)) as Rows;
	return rows.length > 0;
}

/** Projektová role uživatele (project_members) — null = není člen projektu. */
async function projectRole(
	db: Db,
	projectId: string,
	userId: string,
): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.role as string) ?? null;
}

/** Hodnota creatorCol existujícího řádku (autor komentáře apod.) — pro authorEditOnly. */
async function creatorOfRow(
	db: Db,
	table: string,
	col: string,
	id: string,
): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT ${sql.raw(col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.v as string) ?? null;
}

/** Role uživatele v prostoru (memberships) — null = není člen. */
async function workspaceRole(
	db: Db,
	workspaceId: string,
	userId: string,
): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT role FROM memberships WHERE workspace_id = ${workspaceId} AND user_id = ${userId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.role as string) ?? null;
}

/** Workspace_id existujícího řádku workspace-scoped tabulky (dle workspaceVia sloupce). */
async function workspaceFromDb(
	db: Db,
	table: string,
	def: TableDef,
	id: string,
): Promise<string | null> {
	if (!def.workspaceVia) return null;
	const rows = (await db.execute(
		sql`SELECT ${sql.raw(def.workspaceVia.col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.v as string) ?? null;
}

/**
 * R-oprávnění (#14): „Host" (workspace_role = guest) je jen pro čtení. True, pokud je uživatel
 * v prostoru daného projektu členem s rolí guest → jakýkoli zápis se odmítne.
 */
async function isWorkspaceGuest(
	db: Db,
	projectId: string,
	userId: string,
): Promise<boolean> {
	const rows = (await db.execute(
		sql`SELECT m.role AS role FROM projects p
        JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ${userId}
        WHERE p.id = ${projectId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.role as string) === "guest";
}

/** Generický zápis dle registru (INSERT … ON CONFLICT / UPDATE / DELETE). */
async function applyWrite(
	db: Db,
	table: string,
	def: TableDef,
	op: Op,
	id: string,
	data: Record<string, unknown>,
	userId: string,
): Promise<void> {
	if (op === "DELETE") {
		await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE id = ${id}`);
		return;
	}

	const set: { col: string; val: unknown }[] = Object.keys(def.columns)
		.filter((c) => c in data)
		.map((c) => ({ col: c, val: coerce(def.columns[c]!, data[c]) }));
	if (op === "PUT" && def.creatorCol)
		set.push({ col: def.creatorCol, val: userId });

	if (op === "PUT") {
		const cols = ["id", ...set.map((s) => s.col)];
		const vals = [sql`${id}`, ...set.map((s) => sql`${s.val}`)];
		const updates = set.map(
			(s) => sql`${sql.raw(s.col)} = EXCLUDED.${sql.raw(s.col)}`,
		);
		if (def.hasUpdatedAt) updates.push(sql`updated_at = now()`);
		await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (${sql.join(
				cols.map((c) => sql.raw(c)),
				sql`, `,
			)})
      VALUES (${sql.join(vals, sql`, `)})
      ON CONFLICT (id) DO UPDATE SET ${sql.join(updates, sql`, `)}
    `);
		return;
	}

	// PATCH — jen sloupce přítomné v datech
	const updates = set.map((s) => sql`${sql.raw(s.col)} = ${s.val}`);
	if (def.hasUpdatedAt) updates.push(sql`updated_at = now()`);
	if (updates.length === 0) return;
	await db.execute(
		sql`UPDATE ${sql.raw(table)} SET ${sql.join(updates, sql`, `)} WHERE id = ${id}`,
	);
}

/**
 * Upload write z klienta. Tělo: { op: 'PUT'|'PATCH'|'DELETE', table, id, data }.
 * Row-level kontrola (R5): uživatel musí být členem projektu, kam řádek patří.
 */
powersyncRoutes.post("/api/sync/write", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const userId = session.user.id;

	const body = (await c.req.json()) as {
		op: Op;
		table: string;
		id: string;
		data?: Record<string, unknown>;
	};

	const def = TABLES[body.table];
	if (!def)
		return c.json({ error: `tabulka '${body.table}' není zapisovatelná` }, 400);

	const data = body.data ?? {};
	const db = getDb();

	// Append-only tabulky (audit log): měnit ani mazat nelze.
	if (def.appendOnly && body.op !== "PUT")
		return c.json({ error: "append-only" }, 403);

	// Vlastníkův sloupec (osobní připomínky/barvy/audit) — server VŽDY dosadí session userId.
	// Klient nemůže padělat cizí identitu ani injektovat řádek do overlaye/pushe jiného uživatele.
	if (def.ownerCol && (body.op === "PUT" || body.op === "PATCH"))
		data[def.ownerCol] = userId;

	// Workspace-scoped tabulky (cíle): membership + role kontrola přes memberships.
	if (def.workspaceVia) {
		const wsNeed = new Set<string>();
		if (body.op === "PUT" || body.op === "PATCH") {
			const w = (data[def.workspaceVia.col] as string) ?? null;
			if (w) wsNeed.add(w);
		}
		const cur = await workspaceFromDb(db, body.table, def, body.id);
		if (cur) wsNeed.add(cur);
		if (!(body.op === "DELETE" && wsNeed.size === 0)) {
			if (wsNeed.size === 0) return c.json({ error: "forbidden" }, 403);
			for (const w of wsNeed) {
				const role = await workspaceRole(db, w, userId);
				if (!role) return c.json({ error: "forbidden" }, 403);
				if (role === "guest") return c.json({ error: "read-only-host" }, 403);
			}
		}
		try {
			await applyWrite(db, body.table, def, body.op, body.id, data, userId);
		} catch (err) {
			console.error("[watson-api] write selhal:", err);
			return c.json({ error: String(err) }, isDeterministicDbError(err) ? 400 : 500);
		}
		return c.json({ ok: true });
	}

	// Autorizace i zápis v JEDNOM try/catch — i chyba membership dotazu (např. neplatné UUID
	// v project_id → 22P02) tak skončí jako 400, ne jako 500 zaseklé donekonečna.
	try {
		// R5 — uživatel musí být členem KAŽDÉHO projektu, kterého se řádek dotkne:
		// cílový (z dat), současný (z DB — i u PUT kvůli upsert ON CONFLICT) a projekty FK referencí.
		const need = new Set<string>();
		if (body.op === "PUT" || body.op === "PATCH") {
			const t = await projectFromData(db, def, data, body.id);
			if (t) need.add(t);
			// Anti-spoof: denormalizovaný project_id (řídí sync bucket) MUSÍ odpovídat projektu
			// odvozenému z task_id — jinak by šel řádek podstrčit do cizího bucketu (#3).
			if (t && def.projectVia?.kind === "task") data.project_id = t;
		}
		if (body.op === "PUT" || body.op === "PATCH" || body.op === "DELETE") {
			const cur = await projectFromDb(db, body.table, def, body.id);
			if (cur) need.add(cur);
		}
		// FK reference (parent_id/section_id/status_id) musí ukazovat do projektu, kde je útočník člen.
		for (const ref of def.refProjectCols ?? []) {
			const refId = data[ref.col] as string | undefined;
			if (refId) {
				const p = await projectOfRow(db, ref.table, refId);
				if (p) need.add(p);
			}
		}
		// DELETE neexistujícího řádku = no-op (idempotentní upload).
		if (!(body.op === "DELETE" && need.size === 0)) {
			if (need.size === 0) return c.json({ error: "forbidden" }, 403);
			const minRank = PROJECT_ROLE_RANK[def.minRole ?? "editor"] ?? 2;
			for (const p of need) {
				const role = await projectRole(db, p, userId);
				if (!role) return c.json({ error: "forbidden" }, 403);
				// Host (workspace guest) = read-only → odmítni jakýkoli zápis.
				if (await isWorkspaceGuest(db, p, userId))
					return c.json({ error: "read-only-host" }, 403);
				// Projektová role musí stačit na daný typ zápisu (#1: commenter ≠ editor ≠ manager).
				if ((PROJECT_ROLE_RANK[role] ?? 0) < minRank)
					return c.json({ error: "insufficient-role" }, 403);
				// Destruktivní operace na projektu (smazání, převod vlastnictví, viditelnost,
				// archivace) smí jen manager — commenter/editor je nesmí (#1).
				const touchesManagerCol =
					body.op === "PATCH" &&
					(def.managerCols ?? []).some((mc) => mc in data);
				if (
					(body.op === "DELETE" && def.projectVia?.kind === "self") ||
					touchesManagerCol
				) {
					if (role !== "manager")
						return c.json({ error: "manager-only" }, 403);
				}
			}
		}
		// PATCH/DELETE komentáře smí jen autor (nebo manager projektu) — #10.
		if (
			def.authorEditOnly &&
			def.creatorCol &&
			(body.op === "PATCH" || body.op === "DELETE")
		) {
			const author = await creatorOfRow(db, body.table, def.creatorCol, body.id);
			if (author && author !== userId) {
				let ok = false;
				for (const p of need) {
					if ((await projectRole(db, p, userId)) === "manager") ok = true;
				}
				if (!ok) return c.json({ error: "author-only" }, 403);
			}
		}
		// member sloupce (assignments.user_id) musí být člen projektu řádku.
		for (const col of def.memberCols ?? []) {
			const uid = data[col] as string | undefined;
			if (!uid) continue;
			for (const p of need) {
				if (!(await isProjectMember(db, p, uid))) {
					return c.json({ error: "assignee not a project member" }, 403);
				}
			}
		}

		await applyWrite(db, body.table, def, body.op, body.id, data, userId);
	} catch (err) {
		console.error("[watson-api] write selhal:", err);
		return c.json({ error: String(err) }, isDeterministicDbError(err) ? 400 : 500);
	}

	return c.json({ ok: true });
});
