import "./env"; // načte .env (musí být první)
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  and,
  eq,
  getDb,
  memberships,
  projectMembers,
  projects,
  statuses,
  users,
  workspaces,
} from "@watson/db";
import { DEFAULT_LOCALE } from "@watson/shared";
import { auth } from "./auth";
import { env, googleEnabled } from "./env";
import { powersyncRoutes } from "./powersync";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: env.webOrigin,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "watson-api",
    locale: DEFAULT_LOCALE,
    auth: { emailPassword: true, twoFactor: true, magicLink: "dev", google: googleEnabled },
    time: new Date().toISOString(),
  }),
);

/** Better Auth — všechny auth endpointy (/api/auth/sign-up, sign-in, two-factor, ...). */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/** PowerSync — JWKS, token, write upload. */
app.route("/", powersyncRoutes);

/** Aktuální uživatel + session. */
app.get("/api/me", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ user: null }, 401);
  return c.json({ user: session.user });
});

/** Workspaces přihlášeného uživatele (přes membership). */
app.get("/api/workspaces", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const db = getDb();
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      isPersonal: workspaces.isPersonal,
      color: workspaces.color,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, session.user.id));

  return c.json({ workspaces: rows });
});

/** Projekty přihlášeného uživatele (přes project membership). */
app.get("/api/projects", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const db = getDb();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      workspaceId: projects.workspaceId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(eq(projectMembers.userId, session.user.id));

  return c.json({ projects: rows });
});

/** Založení projektu (#15): projekt + členství zakladatele (manager) + výchozí statusy. */
app.post("/api/projects", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    workspaceId?: string;
    color?: string;
    kind?: string;
  };
  const name = (body.name ?? "").trim();
  if (!name || !body.workspaceId) return c.json({ error: "name and workspaceId required" }, 400);

  const db = getDb();
  // zakladatel musí být členem prostoru (a ne Host)
  const mine = (
    await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(eq(memberships.workspaceId, body.workspaceId), eq(memberships.userId, session.user.id)),
      )
  )[0];
  if (!mine) return c.json({ error: "forbidden" }, 403);
  if (mine.role === "guest") return c.json({ error: "read-only-host" }, 403);

  const kind = body.kind === "goal" || body.kind === "cycle" ? body.kind : "flow";
  const [project] = await db
    .insert(projects)
    .values({
      name,
      workspaceId: body.workspaceId,
      color: body.color ?? null,
      kind,
      ownerId: session.user.id,
    })
    .returning();
  if (!project) return c.json({ error: "insert failed" }, 500);

  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: session.user.id, role: "manager" });
  // výchozí statusy (Board sloupce, R9)
  await db.insert(statuses).values([
    { scope: "project", projectId: project.id, name: "K udělání", position: 0, isDone: false },
    { scope: "project", projectId: project.id, name: "Probíhá", position: 1, isDone: false },
    { scope: "project", projectId: project.id, name: "Hotovo", position: 2, isDone: true },
  ]);

  return c.json({ project });
});

/** Členové workspace (jen pro člena) — Nastavení → Tým a role. */
app.get("/api/workspaces/:id/members", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const wsId = c.req.param("id");
  const db = getDb();

  const mine = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, session.user.id)));
  if (mine.length === 0) return c.json({ error: "forbidden" }, 403);

  const ws = (
    await db
      .select({ id: workspaces.id, name: workspaces.name, ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, wsId))
  )[0];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      job: users.jobTitle,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.workspaceId, wsId));

  return c.json({
    workspace: ws ?? null,
    members: rows.map((r) => ({ ...r, isOwner: ws?.ownerId === r.id })),
  });
});

/** Změna role člena workspace (jen owner/admin; vlastníkův řádek nelze měnit). */
app.patch("/api/workspaces/:id/members/:userId/role", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const wsId = c.req.param("id");
  const targetId = c.req.param("userId");
  const role = ((await c.req.json().catch(() => ({}))) as { role?: string }).role;
  if (role !== "admin" && role !== "member" && role !== "guest")
    return c.json({ error: "invalid role" }, 400);

  const db = getDb();
  const ws = (
    await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, wsId))
  )[0];
  const mine = (
    await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, session.user.id)))
  )[0];
  const canManage =
    ws?.ownerId === session.user.id || mine?.role === "admin" || mine?.role === "manager";
  if (!canManage) return c.json({ error: "forbidden" }, 403);
  if (ws?.ownerId === targetId) return c.json({ error: "cannot change owner role" }, 400);

  await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, targetId)));
  return c.json({ ok: true });
});

/** Členové projektu (jen pro člena) — Projekty detail (vlastník + avatary). */
app.get("/api/projects/:id/members", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const pid = c.req.param("id");
  const db = getDb();
  const mine = await db
    .select({ r: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, pid), eq(projectMembers.userId, session.user.id)));
  if (mine.length === 0) return c.json({ error: "forbidden" }, 403);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, image: users.image })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, pid));
  return c.json({ members: rows });
});

serve({ fetch: app.fetch, port: env.apiPort }, (info) => {
  console.log(`[watson-api] běží na http://localhost:${info.port}`);
  console.log(`[watson-api] Google login: ${googleEnabled ? "zapnut" : "vypnut (chybí klíče)"}`);
});

export type AppType = typeof app;
