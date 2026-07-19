/** Interní intake formuláře: ACL, validace, idempotence, CAS, atomický task a audit. */
import "./src/env";
import {
  auditEvents,
  eq,
  getDb,
  intakeForms,
  intakeSubmissions,
  memberships,
  projectMembers,
  projects,
  sql,
  tasks,
  users,
  workspaces,
} from "@watson/db";

const API = process.env.INTAKE_FORMS_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
  }
};

function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) return value.code;
    current = value.cause;
  }
  return null;
}

async function login(email: string): Promise<string> {
  const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
  });
  if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
  const rows = (await db.execute(
    sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
  )) as unknown as { identifier: string }[];
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
  if (!cookie) throw new Error(`login ${email}: no cookie`);
  return cookie;
}

async function request(cookie: string, path: string, method = "GET", payload?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Origin: "http://localhost:5173",
      Cookie: cookie,
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function version(id: string): Promise<string> {
  const rows = (await db.execute(sql`
		SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
		FROM intake_forms WHERE id = ${id}
	`)) as unknown as { version: string }[];
  if (!rows[0]?.version) throw new Error("form version missing");
  return rows[0].version;
}

async function main() {
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createdUsers = await db
    .insert(users)
    .values(
      ["owner", "member", "commenter", "outsider"].map((role) => ({
        id: crypto.randomUUID(),
        name: `Intake ${role}`,
        email: `intake-${role}-${stamp}@watson.test`,
        emailVerified: true,
      })),
    )
    .returning({ id: users.id, email: users.email });
  const [owner, member, commenter, outsider] = createdUsers;
  if (!owner || !member || !commenter || !outsider) throw new Error("users missing");
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Intake ${stamp}`, ownerId: owner.id })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error("workspace missing");
  await db.insert(memberships).values(
    [owner, member, commenter].map((user) => ({
      workspaceId: workspace.id,
      userId: user.id,
      role: user.id === owner.id ? ("admin" as const) : ("member" as const),
    })),
  );
  const [teamProject, restrictedProject] = await db
    .insert(projects)
    .values([
      { workspaceId: workspace.id, name: `Team ${stamp}`, ownerId: owner.id, visibility: "team" },
      {
        workspaceId: workspace.id,
        name: `Restricted ${stamp}`,
        ownerId: owner.id,
        visibility: "restricted",
      },
    ])
    .returning({ id: projects.id });
  if (!teamProject || !restrictedProject) throw new Error("projects missing");
  await db.insert(projectMembers).values([
    { projectId: teamProject.id, userId: owner.id, role: "manager" },
    { projectId: restrictedProject.id, userId: owner.id, role: "manager" },
    { projectId: restrictedProject.id, userId: commenter.id, role: "commenter" },
  ]);

  const ownerCookie = await login(owner.email);
  const memberCookie = await login(member.email);
  const commenterCookie = await login(commenter.email);
  const outsiderCookie = await login(outsider.email);
  const formId = crypto.randomUUID();
  const requiredField = crypto.randomUUID();
  const selectField = crypto.randomUUID();
  const optionYes = crypto.randomUUID();
  const optionNo = crypto.randomUUID();
  const definition = {
    id: formId,
    title: "Nový produkční požadavek",
    description: "Co má tým připravit?",
    defaultPriority: 2,
    isActive: true,
    fields: [
      { id: requiredField, label: "Očekávaný výsledek", fieldType: "textarea", required: true },
      {
        id: selectField,
        label: "Rozpočet potvrzen",
        fieldType: "select",
        required: true,
        options: [
          { id: optionYes, label: "Ano" },
          { id: optionNo, label: "Ne" },
        ],
      },
    ],
  };

  try {
    let result = await request(
      memberCookie,
      `/api/projects/${teamProject.id}/intake-forms`,
      "POST",
      definition,
    );
    check("běžný člen formulář nespravuje", result.status === 403, result);
    result = await request(
      ownerCookie,
      `/api/projects/${teamProject.id}/intake-forms`,
      "POST",
      definition,
    );
    check("manager vytvoří formulář atomicky", result.status === 201, result);
    result = await request(
      ownerCookie,
      `/api/projects/${teamProject.id}/intake-forms`,
      "POST",
      definition,
    );
    check("opakovaný create je idempotentní", result.status === 200, result);
    result = await request(ownerCookie, `/api/projects/${teamProject.id}/intake-forms`, "POST", {
      ...definition,
      title: "Kolizní název",
    });
    check("stejné id s jiným obsahem je konflikt", result.status === 409, result);

    result = await request(memberCookie, `/api/workspaces/${workspace.id}/intake-forms`);
    const memberForms = (result.body.forms ?? []) as {
      id: string;
      canManage: boolean;
      canOpenCreatedTask: boolean;
    }[];
    check(
      "člen prostoru vidí aktivní týmový formulář bez projektového členství",
      result.status === 200 &&
        memberForms.some(
          (form) => form.id === formId && !form.canManage && !form.canOpenCreatedTask,
        ),
      result,
    );
    result = await request(outsiderCookie, `/api/intake-forms/${formId}`);
    check("uživatel mimo prostor dostane fail-closed 404", result.status === 404, result);

    const submissionId = crypto.randomUUID();
    result = await request(memberCookie, `/api/intake-forms/${formId}/submissions`, "POST", {
      id: submissionId,
      taskName: "Připravit nový landing page",
      answers: { [selectField]: optionYes },
    });
    check("povinná odpověď je vynucená", result.status === 422, result);
    result = await request(memberCookie, `/api/intake-forms/${formId}/submissions`, "POST", {
      id: submissionId,
      taskName: "Připravit nový landing page",
      answers: { [requiredField]: "Hotová stránka", [selectField]: crypto.randomUUID() },
    });
    check("výběr přijme jen definovanou možnost", result.status === 422, result);
    const payload = {
      id: submissionId,
      taskName: "Připravit nový landing page",
      details: "Dodat do příští kampaně.",
      answers: { [requiredField]: "Hotová responzivní stránka", [selectField]: optionYes },
    };
    result = await request(
      memberCookie,
      `/api/intake-forms/${formId}/submissions`,
      "POST",
      payload,
    );
    const taskId = result.body.taskId as string | undefined;
    check(
      "platný požadavek atomicky vytvoří úkol",
      result.status === 201 && Boolean(taskId),
      result,
    );
    result = await request(
      memberCookie,
      `/api/intake-forms/${formId}/submissions`,
      "POST",
      payload,
    );
    check(
      "opakované odeslání nevytvoří druhý úkol",
      result.status === 200 && result.body.taskId === taskId,
      result,
    );
    result = await request(memberCookie, `/api/intake-forms/${formId}/submissions`, "POST", {
      ...payload,
      taskName: "Pokus přepsat request",
    });
    check("id submission nelze znovu použít s jiným obsahem", result.status === 409, result);

    const taskRows = taskId ? await db.select().from(tasks).where(eq(tasks.id, taskId)) : [];
    const task = taskRows[0];
    check(
      "úkol nese prioritu, autora a čitelný formulářový kontext",
      task?.priority === 2 &&
        task.createdBy === member.id &&
        Boolean(task.description?.includes("Nový produkční požadavek")) &&
        Boolean(task.description?.includes("Hotová responzivní stránka")),
      task,
    );
    const submissionCount = (await db.execute(sql`
			SELECT count(*)::int AS count FROM intake_submissions WHERE id = ${submissionId}
		`)) as unknown as { count: number }[];
    check(
      "submission snapshot existuje právě jednou",
      submissionCount[0]?.count === 1,
      submissionCount,
    );

    result = await request(memberCookie, `/api/workspaces/${workspace.id}/intake-submissions`);
    const own = (result.body.submissions ?? []) as {
      id: string;
      own: boolean;
      can_open_task: boolean;
    }[];
    check(
      "zadavatel vidí vlastní historii bez falešného odkazu do nepřístupného projektu",
      result.status === 200 &&
        own.some((row) => row.id === submissionId && row.own && !row.can_open_task),
      result,
    );

    const firstVersion = await version(formId);
    result = await request(ownerCookie, `/api/intake-forms/${formId}`, "PATCH", {
      expectedUpdatedAt: firstVersion,
      description: "Upřesněný popis",
    });
    check("manager upraví formulář přes CAS", result.status === 200, result);
    result = await request(ownerCookie, `/api/intake-forms/${formId}`, "PATCH", {
      expectedUpdatedAt: firstVersion,
      description: "Přepsaná stará verze",
    });
    check("stará verze formuláře je konflikt", result.status === 409, result);

    const restrictedFormId = crypto.randomUUID();
    result = await request(
      ownerCookie,
      `/api/projects/${restrictedProject.id}/intake-forms`,
      "POST",
      {
        id: restrictedFormId,
        title: "Citlivý požadavek",
        fields: [],
      },
    );
    check("manager vytvoří formulář omezeného projektu", result.status === 201, result);
    result = await request(memberCookie, `/api/workspaces/${workspace.id}/intake-forms`);
    check(
      "restricted formulář se neprozradí nečlenovi projektu",
      !((result.body.forms ?? []) as { id: string }[]).some((form) => form.id === restrictedFormId),
      result,
    );
    result = await request(commenterCookie, `/api/workspaces/${workspace.id}/intake-forms`);
    check(
      "člen restricted projektu formulář vidí, ale nespravuje",
      ((result.body.forms ?? []) as { id: string; canManage: boolean }[]).some(
        (form) => form.id === restrictedFormId && !form.canManage,
      ),
      result,
    );

    if (taskId) {
      result = await request(ownerCookie, "/api/tasks/delete", "POST", {
        taskIds: [taskId],
        operationId: `intake-delete-${stamp}`,
      });
      const batchId = result.body.batchId as string | undefined;
      const preserved = await db
        .select({ taskId: intakeSubmissions.taskId })
        .from(intakeSubmissions)
        .where(eq(intakeSubmissions.id, submissionId));
      check(
        "auditovaný delete úkolu zachová historický submission",
        result.status === 200 && preserved[0]?.taskId === null && Boolean(batchId),
        { result, preserved },
      );
      result = await request(ownerCookie, "/api/tasks/restore", "POST", { batchId });
      const relinked = await db
        .select({ taskId: intakeSubmissions.taskId })
        .from(intakeSubmissions)
        .where(eq(intakeSubmissions.id, submissionId));
      check(
        "undo úkolu obnoví i vazbu na zdrojový submission",
        result.status === 200 && relinked[0]?.taskId === taskId,
        { result, relinked },
      );
    }

    result = await request(ownerCookie, `/api/intake-forms/${formId}`, "DELETE", {
      confirm: definition.title,
      expectedUpdatedAt: await version(formId),
    });
    check(
      "použitý formulář se bezpečně deaktivuje místo ztráty historie",
      result.status === 200 && result.body.archived === true,
      result,
    );
    result = await request(memberCookie, `/api/intake-forms/${formId}/submissions`, "POST", {
      id: crypto.randomUUID(),
      taskName: "Po deaktivaci",
      answers: { [requiredField]: "Výsledek", [selectField]: optionNo },
    });
    check("deaktivovaný formulář nepřijme nový požadavek", result.status === 409, result);

    const unusedId = crypto.randomUUID();
    result = await request(ownerCookie, `/api/projects/${teamProject.id}/intake-forms`, "POST", {
      id: unusedId,
      title: "Nepoužitý formulář",
      fields: [],
    });
    result = await request(ownerCookie, `/api/intake-forms/${unusedId}`, "DELETE", {
      confirm: "Nepoužitý formulář",
      expectedUpdatedAt: await version(unusedId),
    });
    const unusedRows = await db
      .select({ id: intakeForms.id })
      .from(intakeForms)
      .where(eq(intakeForms.id, unusedId));
    check(
      "nepoužitý potvrzený formulář se odstraní",
      result.status === 200 && result.body.archived === false && unusedRows.length === 0,
      result,
    );

    const foreignTask = await db
      .insert(tasks)
      .values({ projectId: restrictedProject.id, name: "Cizí projekt" })
      .returning({ id: tasks.id });
    let triggerState: string | null = null;
    try {
      await db.insert(intakeSubmissions).values({
        id: crypto.randomUUID(),
        formId,
        projectId: teamProject.id,
        taskId: foreignTask[0]?.id,
        submittedBy: owner.id,
        formSnapshot: {},
        answers: {},
      });
    } catch (error) {
      triggerState = sqlState(error);
    }
    check("DB odmítne task z jiného projektu", triggerState === "23514", triggerState);

    const audits = await db
      .select({ entity: auditEvents.entity, action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspace.id));
    check(
      "create, update, task materializace i archivace jsou auditované",
      [
        "intake_forms:create",
        "intake_forms:update",
        "tasks:intake_create",
        "intake_submissions:create",
        "intake_forms:archive",
      ].every((key) => audits.some((row) => `${row.entity}:${row.action}` === key)),
      audits,
    );
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
  }

  if (failed > 0) throw new Error(`${failed} intake checks failed`);
  console.log("\nIntake forms: všechny kontroly prošly.");
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
