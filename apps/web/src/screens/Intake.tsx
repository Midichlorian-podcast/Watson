import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { showToast } from "../lib/toast";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useWorkspace } from "../lib/workspace";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";
type FormField = {
  id: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: { id: string; label: string }[];
  position: number;
};
type IntakeForm = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string | null;
  defaultPriority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canOpenCreatedTask: boolean;
  fields: FormField[];
};
type ManageableProject = { id: string; name: string };
type IntakeResponse = { forms: IntakeForm[]; manageableProjects: ManageableProject[] };
type Submission = {
  id: string;
  form_id: string;
  project_id: string;
  task_id: string | null;
  submitted_by: string | null;
  created_at: string;
  form_title: string;
  project_name: string;
  task_name: string | null;
  submitter_name: string | null;
  own: boolean;
  can_manage: boolean;
  can_open_task: boolean;
};
type DraftField = Omit<FormField, "position" | "options"> & { optionsText: string };
type DraftForm = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  defaultPriority: number;
  isActive: boolean;
  updatedAt?: string;
  fields: DraftField[];
};

const FIELD_TYPES: FieldType[] = ["text", "textarea", "number", "date", "select", "checkbox"];
const inputClass =
  "min-h-11 w-full rounded-[9px] border border-line bg-card px-3 font-body text-sm text-ink outline-none focus:border-brass";
const secondaryButton =
  "min-h-11 rounded-[9px] border border-line px-3 font-display font-semibold text-ink-2 text-sm hover:border-brass hover:text-brass-text";
const primaryButton =
  "min-h-11 rounded-[9px] bg-brass px-4 font-display font-bold text-sm text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50";

function errorCode(response: Response, fallback: string) {
  return response
    .json()
    .then((body: { error?: string }) => body.error ?? fallback)
    .catch(() => fallback);
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
}

function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useEscape(onClose);
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-end bg-black/45 p-0 sm:place-items-center sm:p-5"
      data-esc-layer
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card shadow-2xl sm:max-w-[720px] sm:rounded-2xl"
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-line border-b bg-card px-4 sm:px-5">
          <h2 className="flex-1 font-display font-extrabold text-base text-ink">{title}</h2>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-lg text-ink-2 hover:bg-hover"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icon name="zavrit" size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  field: DraftField;
  index: number;
  count: number;
  onChange: (patch: Partial<DraftField>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_170px_auto]">
        <input
          className={inputClass}
          value={field.label}
          maxLength={120}
          onChange={(event) => onChange({ label: event.target.value })}
          aria-label={t("intake.fieldLabel")}
          placeholder={t("intake.fieldLabelPlaceholder")}
        />
        <select
          className={inputClass}
          value={field.fieldType}
          onChange={(event) =>
            onChange({
              fieldType: event.target.value as FieldType,
              optionsText: event.target.value === "select" ? field.optionsText : "",
            })
          }
          aria-label={t("intake.fieldType")}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`intake.fieldType_${type}`)}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <button
            type="button"
            className="grid size-11 place-items-center rounded-lg border border-line text-ink-2 disabled:opacity-30"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={t("intake.moveUp")}
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-lg border border-line text-ink-2 disabled:opacity-30"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label={t("intake.moveDown")}
          >
            <span aria-hidden="true">↓</span>
          </button>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-lg border border-line text-danger hover:border-danger"
            onClick={onRemove}
            aria-label={t("common.delete")}
          >
            <Icon name="smazat" size={16} />
          </button>
        </div>
      </div>
      {field.fieldType === "select" && (
        <input
          className={`${inputClass} mt-2`}
          value={field.optionsText}
          onChange={(event) => onChange({ optionsText: event.target.value })}
          placeholder={t("intake.optionsPlaceholder")}
          aria-label={t("intake.options")}
        />
      )}
      <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 font-body text-sm text-ink-2">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => onChange({ required: event.target.checked })}
          className="size-4 accent-brass"
        />
        {t("intake.required")}
      </label>
    </div>
  );
}

function FormEditor({
  form,
  projects,
  onClose,
  onSaved,
}: {
  form: IntakeForm | null;
  projects: ManageableProject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftForm>(() => ({
    id: form?.id ?? crypto.randomUUID(),
    projectId: form?.projectId ?? projects[0]?.id ?? "",
    title: form?.title ?? "",
    description: form?.description ?? "",
    defaultPriority: form?.defaultPriority ?? 3,
    isActive: form?.isActive ?? true,
    updatedAt: form?.updatedAt,
    fields: (form?.fields ?? []).map((field) => ({
      id: field.id,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      optionsText: field.options.map((option) => option.label).join(", "),
    })),
  }));
  const [saving, setSaving] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);

  const patchField = (index: number, patch: Partial<DraftField>) =>
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    }));
  const moveField = (index: number, direction: -1 | 1) =>
    setDraft((current) => {
      const fields = [...current.fields];
      const target = index + direction;
      const sourceField = fields[index];
      const targetField = fields[target];
      if (!sourceField || !targetField || target < 0 || target >= fields.length) return current;
      fields[index] = targetField;
      fields[target] = sourceField;
      return { ...current, fields };
    });

  async function save() {
    if (!draft.title.trim() || !draft.projectId) return showToast(t("intake.fillRequired"));
    if (draft.fields.some((field) => !field.label.trim()))
      return showToast(t("intake.fillFieldLabels"));
    if (
      draft.fields.some((field) => {
        if (field.fieldType !== "select") return false;
        const labels = field.optionsText
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean);
        return new Set(labels.map((label) => label.toLocaleLowerCase())).size < 2;
      })
    )
      return showToast(t("intake.selectNeedsOptions"));
    const fields = draft.fields.map((field) => {
      const labels = field.optionsText
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);
      return {
        id: field.id,
        label: field.label.trim(),
        fieldType: field.fieldType,
        required: field.required,
        ...(field.fieldType === "select"
          ? {
              options: labels.map((label, index) => ({
                id:
                  form?.fields.find((item) => item.id === field.id)?.options[index]?.id ??
                  crypto.randomUUID(),
                label,
              })),
            }
          : {}),
      };
    });
    setSaving(true);
    try {
      const response = await fetch(
        form
          ? `${API_URL}/api/intake-forms/${form.id}`
          : `${API_URL}/api/projects/${draft.projectId}/intake-forms`,
        {
          method: form ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            form
              ? {
                  expectedUpdatedAt: draft.updatedAt,
                  title: draft.title,
                  description: draft.description || null,
                  defaultPriority: draft.defaultPriority,
                  isActive: draft.isActive,
                  fields,
                }
              : {
                  id: draft.id,
                  title: draft.title,
                  description: draft.description || null,
                  defaultPriority: draft.defaultPriority,
                  isActive: draft.isActive,
                  fields,
                },
          ),
        },
      );
      if (!response.ok) {
        const code = await errorCode(response, "intake_form_save_failed");
        if (code === "stale_intake_form") showToast(t("intake.stale"));
        else if (code === "intake_form_conflict") showToast(t("intake.titleConflict"));
        else showToast(t("intake.saveError"));
        return;
      }
      showToast(t("intake.saved"));
      onSaved();
    } catch {
      showToast(t("intake.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!form) return;
    if (!deleteReady) {
      setDeleteReady(true);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/intake-forms/${form.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: form.title, expectedUpdatedAt: form.updatedAt }),
      });
      if (!response.ok) throw new Error(await errorCode(response, "delete_failed"));
      const result = (await response.json()) as { archived: boolean };
      showToast(t(result.archived ? "intake.archived" : "intake.deleted"));
      onSaved();
    } catch (error) {
      if (error instanceof Error && error.message === "stale_intake_form")
        showToast(t("intake.stale"));
      else showToast(t("intake.deleteError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalFrame title={form ? t("intake.editForm") : t("intake.newForm")} onClose={onClose}>
      <div className="space-y-4 p-4 sm:p-5">
        <label className="block font-display font-semibold text-sm text-ink-2">
          {t("intake.targetProject")}
          <select
            className={`${inputClass} mt-1.5`}
            value={draft.projectId}
            disabled={Boolean(form)}
            onChange={(event) =>
              setDraft((current) => ({ ...current, projectId: event.target.value }))
            }
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block font-display font-semibold text-sm text-ink-2">
          {t("intake.formTitle")}
          <input
            className={`${inputClass} mt-1.5`}
            value={draft.title}
            maxLength={160}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label className="block font-display font-semibold text-sm text-ink-2">
          {t("intake.formDescription")}
          <textarea
            className={`${inputClass} mt-1.5 min-h-24 py-2.5`}
            value={draft.description}
            maxLength={2000}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-display font-semibold text-sm text-ink-2">
            {t("intake.defaultPriority")}
            <select
              className={`${inputClass} mt-1.5`}
              value={draft.defaultPriority}
              onChange={(event) =>
                setDraft((current) => ({ ...current, defaultPriority: Number(event.target.value) }))
              }
            >
              {[1, 2, 3, 4].map((priority) => (
                <option key={priority} value={priority}>
                  P{priority}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-5 inline-flex min-h-11 cursor-pointer items-center gap-2 font-display font-semibold text-sm text-ink-2">
            <input
              type="checkbox"
              className="size-4 accent-brass"
              checked={draft.isActive}
              onChange={(event) =>
                setDraft((current) => ({ ...current, isActive: event.target.checked }))
              }
            />
            {t("intake.active")}
          </label>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1">
            <h3 className="font-display font-extrabold text-sm text-ink">
              {t("intake.questions")}
            </h3>
            <p className="mt-0.5 text-xs text-ink-3">{t("intake.questionsHint")}</p>
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={draft.fields.length >= 20}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                fields: [
                  ...current.fields,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    fieldType: "text",
                    required: false,
                    optionsText: "",
                  },
                ],
              }))
            }
          >
            <Icon name="pridat" size={14} /> {t("intake.addQuestion")}
          </button>
        </div>
        <div className="space-y-2">
          {draft.fields.map((field, index) => (
            <FieldEditor
              key={field.id}
              field={field}
              index={index}
              count={draft.fields.length}
              onChange={(patch) => patchField(index, patch)}
              onMove={(direction) => moveField(index, direction)}
              onRemove={() =>
                setDraft((current) => ({
                  ...current,
                  fields: current.fields.filter((item) => item.id !== field.id),
                }))
              }
            />
          ))}
        </div>
      </div>
      <footer className="sticky bottom-0 flex flex-wrap justify-between gap-2 border-line border-t bg-card p-4 sm:px-5">
        <div>
          {form && (
            <button
              type="button"
              className={`${secondaryButton} text-danger`}
              disabled={saving}
              onClick={() => void remove()}
            >
              {deleteReady ? t("intake.confirmRemove") : t("common.delete")}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </footer>
    </ModalFrame>
  );
}

function SubmissionDialog({
  form,
  onClose,
  onSubmitted,
}: {
  form: IntakeForm;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [taskName, setTaskName] = useState("");
  const [details, setDetails] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [createdTask, setCreatedTask] = useState<string | null>(null);
  // Stejné ID se používá i po timeoutu/retry; server tak nevytvoří druhý úkol,
  // když první odpověď nedorazila zpět do prohlížeče.
  const [submissionId] = useState(() => crypto.randomUUID());

  async function submit() {
    if (!taskName.trim()) return showToast(t("intake.taskNameRequired"));
    for (const field of form.fields) {
      const value = answers[field.id];
      if (field.required && (value === undefined || value === null || value === ""))
        return showToast(t("intake.requiredMissing", { field: field.label }));
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/intake-forms/${form.id}/submissions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: submissionId,
          taskName: taskName.trim(),
          details: details.trim() || null,
          answers,
        }),
      });
      if (!response.ok) throw new Error(await errorCode(response, "submit_failed"));
      const result = (await response.json()) as { taskId: string | null };
      setCreatedTask(result.taskId);
      showToast(t("intake.submitted"));
      onSubmitted();
    } catch (error) {
      if (error instanceof Error && error.message === "intake_form_inactive")
        showToast(t("intake.inactiveError"));
      else showToast(t("intake.submitError"));
    } finally {
      setSaving(false);
    }
  }

  if (createdTask)
    return (
      <ModalFrame title={t("intake.submittedTitle")} onClose={onClose}>
        <div className="p-6 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--w-success-soft)] text-success">
            <Icon name="hotovo" size={22} />
          </div>
          <p className="mt-4 font-display font-bold text-ink">{t("intake.submittedBody")}</p>
          <div className="mt-5 flex justify-center gap-2">
            {form.canOpenCreatedTask && (
              <button
                type="button"
                className={primaryButton}
                onClick={() => {
                  onClose();
                  void navigate({ to: "/ukoly", search: { ukol: createdTask } });
                }}
              >
                {t("intake.openTask")}
              </button>
            )}
            <button type="button" className={secondaryButton} onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </ModalFrame>
    );

  return (
    <ModalFrame title={form.title} onClose={onClose}>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="font-display font-semibold text-xs text-ink-3">
            {form.projectName} · P{form.defaultPriority}
          </div>
          {form.description && <p className="mt-1 text-sm text-ink-2">{form.description}</p>}
        </div>
        <label className="block font-display font-semibold text-sm text-ink-2">
          {t("intake.taskName")} *
          <input
            className={`${inputClass} mt-1.5`}
            value={taskName}
            maxLength={500}
            onChange={(event) => setTaskName(event.target.value)}
          />
        </label>
        <label className="block font-display font-semibold text-sm text-ink-2">
          {t("intake.details")}
          <textarea
            className={`${inputClass} mt-1.5 min-h-28 py-2.5`}
            value={details}
            maxLength={10000}
            onChange={(event) => setDetails(event.target.value)}
          />
        </label>
        {form.fields.map((field) => (
          <AnswerField
            key={field.id}
            field={field}
            value={answers[field.id]}
            onChange={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
          />
        ))}
      </div>
      <footer className="sticky bottom-0 flex justify-end gap-2 border-line border-t bg-card p-4 sm:px-5">
        <button type="button" className={secondaryButton} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? t("intake.submitting") : t("intake.submit")}
        </button>
      </footer>
    </ModalFrame>
  );
}

function AnswerField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const inputId = `intake-answer-${field.id}`;
  if (field.fieldType === "checkbox")
    return (
      <label
        htmlFor={inputId}
        className="flex min-h-11 cursor-pointer items-center gap-2 font-display font-semibold text-sm text-ink-2"
      >
        <input
          id={inputId}
          type="checkbox"
          className="size-4 accent-brass"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
        {field.required ? " *" : ""}
      </label>
    );
  return (
    <label htmlFor={inputId} className="block font-display font-semibold text-sm text-ink-2">
      {field.label}
      {field.required ? " *" : ""}
      {field.fieldType === "textarea" ? (
        <textarea
          id={inputId}
          className={`${inputClass} mt-1.5 min-h-24 py-2.5`}
          value={typeof value === "string" ? value : ""}
          maxLength={10000}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.fieldType === "select" ? (
        <select
          id={inputId}
          className={`${inputClass} mt-1.5`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={inputId}
          className={`${inputClass} mt-1.5`}
          type={
            field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"
          }
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          maxLength={field.fieldType === "text" ? 500 : undefined}
          onChange={(event) =>
            onChange(
              field.fieldType === "number"
                ? event.target.value === ""
                  ? ""
                  : Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
    </label>
  );
}

export function Intake() {
  const { t, i18n } = useTranslation();
  const { activeWs } = useWorkspace();
  const search = useSearch({ from: "/prijem-prace" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<IntakeForm | "new" | null>(null);
  const [submissionForm, setSubmissionForm] = useState<IntakeForm | null>(null);

  const formsQuery = useQuery({
    queryKey: ["intake-forms", activeWs],
    enabled: Boolean(activeWs),
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/workspaces/${activeWs}/intake-forms`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("intake_forms");
      return (await response.json()) as IntakeResponse;
    },
  });
  const submissionsQuery = useQuery({
    queryKey: ["intake-submissions", activeWs],
    enabled: Boolean(activeWs),
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/workspaces/${activeWs}/intake-submissions`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("intake_submissions");
      const data = (await response.json()) as { submissions: Submission[] };
      return data.submissions;
    },
  });
  const forms = formsQuery.data?.forms ?? [];
  const deepLinkedForm = useMemo(
    () => forms.find((form) => form.id === search.formular),
    [forms, search.formular],
  );
  useEffect(() => {
    if (deepLinkedForm?.isActive) setSubmissionForm(deepLinkedForm);
  }, [deepLinkedForm]);

  const refresh = async () => {
    setEditor(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["intake-forms", activeWs] }),
      queryClient.invalidateQueries({ queryKey: ["intake-submissions", activeWs] }),
    ]);
  };
  const copyLink = async (form: IntakeForm) => {
    try {
      const url = new URL(window.location.href);
      url.pathname = "/prijem-prace";
      url.search = new URLSearchParams({ formular: form.id }).toString();
      await navigator.clipboard.writeText(url.toString());
      showToast(t("intake.linkCopied"));
    } catch {
      showToast(t("intake.linkCopyError"));
    }
  };

  if (!activeWs) return <div className="p-6 text-sm text-ink-3">{t("intake.chooseWorkspace")}</div>;
  return (
    <div className="mx-auto max-w-[1080px] px-[18px] pt-6 pb-24 sm:px-[22px]">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <h1 className="font-display font-extrabold text-[17px] text-ink">
            {t("intake.heading")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-3">{t("intake.intro")}</p>
        </div>
        {(formsQuery.data?.manageableProjects.length ?? 0) > 0 && (
          <button type="button" className={primaryButton} onClick={() => setEditor("new")}>
            <Icon name="pridat" size={15} /> {t("intake.newForm")}
          </button>
        )}
      </header>

      {formsQuery.isLoading ? (
        <p className="mt-8 text-sm text-ink-3">{t("common.loading")}</p>
      ) : formsQuery.isError ? (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {t("intake.loadError")}
        </div>
      ) : forms.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line border-dashed px-4 py-12 text-center">
          <Icon name="schranka" size={28} />
          <p className="mt-3 font-display font-bold text-ink">{t("intake.empty")}</p>
          <p className="mt-1 text-sm text-ink-3">{t("intake.emptyHint")}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => (
            <article
              key={form.id}
              className={`flex min-h-[220px] flex-col rounded-2xl border bg-card p-4 shadow-sm ${form.isActive ? "border-line" : "border-dashed border-line opacity-70"}`}
            >
              <div className="flex items-start gap-2">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--w-brass-soft)] text-brass-text">
                  <Icon name="schranka" size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display font-extrabold text-ink">{form.title}</div>
                  <div className="mt-0.5 truncate text-xs text-ink-3">
                    {form.projectName} · P{form.defaultPriority}
                  </div>
                </div>
                {!form.isActive && (
                  <span className="rounded-full bg-surface px-2 py-1 font-display font-bold text-[10px] text-ink-3">
                    {t("intake.inactive")}
                  </span>
                )}
              </div>
              {form.description ? (
                <p className="mt-3 line-clamp-3 text-sm text-ink-2">{form.description}</p>
              ) : (
                <p className="mt-3 text-sm italic text-ink-3">{t("intake.noDescription")}</p>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {form.isActive && (
                  <button
                    type="button"
                    className={primaryButton}
                    onClick={() => setSubmissionForm(form)}
                  >
                    {t("intake.fill")}
                  </button>
                )}
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => void copyLink(form)}
                  disabled={!form.isActive}
                  aria-label={t("intake.copyLink")}
                >
                  <Icon name="odkaz" size={15} />
                </button>
                {form.canManage && (
                  <button type="button" className={secondaryButton} onClick={() => setEditor(form)}>
                    {t("common.edit")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="mt-10">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display font-extrabold text-base text-ink">
              {t("intake.submissions")}
            </h2>
            <p className="mt-1 text-sm text-ink-3">{t("intake.submissionsHint")}</p>
          </div>
        </div>
        {submissionsQuery.isLoading ? (
          <p className="mt-4 text-sm text-ink-3">{t("common.loading")}</p>
        ) : (submissionsQuery.data?.length ?? 0) === 0 ? (
          <div className="mt-4 rounded-xl border border-line border-dashed p-6 text-center text-sm text-ink-3">
            {t("intake.noSubmissions")}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
            {submissionsQuery.data?.map((submission, index) => (
              <div
                key={submission.id}
                className={`flex flex-wrap items-center gap-3 p-3.5 ${index > 0 ? "border-line border-t" : ""}`}
              >
                <div className="min-w-[220px] flex-1">
                  <div className="font-display font-bold text-sm text-ink">
                    {submission.task_name ?? t("intake.deletedTask")}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-3">
                    {submission.form_title} · {submission.project_name}
                    {submission.can_manage && submission.submitter_name
                      ? ` · ${submission.submitter_name}`
                      : ""}
                  </div>
                </div>
                <time className="text-xs text-ink-3" dateTime={submission.created_at}>
                  {new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(submission.created_at))}
                </time>
                {submission.task_id && submission.can_open_task && (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() =>
                      void navigate({
                        to: "/ukoly",
                        search: { ukol: submission.task_id ?? undefined },
                      })
                    }
                  >
                    {t("intake.openTask")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {editor && (
        <FormEditor
          form={editor === "new" ? null : editor}
          projects={formsQuery.data?.manageableProjects ?? []}
          onClose={() => setEditor(null)}
          onSaved={() => void refresh()}
        />
      )}
      {submissionForm && (
        <SubmissionDialog
          form={submissionForm}
          onClose={() => {
            setSubmissionForm(null);
            if (search.formular) void navigate({ to: "/prijem-prace", search: {} });
          }}
          onSubmitted={() =>
            void queryClient.invalidateQueries({ queryKey: ["intake-submissions", activeWs] })
          }
        />
      )}
    </div>
  );
}
