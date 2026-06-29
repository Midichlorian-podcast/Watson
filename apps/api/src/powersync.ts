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
import { Hono } from "hono";
import { type JWK, SignJWT, exportJWK, generateKeyPair, importJWK } from "jose";
import { getDb, sql } from "@watson/db";
import { auth } from "./auth";

const KID = "watson-dev-1";
const ALG = "RS256";
const AUDIENCE = "powersync";
const keyDir = fileURLToPath(new URL("../.keys", import.meta.url));
const keyFile = fileURLToPath(new URL("../.keys/powersync-key.json", import.meta.url));

let privateKey: CryptoKey;
let publicJwk: JWK;

async function loadKeys() {
  if (existsSync(keyFile)) {
    const stored = JSON.parse(readFileSync(keyFile, "utf8")) as { privateJwk: JWK; publicJwk: JWK };
    privateKey = (await importJWK(stored.privateJwk, ALG)) as CryptoKey;
    publicJwk = stored.publicJwk;
    return;
  }
  const { privateKey: priv, publicKey: pub } = await generateKeyPair(ALG, { extractable: true });
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
powersyncRoutes.get("/api/powersync/jwks", (c) => c.json({ keys: [publicJwk] }));

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
  /** Jak zjistit project_id pro membership kontrolu (R5). */
  projectVia: { kind: "column"; col: string } | { kind: "task"; col: string };
}

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
      recurrence: "text",
      recurrence_basis: "text",
      assignment_mode: "text",
      status_id: "text",
      completed_at: "ts",
    },
    hasUpdatedAt: true,
    creatorCol: "created_by",
    projectVia: { kind: "column", col: "project_id" },
  },
  sections: {
    columns: { project_id: "text", name: "text", position: "int" },
    hasUpdatedAt: false,
    projectVia: { kind: "column", col: "project_id" },
  },
  assignments: {
    columns: { task_id: "text", user_id: "text", completed_at: "ts" },
    hasUpdatedAt: false,
    projectVia: { kind: "task", col: "task_id" },
  },
  checklist_items: {
    columns: { task_id: "text", text: "text", checked: "bool", position: "int" },
    hasUpdatedAt: false,
    projectVia: { kind: "task", col: "task_id" },
  },
  comments: {
    columns: { task_id: "text", body: "text" },
    hasUpdatedAt: true,
    creatorCol: "author_id",
    projectVia: { kind: "task", col: "task_id" },
  },
};

type Op = "PUT" | "PATCH" | "DELETE";
type Db = ReturnType<typeof getDb>;
// biome-ignore lint: drizzle execute vrací driver-specific řádky
type Rows = any;

function coerce(type: ColType, v: unknown): unknown {
  if (v == null) return null;
  if (type === "int") return typeof v === "number" ? v : Number(v);
  if (type === "bool") return v === true || v === 1 || v === "1" || v === "true";
  return String(v); // text + ts (ISO string → timestamptz cast Postgresem)
}

async function projectViaTask(db: Db, taskId: string | null): Promise<string | null> {
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
): Promise<string | null> {
  const v = (data[def.projectVia.col] as string) ?? null;
  return def.projectVia.kind === "column" ? v : projectViaTask(db, v);
}

/** Současný projekt EXISTUJÍCÍHO řádku z DB. */
async function projectFromDb(
  db: Db,
  table: string,
  def: TableDef,
  id: string,
): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT ${sql.raw(def.projectVia.col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
  )) as Rows;
  const v = (rows[0]?.v as string) ?? null;
  return def.projectVia.kind === "column" ? v : projectViaTask(db, v);
}

async function isProjectMember(db: Db, projectId: string, userId: string): Promise<boolean> {
  const rows = (await db.execute(
    sql`SELECT 1 AS ok FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`,
  )) as Rows;
  return rows.length > 0;
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
  if (op === "PUT" && def.creatorCol) set.push({ col: def.creatorCol, val: userId });

  if (op === "PUT") {
    const cols = ["id", ...set.map((s) => s.col)];
    const vals = [sql`${id}`, ...set.map((s) => sql`${s.val}`)];
    const updates = set.map((s) => sql`${sql.raw(s.col)} = EXCLUDED.${sql.raw(s.col)}`);
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
  if (!def) return c.json({ error: `tabulka '${body.table}' není zapisovatelná` }, 400);

  const data = body.data ?? {};
  const db = getDb();

  // R5 — uživatel musí být členem KAŽDÉHO projektu, kterého se řádek dotkne
  // (cílový z dat i současný z DB) → brání přesunu řádku do/z cizího projektu.
  const need = new Set<string>();
  if (body.op === "PUT" || body.op === "PATCH") {
    const t = await projectFromData(db, def, data);
    if (t) need.add(t);
  }
  if (body.op === "PATCH" || body.op === "DELETE") {
    const cur = await projectFromDb(db, body.table, def, body.id);
    if (cur) need.add(cur);
  }
  // DELETE neexistujícího řádku = no-op (idempotentní upload).
  if (!(body.op === "DELETE" && need.size === 0)) {
    if (need.size === 0) return c.json({ error: "forbidden" }, 403);
    for (const p of need) {
      if (!(await isProjectMember(db, p, userId))) return c.json({ error: "forbidden" }, 403);
    }
  }

  try {
    await applyWrite(db, body.table, def, body.op, body.id, data, userId);
  } catch (err) {
    console.error("[watson-api] write selhal:", err);
    return c.json({ error: String(err) }, 500);
  }

  return c.json({ ok: true });
});
