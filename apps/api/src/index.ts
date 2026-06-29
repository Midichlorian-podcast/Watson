import "./env"; // načte .env (musí být první)
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, getDb, memberships, projectMembers, projects, workspaces } from "@watson/db";
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

serve({ fetch: app.fetch, port: env.apiPort }, (info) => {
  console.log(`[watson-api] běží na http://localhost:${info.port}`);
  console.log(`[watson-api] Google login: ${googleEnabled ? "zapnut" : "vypnut (chybí klíče)"}`);
});

export type AppType = typeof app;
