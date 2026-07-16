import {
  and,
  auditEvents,
  eq,
  getDb,
  INTAKE_FIELD_TYPES,
  intakeFormFields,
  intakeForms,
  intakeSubmissions,
  sql,
  tasks,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

const uuid = z.string().uuid();
const optionSchema = z.object({ id: uuid, label: z.string().trim().min(1).max(120) }).strict();
const fieldSchema = z
  .object({
    id: uuid,
    label: z.string().trim().min(1).max(120),
    fieldType: z.enum(INTAKE_FIELD_TYPES),
    required: z.boolean().optional().default(false),
    options: z.array(optionSchema).max(20).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.fieldType === "select" && (!field.options || field.options.length < 2)) {
      context.addIssue({ code: "custom", path: ["options"], message: "options_required" });
    }
    if (field.fieldType !== "select" && field.options !== undefined) {
      context.addIssue({ code: "custom", path: ["options"], message: "options_not_allowed" });
    }
    if (
      field.options &&
      new Set(field.options.map((option) => option.label.toLocaleLowerCase())).size !==
        field.options.length
    ) {
      context.addIssue({ code: "custom", path: ["options"], message: "duplicate_options" });
    }
  });
const fieldsSchema = z
  .array(fieldSchema)
  .max(20)
  .refine(
    (fields) => new Set(fields.map((field) => field.id)).size === fields.length,
    "duplicate_fields",
  );
const createSchema = z
  .object({
    id: uuid,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    defaultPriority: z.number().int().min(1).max(4).optional().default(3),
    isActive: z.boolean().optional().default(true),
    fields: fieldsSchema.optional().default([]),
  })
  .strict();
const updateSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    defaultPriority: z.number().int().min(1).max(4).optional(),
    isActive: z.boolean().optional(),
    fields: fieldsSchema.optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "expectedUpdatedAt"),
    "nothing_to_update",
  );
const deleteSchema = z
  .object({
    confirm: z.string().max(160),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const submitSchema = z
  .object({
    id: uuid,
    taskName: z.string().trim().min(1).max(500),
    details: z.string().trim().max(10_000).nullable().optional(),
    answers: z.record(uuid, z.unknown()).optional().default({}),
  })
  .strict();

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Field = {
  id: string;
  label: string;
  field_type: (typeof INTAKE_FIELD_TYPES)[number];
  required: boolean;
  options: { id: string; label: string }[];
  position: number;
};
type FormAccess = {
  id: string;
  project_id: string;
  workspace_id: string;
  project_name: string;
  visibility: string;
  title: string;
  description: string | null;
  default_priority: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  project_role: string | null;
  workspace_role: string | null;
  workspace_owner: boolean;
};

class IntakeError extends Error {
  constructor(
    readonly code: string,
    readonly status: 403 | 404 | 409 | 422,
  ) {
    super(code);
  }
}

function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) return value.code;
    current = value.cause;
  }
  return null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canManage(access: FormAccess): boolean {
  return (
    access.workspace_owner || access.workspace_role === "admin" || access.project_role === "manager"
  );
}

function canSubmit(access: FormAccess): boolean {
  const isWorkspaceMember =
    access.workspace_owner || ["member", "manager", "admin"].includes(access.workspace_role ?? "");
  return isWorkspaceMember && (access.visibility !== "restricted" || access.project_role !== null);
}

async function formAccess(tx: Tx, formId: string, userId: string): Promise<FormAccess> {
  const rows = (await tx.execute(sql`
		SELECT f.id, f.project_id, p.workspace_id, p.name AS project_name,
		       p.visibility::text AS visibility, f.title, f.description, f.default_priority,
		       f.is_active, f.created_by, f.created_at, f.updated_at,
		       pm.role::text AS project_role, wm.role::text AS workspace_role,
		       (w.owner_id = ${userId}) AS workspace_owner
		FROM intake_forms f
		JOIN projects p ON p.id = f.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE f.id = ${formId}
		  AND (w.owner_id = ${userId} OR wm.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as FormAccess[];
  if (!rows[0]) throw new IntakeError("intake_form_not_found", 404);
  return rows[0];
}

async function projectManagement(tx: Tx, projectId: string, userId: string) {
  const rows = (await tx.execute(sql`
		SELECT p.id AS project_id, p.workspace_id, p.name AS project_name,
		       pm.role::text AS project_role, wm.role::text AS workspace_role,
		       (w.owner_id = ${userId}) AS workspace_owner
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE p.id = ${projectId}
		  AND (w.owner_id = ${userId} OR wm.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as Pick<
    FormAccess,
    | "project_id"
    | "workspace_id"
    | "project_name"
    | "project_role"
    | "workspace_role"
    | "workspace_owner"
  >[];
  const row = rows[0];
  if (!row) throw new IntakeError("not_found", 404);
  if (!(row.workspace_owner || row.workspace_role === "admin" || row.project_role === "manager"))
    throw new IntakeError("forbidden", 403);
  return row;
}

async function fieldsFor(tx: Tx, formId: string): Promise<Field[]> {
  return (await tx.execute(sql`
		SELECT id, label, field_type, required, options, position
		FROM intake_form_fields WHERE form_id = ${formId}
		ORDER BY position, created_at, id
	`)) as unknown as Field[];
}

function normalizedAnswers(
  fields: Field[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const definitions = new Map(fields.map((field) => [field.id, field] as const));
  for (const key of Object.keys(input)) {
    if (!definitions.has(key)) throw new IntakeError("unknown_intake_answer", 422);
  }
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = input[field.id];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) throw new IntakeError("required_intake_answer", 422);
      continue;
    }
    switch (field.field_type) {
      case "text":
      case "textarea": {
        if (typeof raw !== "string" || raw.length > (field.field_type === "text" ? 500 : 10_000))
          throw new IntakeError("invalid_intake_answer", 422);
        const value = raw.trim();
        if (!value && field.required) throw new IntakeError("required_intake_answer", 422);
        if (value) result[field.id] = value;
        break;
      }
      case "number":
        if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) > 1e15)
          throw new IntakeError("invalid_intake_answer", 422);
        result[field.id] = raw;
        break;
      case "date": {
        if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
          throw new IntakeError("invalid_intake_answer", 422);
        const parsed = new Date(`${raw}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
          throw new IntakeError("invalid_intake_answer", 422);
        result[field.id] = raw;
        break;
      }
      case "select":
        if (typeof raw !== "string" || !field.options.some((option) => option.id === raw))
          throw new IntakeError("invalid_intake_answer", 422);
        result[field.id] = raw;
        break;
      case "checkbox":
        if (typeof raw !== "boolean") throw new IntakeError("invalid_intake_answer", 422);
        result[field.id] = raw;
        break;
    }
  }
  return result;
}

function answerLabel(field: Field, value: unknown): string {
  if (field.field_type === "select")
    return field.options.find((option) => option.id === value)?.label ?? "—";
  if (field.field_type === "checkbox") return value ? "Ano" : "Ne";
  return String(value);
}

function taskDescription(
  form: FormAccess,
  fields: Field[],
  answers: Record<string, unknown>,
  details: string | null | undefined,
): string {
  const parts: string[] = [];
  if (details?.trim()) parts.push(details.trim());
  parts.push(`Přijato přes formulář „${form.title}“.`);
  const answered = fields.filter((field) => Object.hasOwn(answers, field.id));
  if (answered.length > 0) {
    parts.push(
      answered
        .map((field) => `**${field.label}:** ${answerLabel(field, answers[field.id])}`)
        .join("\n\n"),
    );
  }
  return parts.join("\n\n---\n\n");
}

function publicForm(form: FormAccess, fields: Field[]) {
  return {
    id: form.id,
    projectId: form.project_id,
    projectName: form.project_name,
    title: form.title,
    description: form.description,
    defaultPriority: form.default_priority,
    isActive: form.is_active,
    createdAt: form.created_at,
    updatedAt: form.updated_at,
    canManage: canManage(form),
    canOpenCreatedTask: form.project_role !== null,
    fields: fields.map((field) => ({
      id: field.id,
      label: field.label,
      fieldType: field.field_type,
      required: field.required,
      options: field.options,
      position: field.position,
    })),
  };
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(await request.json());
  } catch {
    return null;
  }
}

export const intakeFormRoutes = new Hono<{ Variables: { requestId: string } }>();

intakeFormRoutes.get("/api/workspaces/:workspaceId/intake-forms", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const workspaceId = c.req.param("workspaceId");
  if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
  const db = getDb();
  const accessRows = (await db.execute(sql`
		SELECT wm.role::text AS role, (w.owner_id = ${session.user.id}) AS owner
		FROM workspaces w
		LEFT JOIN memberships wm ON wm.workspace_id = w.id AND wm.user_id = ${session.user.id}
		WHERE w.id = ${workspaceId} AND (w.owner_id = ${session.user.id} OR wm.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as { role: string | null; owner: boolean }[];
  if (!accessRows[0]) return c.json({ error: "not_found" }, 404);
  const forms = (await db.execute(sql`
		SELECT f.id, f.project_id, p.workspace_id, p.name AS project_name,
		       p.visibility::text AS visibility, f.title, f.description, f.default_priority,
		       f.is_active, f.created_by, f.created_at, f.updated_at,
		       pm.role::text AS project_role, wm.role::text AS workspace_role,
		       (w.owner_id = ${session.user.id}) AS workspace_owner
		FROM intake_forms f
		JOIN projects p ON p.id = f.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${session.user.id}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${session.user.id}
		WHERE p.workspace_id = ${workspaceId}
		  AND (w.owner_id = ${session.user.id} OR wm.user_id IS NOT NULL)
		  AND (p.visibility::text <> 'restricted' OR pm.user_id IS NOT NULL)
		  AND (f.is_active OR w.owner_id = ${session.user.id} OR wm.role::text = 'admin' OR pm.role::text = 'manager')
		ORDER BY f.is_active DESC, p.name, f.title
	`)) as unknown as FormAccess[];
  const allFields = forms.length
    ? ((await db.execute(sql`
			SELECT id, form_id, label, field_type, required, options, position
			FROM intake_form_fields
			WHERE form_id = ANY(ARRAY[${sql.join(
        forms.map((form) => sql`${form.id}`),
        sql`, `,
      )}]::uuid[])
			ORDER BY position, created_at, id
		`)) as unknown as (Field & { form_id: string })[])
    : [];
  const fieldsByForm = new Map<string, Field[]>();
  for (const field of allFields) {
    const rows = fieldsByForm.get(field.form_id) ?? [];
    rows.push(field);
    fieldsByForm.set(field.form_id, rows);
  }
  const manageableProjects = (await db.execute(sql`
		SELECT p.id, p.name
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${session.user.id}
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${session.user.id}
		WHERE p.workspace_id = ${workspaceId}
		  AND p.status::text <> 'archive'
		  AND (w.owner_id = ${session.user.id} OR wm.role::text = 'admin' OR pm.role::text = 'manager')
		ORDER BY p.name
	`)) as unknown as { id: string; name: string }[];
  return c.json({
    forms: forms.filter(canSubmit).map((form) => publicForm(form, fieldsByForm.get(form.id) ?? [])),
    manageableProjects,
  });
});

intakeFormRoutes.get("/api/intake-forms/:formId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const formId = c.req.param("formId");
  if (!uuid.safeParse(formId).success) return c.json({ error: "invalid_intake_form_id" }, 422);
  try {
    return await getDb().transaction(async (tx) => {
      const form = await formAccess(tx, formId, session.user.id);
      if (!canSubmit(form)) throw new IntakeError("intake_form_not_found", 404);
      if (!form.is_active && !canManage(form)) throw new IntakeError("intake_form_inactive", 409);
      return c.json({ form: publicForm(form, await fieldsFor(tx, formId)) });
    });
  } catch (error) {
    if (error instanceof IntakeError) return c.json({ error: error.code }, error.status);
    throw error;
  }
});

intakeFormRoutes.post("/api/projects/:projectId/intake-forms", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("projectId");
  const body = await parseBody(c.req.raw, createSchema);
  if (!uuid.safeParse(projectId).success || !body)
    return c.json({ error: "invalid_intake_form" }, 422);
  const createFields = body.fields ?? [];
  const defaultPriority = body.defaultPriority ?? 3;
  const isActive = body.isActive ?? true;
  try {
    const result = await getDb().transaction(async (tx) => {
      const access = await projectManagement(tx, projectId, session.user.id);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`intake-forms:${projectId}`}, 0))`,
      );
      const existing = (await tx.select().from(intakeForms).where(eq(intakeForms.id, body.id)))[0];
      if (existing) {
        const existingFields = await fieldsFor(tx, body.id);
        const same =
          existing.projectId === projectId &&
          existing.title === body.title &&
          (existing.description ?? null) === (body.description ?? null) &&
          existing.defaultPriority === defaultPriority &&
          existing.isActive === isActive &&
          canonical(
            existingFields.map((field) => ({
              id: field.id,
              label: field.label,
              fieldType: field.field_type,
              required: field.required,
              options: field.options,
            })),
          ) ===
            canonical(
              createFields.map((field) => ({
                id: field.id,
                label: field.label,
                fieldType: field.fieldType,
                required: field.required ?? false,
                options: field.options ?? [],
              })),
            );
        if (!same) throw new IntakeError("intake_form_id_conflict", 409);
        return { form: existing, replayed: true };
      }
      const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM intake_forms WHERE project_id = ${projectId}
			`)) as unknown as { count: number }[];
      if ((countRows[0]?.count ?? 0) >= 20) throw new IntakeError("intake_form_limit", 409);
      const [created] = await tx
        .insert(intakeForms)
        .values({
          id: body.id,
          projectId,
          title: body.title,
          description: body.description ?? null,
          defaultPriority,
          isActive,
          createdBy: session.user.id,
        })
        .returning();
      if (!created) throw new IntakeError("intake_form_create_failed", 409);
      if (createFields.length > 0) {
        await tx.insert(intakeFormFields).values(
          createFields.map((field, position) => ({
            id: field.id,
            formId: created.id,
            label: field.label,
            fieldType: field.fieldType,
            required: field.required,
            options: field.options ?? [],
            position,
          })),
        );
      }
      await tx.insert(auditEvents).values({
        workspaceId: access.workspace_id,
        actorUserId: session.user.id,
        entity: "intake_forms",
        entityId: created.id,
        action: "create",
        diff: { project_id: projectId, title: created.title, fields: createFields.length },
        requestId: c.get("requestId"),
      });
      return { form: created, replayed: false };
    });
    return c.json(result, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof IntakeError) return c.json({ error: error.code }, error.status);
    if (sqlState(error) === "23505") return c.json({ error: "intake_form_conflict" }, 409);
    throw error;
  }
});

intakeFormRoutes.patch("/api/intake-forms/:formId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const formId = c.req.param("formId");
  const body = await parseBody(c.req.raw, updateSchema);
  if (!uuid.safeParse(formId).success || !body)
    return c.json({ error: "invalid_intake_form" }, 422);
  try {
    const form = await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`intake-form:${formId}`}, 0))`,
      );
      const current = await formAccess(tx, formId, session.user.id);
      if (!canManage(current)) throw new IntakeError("forbidden", 403);
      const [updated] = await tx
        .update(intakeForms)
        .set({
          title: body.title ?? current.title,
          description: body.description === undefined ? current.description : body.description,
          defaultPriority: body.defaultPriority ?? current.default_priority,
          isActive: body.isActive ?? current.is_active,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(intakeForms.id, formId),
            eq(intakeForms.updatedAt, sql`${body.expectedUpdatedAt}::timestamptz`),
          ),
        )
        .returning();
      if (!updated) throw new IntakeError("stale_intake_form", 409);
      if (body.fields) {
        await tx.delete(intakeFormFields).where(eq(intakeFormFields.formId, formId));
        if (body.fields.length > 0) {
          await tx.insert(intakeFormFields).values(
            body.fields.map((field, position) => ({
              id: field.id,
              formId,
              label: field.label,
              fieldType: field.fieldType,
              required: field.required,
              options: field.options ?? [],
              position,
            })),
          );
        }
      }
      await tx.insert(auditEvents).values({
        workspaceId: current.workspace_id,
        actorUserId: session.user.id,
        entity: "intake_forms",
        entityId: formId,
        action: "update",
        before: {
          title: current.title,
          description: current.description,
          default_priority: current.default_priority,
          is_active: current.is_active,
        },
        diff: { changed: Object.keys(body).filter((key) => key !== "expectedUpdatedAt") },
        requestId: c.get("requestId"),
      });
      return updated;
    });
    return c.json({ form });
  } catch (error) {
    if (error instanceof IntakeError) return c.json({ error: error.code }, error.status);
    if (sqlState(error) === "23505") return c.json({ error: "intake_form_conflict" }, 409);
    throw error;
  }
});

intakeFormRoutes.delete("/api/intake-forms/:formId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const formId = c.req.param("formId");
  const body = await parseBody(c.req.raw, deleteSchema);
  if (!uuid.safeParse(formId).success || !body)
    return c.json({ error: "invalid_intake_form_delete" }, 422);
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`intake-form:${formId}`}, 0))`,
      );
      const current = await formAccess(tx, formId, session.user.id);
      if (!canManage(current)) throw new IntakeError("forbidden", 403);
      if (current.title !== body.confirm)
        throw new IntakeError("intake_form_confirmation_mismatch", 409);
      const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM intake_submissions WHERE form_id = ${formId}
			`)) as unknown as { count: number }[];
      const submissions = countRows[0]?.count ?? 0;
      if (submissions > 0) {
        const [archived] = await tx
          .update(intakeForms)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(intakeForms.id, formId),
              eq(intakeForms.updatedAt, sql`${body.expectedUpdatedAt}::timestamptz`),
            ),
          )
          .returning({ id: intakeForms.id });
        if (!archived) throw new IntakeError("stale_intake_form", 409);
      } else {
        const [deleted] = await tx
          .delete(intakeForms)
          .where(
            and(
              eq(intakeForms.id, formId),
              eq(intakeForms.updatedAt, sql`${body.expectedUpdatedAt}::timestamptz`),
            ),
          )
          .returning({ id: intakeForms.id });
        if (!deleted) throw new IntakeError("stale_intake_form", 409);
      }
      await tx.insert(auditEvents).values({
        workspaceId: current.workspace_id,
        actorUserId: session.user.id,
        entity: "intake_forms",
        entityId: formId,
        action: submissions > 0 ? "archive" : "delete",
        before: { project_id: current.project_id, title: current.title, submissions },
        requestId: c.get("requestId"),
      });
      return { archived: submissions > 0 };
    });
    return c.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof IntakeError) return c.json({ error: error.code }, error.status);
    throw error;
  }
});

intakeFormRoutes.post("/api/intake-forms/:formId/submissions", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const formId = c.req.param("formId");
  const body = await parseBody(c.req.raw, submitSchema);
  if (!uuid.safeParse(formId).success || !body)
    return c.json({ error: "invalid_intake_submission" }, 422);
  const submissionAnswers = body.answers ?? {};
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`intake-submission:${body.id}`}, 0))`,
      );
      const form = await formAccess(tx, formId, session.user.id);
      if (!canSubmit(form)) throw new IntakeError("intake_form_not_found", 404);
      const existingRows = (await tx.execute(sql`
				SELECT s.form_id, s.task_id, s.answers, s.form_snapshot, t.name
				FROM intake_submissions s LEFT JOIN tasks t ON t.id = s.task_id
				WHERE s.id = ${body.id} AND s.submitted_by = ${session.user.id}
				LIMIT 1
			`)) as unknown as {
        form_id: string;
        task_id: string | null;
        answers: Record<string, unknown>;
        form_snapshot: { taskName?: string; details?: string | null };
        name: string | null;
      }[];
      const existing = existingRows[0];
      if (existing) {
        const same =
          existing.form_id === formId &&
          existing.form_snapshot.taskName === body.taskName &&
          (existing.form_snapshot.details ?? null) === (body.details ?? null) &&
          canonical(existing.answers) === canonical(submissionAnswers);
        if (!same) throw new IntakeError("intake_submission_id_conflict", 409);
        return {
          taskId: existing.task_id,
          taskName: existing.name ?? body.taskName,
          replayed: true,
        };
      }
      if (!form.is_active) throw new IntakeError("intake_form_inactive", 409);
      const fields = await fieldsFor(tx, formId);
      const answers = normalizedAnswers(fields, submissionAnswers);
      const taskId = crypto.randomUUID();
      const snapshot = {
        formId,
        title: form.title,
        description: form.description,
        projectId: form.project_id,
        projectName: form.project_name,
        defaultPriority: form.default_priority,
        taskName: body.taskName,
        details: body.details ?? null,
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          fieldType: field.field_type,
          required: field.required,
          options: field.options,
        })),
      };
      await tx.insert(tasks).values({
        id: taskId,
        projectId: form.project_id,
        name: body.taskName,
        description: taskDescription(form, fields, answers, body.details),
        priority: form.default_priority,
        createdBy: session.user.id,
      });
      await tx.insert(intakeSubmissions).values({
        id: body.id,
        formId,
        projectId: form.project_id,
        taskId,
        submittedBy: session.user.id,
        formSnapshot: snapshot,
        answers,
      });
      await tx.insert(auditEvents).values([
        {
          workspaceId: form.workspace_id,
          actorUserId: session.user.id,
          entity: "tasks",
          entityId: taskId,
          action: "intake_create",
          diff: { project_id: form.project_id, form_id: formId, submission_id: body.id },
          requestId: c.get("requestId"),
        },
        {
          workspaceId: form.workspace_id,
          actorUserId: session.user.id,
          entity: "intake_submissions",
          entityId: body.id,
          action: "create",
          diff: { project_id: form.project_id, form_id: formId, task_id: taskId },
          requestId: c.get("requestId"),
        },
      ]);
      return { taskId, taskName: body.taskName, replayed: false };
    });
    return c.json(result, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof IntakeError) return c.json({ error: error.code }, error.status);
    throw error;
  }
});

intakeFormRoutes.get("/api/workspaces/:workspaceId/intake-submissions", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const workspaceId = c.req.param("workspaceId");
  if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
  const rows = (await getDb().execute(sql`
		SELECT s.id, s.form_id, s.project_id, s.task_id, s.submitted_by, s.created_at,
		       f.title AS form_title, p.name AS project_name, t.name AS task_name,
		       u.name AS submitter_name,
		       (s.submitted_by = ${session.user.id}) AS own,
		       (w.owner_id = ${session.user.id} OR wm.role::text = 'admin' OR pm.role::text = 'manager') AS can_manage,
		       (s.task_id IS NOT NULL AND task_pm.user_id IS NOT NULL) AS can_open_task
		FROM intake_submissions s
		JOIN intake_forms f ON f.id = s.form_id
		JOIN projects p ON p.id = s.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN tasks t ON t.id = s.task_id
		LEFT JOIN users u ON u.id = s.submitted_by
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${session.user.id}
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${session.user.id}
		LEFT JOIN project_members task_pm ON task_pm.project_id = t.project_id AND task_pm.user_id = ${session.user.id}
		WHERE p.workspace_id = ${workspaceId}
		  AND (w.owner_id = ${session.user.id} OR wm.user_id IS NOT NULL)
		  AND (s.submitted_by = ${session.user.id}
		       OR w.owner_id = ${session.user.id} OR wm.role::text = 'admin' OR pm.role::text = 'manager')
		ORDER BY s.created_at DESC
		LIMIT 100
	`)) as unknown as Record<string, unknown>[];
  return c.json({ submissions: rows });
});
