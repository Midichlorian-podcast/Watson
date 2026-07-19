/** End-to-end API proof for the owner-only Employee Hub and LuckyOS projection boundary. */
import "./src/env";
import {
  and,
  entityLinks,
  eq,
  getDb,
  memberships,
  projects,
  sql,
  tasks,
  users,
  workspaces,
} from "@watson/db";

const API = process.env.EMPLOYEE_HUB_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
  }
}

async function login(email: string) {
  const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
  });
  if (!requested.ok) throw new Error(`employee_hub_magic_link:${requested.status}`);
  const rows = (await db.execute(
    sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
  )) as unknown as Array<{ identifier: string }>;
  const verified = await fetch(
    `${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
    { redirect: "manual" },
  );
  const raw =
    verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
  const cookie = raw
    .split(/,(?=\s*\w+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("employee_hub_login_cookie_missing");
  return cookie;
}

async function request(cookie: string | null, path: string, method = "GET") {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Origin: "http://localhost:5173",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? "{}" : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: JSON.parse(text || "{}") as Record<string, unknown>,
    cacheControl: response.headers.get("cache-control") ?? "",
  };
}

async function main() {
  if (!process.env.LUCKYOS_BASE_URL?.startsWith("http://127.0.0.1:")) {
    throw new Error("employee hub verifier requires the local LuckyOS stub");
  }
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({
      name: "Employee Hub verifier",
      email: `employee-hub-${suffix}@watson.test`,
      emailVerified: true,
    })
    .returning({ id: users.id, email: users.email });
  if (!user) throw new Error("employee_hub_user_missing");
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Employee Hub ${suffix}`, ownerId: user.id, isPersonal: true })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error("employee_hub_workspace_missing");
  await db
    .insert(memberships)
    .values({ workspaceId: workspace.id, userId: user.id, role: "admin" });

  try {
    const unauthorized = await request(null, "/api/employee/status");
    check(
      "employee status vyžaduje session a ani chybu nelze cachovat",
      unauthorized.status === 401 && unauthorized.cacheControl.includes("no-store"),
      unauthorized,
    );
    const cookie = await login(user.email);
    const identity = await request(cookie, "/api/employee/me");
    const identityPerson = identity.body.person as Record<string, unknown> | undefined;
    check(
      "gating identita je validovaná a minimalizovaná",
      identity.status === 200 &&
        identity.body.linked === true &&
        identityPerson?.fullName === "CI Employee" &&
        Object.keys(identityPerson ?? {})
          .sort()
          .join(",") === "fullName,id,personType",
      identity,
    );
    check(
      "identita nepropustí e-mail, roli ani upstream metadata",
      ![user.email, "role", "upstream_secret", "must-not-leak"].some((needle) =>
        identity.text.includes(needle),
      ),
      identity.text,
    );

    const statusResponse = await request(cookie, "/api/employee/status");
    const status = statusResponse.body.status as Record<string, unknown> | undefined;
    const readiness = status?.readiness as Record<string, unknown> | undefined;
    const blockers = readiness?.blockers as Array<Record<string, unknown>> | undefined;
    const deadlines = status?.deadlines as Record<string, unknown> | undefined;
    const countdowns = deadlines?.countdowns as Array<Record<string, unknown>> | undefined;
    const notifications = status?.notifications as Array<Record<string, unknown>> | undefined;
    const submissions = status?.submissions as
      | Record<string, Array<Record<string, unknown>>>
      | undefined;
    check(
      "status zachová užitečný readiness, termín, progres a oznámení",
      statusResponse.status === 200 &&
        statusResponse.body.linked === true &&
        readiness?.status === "blocked" &&
        blockers?.[0]?.href === "/employee/documents" &&
        countdowns?.[0]?.daysRemaining === 3 &&
        (status?.dppProgress as Record<string, unknown> | undefined)?.hoursUsed === 120 &&
        notifications?.length === 2,
      statusResponse.body,
    );
    check(
      "absolutní provider odkaz se nepropustí do klienta",
      notifications?.[0]?.href === "/employee/documents" && notifications?.[1]?.href === null,
      notifications,
    );
    check(
      "status má allowlist projekci a zákaz cachování citlivého pohledu",
      statusResponse.cacheControl.includes("private") &&
        statusResponse.cacheControl.includes("no-store") &&
        !statusResponse.text.includes("must-not-leak") &&
        !statusResponse.text.includes("private_email") &&
        !statusResponse.text.includes("provider_only") &&
        Object.keys(submissions?.attendance?.[0] ?? {})
          .sort()
          .join(",") === "id,periodMonth,periodYear,reviewerNote,status,updatedAt",
      statusResponse.text,
    );

    const firstSync = await request(cookie, "/api/employee/sync", "POST");
    const replaySync = await request(cookie, "/api/employee/sync", "POST");
    const employeeProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspace.id), eq(projects.name, "Zaměstnanec")));
    const createdTasks = employeeProjects[0]
      ? await db.select().from(tasks).where(eq(tasks.projectId, employeeProjects[0].id))
      : [];
    const links = await db
      .select()
      .from(entityLinks)
      .where(eq(entityLinks.workspaceId, workspace.id));
    check(
      "akční notifikace vytvoří jeden owner-only úkol s lineage",
      firstSync.status === 200 &&
        firstSync.body.created === 1 &&
        createdTasks.length === 1 &&
        createdTasks[0]?.name === "Doplň potvrzení" &&
        links.length === 1,
      { firstSync: firstSync.body, createdTasks, links },
    );
    check(
      "opakovaný sync je idempotentní a necachovatelný",
      replaySync.status === 200 &&
        replaySync.body.created === 0 &&
        replaySync.body.skipped === 1 &&
        replaySync.cacheControl.includes("no-store"),
      replaySync,
    );
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    await db.delete(users).where(eq(users.id, user.id));
  }

  if (failed > 0) {
    console.error(`\nEmployee Hub API: ${failed} SELHALO`);
    process.exit(1);
  }
  console.log("\nEmployee Hub API: vše prošlo");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
