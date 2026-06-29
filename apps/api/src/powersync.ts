/**
 * PowerSync backend integrace:
 *  - JWKS endpoint (RS256) — PowerSync service jím ověřuje klientské tokeny,
 *  - token endpoint — vydá krátkodobý JWT (sub = user id) přihlášenému uživateli,
 *  - write endpoint — aplikuje upload frontu klienta (CRUD) do Postgresu s kontrolou práv.
 *
 * Dev keypair se generuje jednou a ukládá do apps/api/.keys (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { type JWK, SignJWT, exportJWK, generateKeyPair, importJWK } from "jose";
import { and, eq, getDb, projectMembers, sql, tasks } from "@watson/db";
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

/**
 * Upload write z klienta. Tělo: { op: 'PUT'|'PATCH'|'DELETE', table, id, data }.
 * MVP: jen tabulka `tasks`, s kontrolou členství v projektu (R5 row-level).
 */
powersyncRoutes.post("/api/sync/write", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const userId = session.user.id;

  const body = (await c.req.json()) as {
    op: "PUT" | "PATCH" | "DELETE";
    table: string;
    id: string;
    data?: Record<string, unknown>;
  };

  if (body.table !== "tasks") {
    return c.json({ error: `tabulka '${body.table}' zatím není podporovaná` }, 400);
  }

  const db = getDb();

  // Ověř členství v projektu (R5). Pro PUT/PATCH z dat, pro DELETE z DB.
  async function assertProjectMember(projectId: string) {
    const m = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return m.length > 0;
  }

  // Projekt úkolu pro kontrolu členství: u PUT z dat, u PATCH/DELETE z DB.
  async function taskProjectId(): Promise<string | null> {
    if (body.op === "PUT") return (body.data?.project_id as string) ?? null;
    const row = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, body.id))
      .limit(1);
    return row[0]?.projectId ?? null;
  }

  const projectId = await taskProjectId();
  // DELETE neexistujícího úkolu je no-op (idempotentní upload).
  if (body.op !== "DELETE" || projectId) {
    if (!projectId || !(await assertProjectMember(projectId))) {
      return c.json({ error: "forbidden" }, 403);
    }
  }

  const data = body.data ?? {};
  // Zápis přes parametrizované raw SQL — obchází mapování typů drizzle a plně řídí
  // timestamp/null (postgres-js cast ISO string / NULL → timestamptz).
  const completed = (data.completed_at as string | undefined) ?? null;
  const color = (data.color as string | undefined) ?? null;
  const due = (data.due_date as string | undefined) ?? null;

  try {
    if (body.op === "PUT") {
      await db.execute(sql`
        INSERT INTO tasks (id, project_id, name, priority, color, due_date, created_by, completed_at)
        VALUES (${body.id}, ${projectId}, ${(data.name as string) ?? ""},
                ${(data.priority as number) ?? 4}, ${color}, ${due}, ${userId}, ${completed})
        ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              priority = EXCLUDED.priority,
              color = EXCLUDED.color,
              due_date = EXCLUDED.due_date,
              completed_at = EXCLUDED.completed_at,
              updated_at = now()
      `);
    } else if (body.op === "PATCH") {
      await db.execute(sql`
        UPDATE tasks SET
          name = COALESCE(${(data.name as string) ?? null}, name),
          priority = COALESCE(${(data.priority as number) ?? null}, priority),
          color = ${"color" in data ? color : sql`color`},
          due_date = ${"due_date" in data ? due : sql`due_date`},
          completed_at = ${"completed_at" in data ? completed : sql`completed_at`},
          updated_at = now()
        WHERE id = ${body.id}
      `);
    } else {
      await db.execute(sql`DELETE FROM tasks WHERE id = ${body.id}`);
    }
  } catch (err) {
    console.error("[watson-api] write selhal:", err);
    return c.json({ error: String(err) }, 500);
  }

  return c.json({ ok: true });
});
