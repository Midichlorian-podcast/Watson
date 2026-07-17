/** F5/M2 proof: personal message -> task is owner-only, idempotent and durable. */
import "./src/env";
import {
  accounts,
  and,
  assignments,
  auditEvents,
  eq,
  getDb,
  inArray,
  mailAccounts,
  mailMessages,
  mailTaskLinks,
  memberships,
  projectMembers,
  projects,
  tasks,
  users,
  workspaces,
} from "@watson/db";
import { hashPassword } from "better-auth/crypto";
import { scanMailSync } from "./src/mailSync";

const API = process.env.MAIL_API ?? "http://127.0.0.1:8790";
const STUB = process.env.MAIL_GOOGLE_API_BASE_URL ?? "http://127.0.0.1:8793";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
  }
};

function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: string; cause?: unknown };
    if (value.code) return value.code;
    current = value.cause;
  }
  return undefined;
}

async function provision(slug: string) {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const email = `mail-execution-${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@watson.test`;
  const password = `Watson-${crypto.randomUUID()}-A1!`;
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: userId, name: `Mail Execution ${slug}`, email, emailVerified: true });
    await tx.insert(accounts).values({
      id: crypto.randomUUID(),
      userId,
      accountId: email,
      providerId: "credential",
      password: await hashPassword(password),
    });
    await tx
      .insert(workspaces)
      .values({
        id: workspaceId,
        name: `Mail Execution ${slug}`,
        ownerId: userId,
        isPersonal: true,
      });
    await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
    await tx
      .insert(projects)
      .values({ id: projectId, workspaceId, name: "Osobní schránka", ownerId: userId });
    await tx.insert(projectMembers).values({ projectId, userId, role: "manager" });
  });
  return { userId, workspaceId, projectId, email, password };
}

async function login(email: string, password: string) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`mail execution login failed: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function request(cookie: string | null, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: {
      Origin: "http://localhost:5173",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    // Redirect response.
  }
  return { status: response.status, body: parsed, location: response.headers.get("location") };
}

async function connect(cookie: string) {
  const started = await request(cookie, "/api/mail/oauth/google/start", "POST");
  const authorizationUrl = String(started.body.authorizationUrl ?? "");
  const provider = await fetch(authorizationUrl, { redirect: "manual" });
  const callback = provider.headers.get("location");
  if (!callback) throw new Error("mail execution provider callback missing");
  const completed = await request(cookie, callback.replace(API, ""));
  if (!completed.location?.includes("mailConnection=success"))
    throw new Error(`mail execution connect failed: ${completed.location}`);
}

async function resetMailbox(email: string) {
  const response = await fetch(`${STUB}/test/mailbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, action: "reset", count: 3 }),
  });
  if (!response.ok) throw new Error(`mail execution mailbox reset failed: ${response.status}`);
}

async function drain(accountId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await scanMailSync();
    const account = (
      await db
        .select({ lastSuccessAt: mailAccounts.lastSuccessAt })
        .from(mailAccounts)
        .where(eq(mailAccounts.id, accountId))
    )[0];
    if (account?.lastSuccessAt) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("mail execution sync timeout");
}

async function main() {
  const owner = await provision("owner");
  const stranger = await provision("stranger");
  const teamWorkspaceId = crypto.randomUUID();
  const teamProjectId = crypto.randomUUID();
  try {
    await db
      .insert(workspaces)
      .values({
        id: teamWorkspaceId,
        name: "Cizí týmový scope",
        ownerId: owner.userId,
        isPersonal: false,
      });
    await db
      .insert(memberships)
      .values({ workspaceId: teamWorkspaceId, userId: owner.userId, role: "admin" });
    await db
      .insert(projects)
      .values({
        id: teamProjectId,
        workspaceId: teamWorkspaceId,
        name: "Týmový projekt",
        ownerId: owner.userId,
      });
    await db
      .insert(projectMembers)
      .values({ projectId: teamProjectId, userId: owner.userId, role: "manager" });
    await resetMailbox(owner.email);
    const ownerCookie = await login(owner.email, owner.password);
    const strangerCookie = await login(stranger.email, stranger.password);
    await connect(ownerCookie);
    const account = (
      await db
        .select()
        .from(mailAccounts)
        .where(eq(mailAccounts.ownerUserId, owner.userId))
        .limit(1)
    )[0];
    if (!account) throw new Error("mail execution account missing");
    await drain(account.id);
    const messages = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.accountId, account.id));
    const message = messages[0];
    const otherMessage = messages[1];
    const concurrentMessage = messages[2];
    if (!message || !otherMessage || !concurrentMessage)
      throw new Error("mail execution messages missing");

    let response = await request(null, `/api/mail/accounts/${account.id}/executions`);
    check("execution registry je bez session fail-closed", response.status === 401, response);
    response = await request(strangerCookie, `/api/mail/accounts/${account.id}/executions`);
    check("cizí uživatel nevidí ani existenci vazeb", response.status === 404, response);

    const operationId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const command = {
      operationId,
      taskId,
      projectId: owner.projectId,
      name: "Prověřit odpověď z osobního mailu",
      description: "Výslovně zvolený náhled, ne automaticky celé tělo.",
      priority: 2,
      dueDate: "2026-07-20",
    };
    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${message.id}/execution-task`,
      "POST",
      command,
    );
    const execution = response.body.execution as Record<string, unknown> | undefined;
    check(
      "owner vytvoří skutečný úkol z konkrétní zprávy",
      response.status === 201 && execution?.taskId === taskId && execution.taskExists === true,
      response,
    );
    const [createdTask, createdAssignment, createdLink] = await Promise.all([
      db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1),
      db.select().from(assignments).where(eq(assignments.taskId, taskId)).limit(1),
      db.select().from(mailTaskLinks).where(eq(mailTaskLinks.sourceTaskId, taskId)).limit(1),
    ]);
    check(
      "task, osobní assignment a provenance vznikly atomicky",
      createdTask.length === 1 &&
        createdTask[0]?.projectId === owner.projectId &&
        createdTask[0]?.mailTh === `personal:${account.id}:${message.id}` &&
        createdAssignment[0]?.userId === owner.userId &&
        createdLink[0]?.providerMessageId === message.providerMessageId,
      { createdTask, createdAssignment, createdLink },
    );
    check(
      "provenance tabulka neukládá předmět, tělo ani popis",
      !JSON.stringify(createdLink).includes(command.name) &&
        !JSON.stringify(createdLink).includes(String(command.description)),
      createdLink,
    );

    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${message.id}/execution-task`,
      "POST",
      command,
    );
    check(
      "přesný command retry je idempotentní",
      response.status === 200 && response.body.replayed === true,
      response,
    );
    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${message.id}/execution-task`,
      "POST",
      { ...command, name: "Podvržený retry" },
    );
    check(
      "operation ID nelze znovu použít pro jiný obsah",
      response.status === 409 && response.body.error === "operation_id_reused",
      response,
    );
    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${message.id}/execution-task`,
      "POST",
      { ...command, operationId: crypto.randomUUID(), taskId: crypto.randomUUID() },
    );
    check(
      "jedna zpráva nevytvoří skrytě dva aktivní úkoly",
      response.status === 409 && response.body.error === "mail_message_already_linked",
      response,
    );

    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${otherMessage.id}/execution-task`,
      "POST",
      {
        ...command,
        operationId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        projectId: teamProjectId,
      },
    );
    check(
      "osobní mail nelze vložit do týmového projektu",
      response.status === 422 && response.body.error === "mail_execution_personal_project_required",
      response,
    );
    response = await request(
      strangerCookie,
      `/api/mail/accounts/${account.id}/messages/${otherMessage.id}/execution-task`,
      "POST",
      { ...command, operationId: crypto.randomUUID(), taskId: crypto.randomUUID() },
    );
    check("cizí uživatel z osobního mailu úkol nevytvoří", response.status === 404, response);

    response = await request(ownerCookie, `/api/mail/accounts/${account.id}/executions`);
    const listed = response.body.executions as Array<Record<string, unknown>> | undefined;
    check(
      "owner registry vrací živý stav navázaného úkolu",
      response.status === 200 &&
        listed?.length === 1 &&
        listed[0]?.taskName === command.name &&
        listed[0]?.taskExists === true,
      response,
    );

    await db.delete(tasks).where(eq(tasks.id, taskId));
    response = await request(ownerCookie, `/api/mail/accounts/${account.id}/executions`);
    const afterDelete = response.body.executions as Array<Record<string, unknown>> | undefined;
    check(
      "smazání úkolu nesmaže dohledatelnou provenance",
      afterDelete?.[0]?.taskExists === false,
      response,
    );
    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${message.id}/execution-task`,
      "POST",
      { ...command, operationId: crypto.randomUUID(), taskId: crypto.randomUUID() },
    );
    check(
      "náhrada smazaného úkolu vyžaduje explicitní volbu",
      response.status === 409 && response.body.error === "mail_execution_task_deleted",
      response,
    );
    const replacementTaskId = crypto.randomUUID();
    response = await request(
      ownerCookie,
      `/api/mail/accounts/${account.id}/messages/${message.id}/execution-task`,
      "POST",
      {
        ...command,
        operationId: crypto.randomUUID(),
        taskId: replacementTaskId,
        replaceDeleted: true,
      },
    );
    check(
      "explicitní náhrada zachová historii a vytvoří nový aktivní link",
      response.status === 201 &&
        (response.body.execution as Record<string, unknown>)?.taskId === replacementTaskId,
      response,
    );
    const links = await db
      .select()
      .from(mailTaskLinks)
      .where(eq(mailTaskLinks.accountId, account.id));
    check(
      "původní link je retired a aktivní zůstává právě jeden",
      links.length === 2 &&
        links.filter((link) => !link.retiredAt).length === 1 &&
        links.filter((link) => link.retiredReason === "task_missing").length === 1,
      links,
    );

    let dbRejected = false;
    try {
      await db.insert(mailTaskLinks).values({
        workspaceId: account.workspaceId,
        accountId: account.id,
        ownerUserId: owner.userId,
        sourceMessageId: otherMessage.id,
        providerMessageId: otherMessage.providerMessageId,
        sourceTaskId: replacementTaskId,
        sourceProjectId: teamProjectId,
        operationId: crypto.randomUUID(),
        requestHash: "a".repeat(64),
      });
    } catch (error) {
      dbRejected = sqlState(error) === "23514";
    }
    check("DB trigger odmítne cross-workspace link i mimo API", dbRejected);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, owner.workspaceId), eq(auditEvents.entity, "tasks")));
    const executionAudits = audits.filter(
      (event) => event.action === "create_from_mail" || event.action === "replace_from_mail",
    );
    const auditText = JSON.stringify(executionAudits);
    check(
      "create i replacement jsou auditované bez předmětu, těla a popisu",
      executionAudits.length === 2 &&
        !auditText.includes(command.name) &&
        !auditText.includes(String(command.description)),
      executionAudits,
    );

    const concurrentTaskIds = [crypto.randomUUID(), crypto.randomUUID()];
    const concurrentResponses = await Promise.all(
      concurrentTaskIds.map((concurrentTaskId, index) =>
        request(
          ownerCookie,
          `/api/mail/accounts/${account.id}/messages/${concurrentMessage.id}/execution-task`,
          "POST",
          {
            ...command,
            operationId: crypto.randomUUID(),
            taskId: concurrentTaskId,
            name: `Souběžný úkol ${index + 1}`,
          },
        ),
      ),
    );
    const [concurrentTasks, concurrentLinks] = await Promise.all([
      db.select().from(tasks).where(inArray(tasks.id, concurrentTaskIds)),
      db
        .select()
        .from(mailTaskLinks)
        .where(
          and(
            eq(mailTaskLinks.accountId, account.id),
            eq(mailTaskLinks.providerMessageId, concurrentMessage.providerMessageId),
          ),
        ),
    ]);
    check(
      "dva skutečně souběžné commandy vytvoří právě jeden úkol a jeden link",
      concurrentResponses
        .map((item) => item.status)
        .sort()
        .join(",") === "201,409" &&
        concurrentTasks.length === 1 &&
        concurrentLinks.length === 1 &&
        concurrentLinks[0]?.sourceTaskId === concurrentTasks[0]?.id,
      { concurrentResponses, concurrentTasks, concurrentLinks },
    );
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, teamWorkspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, owner.workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, stranger.workspaceId));
    await db.delete(users).where(eq(users.id, owner.userId));
    await db.delete(users).where(eq(users.id, stranger.userId));
  }
  if (failed > 0) throw new Error(`${failed} mail execution checks failed`);
  console.log("\nMail Execution Inbox M2: všechny kontroly prošly");
}

await main();
process.exit(0);
