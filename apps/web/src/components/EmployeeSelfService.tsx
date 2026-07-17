import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type EmployeeAttendance,
  EmployeeSelfServiceError,
  requestEmployeeProfileChange,
  saveEmployeeAttendance,
  saveEmployeeSmallNumber,
  useEmployeeAttendance,
  useEmployeeProfile,
  useEmployeeSmallNumbers,
} from "../lib/employeeSelfService";
import { showToast } from "../lib/toast";

const card = "rounded-2xl border border-line bg-card";
const input =
  "min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 font-body text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/15 disabled:cursor-not-allowed disabled:opacity-60";
const primary =
  "min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "min-h-11 rounded-lg border border-line bg-card px-4 font-display text-xs font-bold text-ink-2 transition hover:border-brass disabled:cursor-not-allowed disabled:opacity-50";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentDay() {
  const now = new Date();
  return `${currentPeriod()}-${String(now.getDate()).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: string }) {
	const { t } = useTranslation();
	const positive = ["approved", "accepted", "completed"].includes(status);
  const warning = ["needs_changes", "rejected", "blocked"].includes(status);
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-display text-[10px] font-bold ${
        positive
          ? "bg-success-soft text-success-ink"
          : warning
            ? "bg-overdue-soft text-overdue"
            : "bg-panel-2 text-ink-2"
      }`}
    >
			{t(`employee.selfService.status.${status}`, { defaultValue: status.replaceAll("_", " ") })}
    </span>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel-2 px-4 py-6 text-center font-body text-xs text-ink-3" role="status">
      {label}
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-overdue/20 bg-overdue-soft px-4 py-4" role="alert">
      <p className="font-body text-xs leading-relaxed text-overdue">{t("employee.selfService.loadFailed")}</p>
      <button type="button" className={`${secondary} mt-3`} onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

function mutationMessage(error: unknown) {
  if (error instanceof EmployeeSelfServiceError) {
    if (error.status === 409) return "conflict";
    if (error.status === 423) return "revoked";
    if (error.status === 422) return "invalid";
  }
  return "failed";
}

/** Reuses the same id after a lost response, but rotates it as soon as command content changes. */
function useStableOperationId() {
	const retry = useRef<{ fingerprint: string; id: string } | null>(null);
	return {
		forPayload(payload: unknown) {
			const fingerprint = JSON.stringify(payload);
			if (retry.current?.fingerprint === fingerprint) return retry.current.id;
			const id = crypto.randomUUID();
			retry.current = { fingerprint, id };
			return id;
		},
		clear() {
			retry.current = null;
		},
	};
}

function ProfilePanel() {
  const { t } = useTranslation();
  const query = useEmployeeProfile(true);
  const [form, setForm] = useState({ email: "", phone: "", address: "", bankAccount: "" });
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const operation = useStableOperationId();

  useEffect(() => {
    const profile = query.data?.profile;
    if (!profile || (dirty && sourceVersion === profile.version)) return;
    setForm({
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      address: profile.address ?? "",
      bankAccount: "",
    });
    setSourceVersion(profile.version);
    setDirty(false);
  }, [dirty, query.data?.profile, sourceVersion]);

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const profile = query.data?.profile;
    if (!profile || saving) return;
    const patch: { email?: string; phone?: string; address?: string; bankAccount?: string } = {};
    if (form.email.trim() !== (profile.email ?? "")) patch.email = form.email.trim();
    if (form.phone.trim() !== (profile.phone ?? "")) patch.phone = form.phone.trim();
    if (form.address.trim() !== (profile.address ?? "")) patch.address = form.address.trim();
    if (form.bankAccount.trim()) patch.bankAccount = form.bankAccount.trim();
    if (
      (profile.email && !form.email.trim()) ||
      (profile.phone && !form.phone.trim()) ||
      (profile.address && !form.address.trim())
    ) {
      showToast(t("employee.selfService.profile.clearNotAllowed"));
      return;
    }
    if (Object.keys(patch).length === 0) {
      showToast(t("employee.selfService.profile.noChanges"));
      return;
    }
    setSaving(true);
    try {
      await requestEmployeeProfileChange({ operationId: operation.forPayload(patch), patch });
      operation.clear();
      setDirty(false);
      setForm((current) => ({ ...current, bankAccount: "" }));
      showToast(t("employee.selfService.profile.sent"));
      void query.refetch();
    } catch (error) {
      showToast(t(`employee.selfService.error.${mutationMessage(error)}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="profil" className={`${card} scroll-mt-24 p-5`} aria-labelledby="employee-profile-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
          <Icon name="prirazeni" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="employee-profile-title" className="font-display text-sm font-bold text-ink">
            {t("employee.selfService.profile.title")}
          </h2>
          <p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
            {t("employee.selfService.profile.description")}
          </p>
        </div>
        {query.data?.profile.active && <StatusBadge status="active" />}
      </div>

      <div className="mt-5">
        {query.isLoading ? (
          <LoadingBlock label={t("employee.selfService.loading")} />
        ) : query.isError || !query.data ? (
          <ErrorBlock onRetry={() => void query.refetch()} />
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="font-display text-xs font-bold text-ink-2">
                {t("employee.selfService.profile.name")}
                <input className={`${input} mt-1.5`} value={query.data.profile.name ?? ""} disabled />
              </label>
              <label className="font-display text-xs font-bold text-ink-2">
                {t("employee.selfService.profile.email")}
                <input
                  className={`${input} mt-1.5`}
                  type="email"
                  autoComplete="email"
                  maxLength={180}
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                />
              </label>
              <label className="font-display text-xs font-bold text-ink-2">
                {t("employee.selfService.profile.phone")}
                <input
                  className={`${input} mt-1.5`}
                  type="tel"
                  autoComplete="tel"
                  maxLength={40}
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                />
              </label>
              <label className="font-display text-xs font-bold text-ink-2">
                {t("employee.selfService.profile.bankAccount")}
                <input
                  className={`${input} mt-1.5`}
                  inputMode="text"
                  autoComplete="off"
                  maxLength={60}
                  placeholder={query.data.profile.bankAccountMasked ?? t("employee.selfService.profile.bankAccountPlaceholder")}
                  value={form.bankAccount}
                  onChange={(event) => update("bankAccount", event.target.value)}
                  aria-describedby="employee-bank-account-hint"
                />
                <span id="employee-bank-account-hint" className="mt-1.5 block font-body text-[11px] font-normal leading-relaxed text-ink-3">
                  {t("employee.selfService.profile.bankAccountHint")}
                </span>
              </label>
              <label className="font-display text-xs font-bold text-ink-2 md:col-span-2">
                {t("employee.selfService.profile.address")}
                <input
                  className={`${input} mt-1.5`}
                  autoComplete="street-address"
                  maxLength={300}
                  value={form.address}
                  onChange={(event) => update("address", event.target.value)}
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-line border-t pt-4">
              <button type="submit" className={primary} disabled={saving || !dirty}>
                {saving ? t("employee.selfService.saving") : t("employee.selfService.profile.submit")}
              </button>
              <span className="font-body text-[11px] leading-relaxed text-ink-3">
                {t("employee.selfService.profile.approvalHint")}
              </span>
            </div>
          </form>
        )}
      </div>

      {query.data && query.data.requests.length > 0 && (
        <div className="mt-5 border-line border-t pt-4">
          <h3 className="font-display text-xs font-bold text-ink">{t("employee.selfService.profile.requests")}</h3>
          <ul className="mt-3 space-y-2">
            {query.data.requests.map((request) => (
              <li key={request.id} className="rounded-xl border border-line bg-panel-2 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={request.status} />
                  <span className="font-body text-xs text-ink-2">
                    {request.fields.map((field) => t(`employee.selfService.profile.field.${field}`)).join(", ")}
                  </span>
                </div>
                {request.reviewerNote && <p className="mt-2 font-body text-xs text-ink-3">{request.reviewerNote}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type AttendanceRow = {
  id: string;
  date: string;
  activityType: "training" | "small_numbers" | "other";
  hours: string;
  note: string;
};

function attendanceRows(data: EmployeeAttendance | undefined): AttendanceRow[] {
  return (data?.records ?? []).map((row) => ({
    id: row.id,
    date: row.date ?? "",
    activityType: row.activityType ?? "other",
    hours: row.hours?.toString() ?? "",
    note: row.note ?? "",
  }));
}

function AttendancePanel() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(currentPeriod);
  const query = useEmployeeAttendance(period, true);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [saving, setSaving] = useState<"save_draft" | "submit" | null>(null);
  const operation = useStableOperationId();

  useEffect(() => {
    if (!query.data || (dirty && loadedAt === query.dataUpdatedAt)) return;
    setRows(attendanceRows(query.data.attendance));
    setLoadedAt(query.dataUpdatedAt);
    setDirty(false);
  }, [dirty, loadedAt, query.data, query.dataUpdatedAt]);

  const updateRow = (id: string, patch: Partial<AttendanceRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
  };

  const addRow = () => {
    const today = currentDay();
    setRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        date: period === currentPeriod() ? today : `${period}-01`,
        activityType: "training",
        hours: "",
        note: "",
      },
    ]);
    setDirty(true);
  };

  const save = async (action: "save_draft" | "submit") => {
    const attendance = query.data?.attendance;
    if (!attendance || saving) return;
    const normalized = rows.map((row) => ({ ...row, numericHours: Number(row.hours) }));
    const invalid = normalized.some(
      (row) => !row.date || !row.note.trim() || !Number.isFinite(row.numericHours) || row.numericHours <= 0 || row.numericHours > 12,
    );
    if (invalid || (action === "submit" && rows.length === 0)) {
      showToast(t("employee.selfService.attendance.invalid"));
      return;
    }
    if (action === "submit" && !window.confirm(t("employee.selfService.attendance.confirmSubmit"))) return;
    setSaving(action);
    try {
      const command = {
        period,
        expectedVersion: attendance.expectedVersion,
        action,
        records: normalized.map((row) => ({
          id: row.id,
          date: row.date,
          activityType: row.activityType,
          hours: row.numericHours,
          note: row.note.trim(),
        })),
      };
      await saveEmployeeAttendance({ ...command, operationId: operation.forPayload(command) });
      operation.clear();
      setDirty(false);
      showToast(t(action === "submit" ? "employee.selfService.attendance.submitted" : "employee.selfService.attendance.saved"));
      void query.refetch();
    } catch (error) {
      showToast(t(`employee.selfService.error.${mutationMessage(error)}`));
    } finally {
      setSaving(null);
    }
  };

  const terminal = ["submitted", "approved", "locked"].includes(query.data?.attendance.status ?? "");

  return (
    <section id="dochazka" className={`${card} scroll-mt-24 p-5`} aria-labelledby="employee-attendance-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
          <Icon name="termin" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="employee-attendance-title" className="font-display text-sm font-bold text-ink">
            {t("employee.selfService.attendance.title")}
          </h2>
          <p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
            {t("employee.selfService.attendance.description")}
          </p>
        </div>
        {query.data && <StatusBadge status={query.data.attendance.status} />}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="font-display text-xs font-bold text-ink-2">
          {t("employee.selfService.period")}
          <input
            type="month"
            className={`${input} mt-1.5 w-auto min-w-44`}
            value={period}
            max={currentPeriod()}
            onChange={(event) => {
              setPeriod(event.target.value || currentPeriod());
              setDirty(false);
            }}
          />
        </label>
        <button type="button" className={secondary} onClick={addRow} disabled={query.isLoading || terminal}>
          {t("employee.selfService.attendance.add")}
        </button>
      </div>

      <div className="mt-4">
        {query.isLoading ? (
          <LoadingBlock label={t("employee.selfService.loading")} />
        ) : query.isError || !query.data ? (
          <ErrorBlock onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-panel-2 px-4 py-6 text-center">
            <p className="font-body text-xs text-ink-3">{t("employee.selfService.attendance.empty")}</p>
            <button type="button" className={`${secondary} mt-3`} onClick={addRow} disabled={terminal}>
              {t("employee.selfService.attendance.addFirst")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <fieldset key={row.id} className="rounded-xl border border-line bg-panel-2 p-3" disabled={terminal}>
                <legend className="px-1 font-display text-[10px] font-bold uppercase tracking-wide text-ink-3">
                  {t("employee.selfService.attendance.row", { count: index + 1 })}
                </legend>
                <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_.7fr_auto]">
                  <label className="font-display text-[11px] font-bold text-ink-2">
                    {t("employee.selfService.attendance.date")}
                    <input
                      type="date"
                      className={`${input} mt-1.5`}
                      value={row.date}
                      min={`${period}-01`}
                      max={period === currentPeriod() ? currentDay() : `${period}-31`}
                      onChange={(event) => updateRow(row.id, { date: event.target.value })}
                    />
                  </label>
                  <label className="font-display text-[11px] font-bold text-ink-2">
                    {t("employee.selfService.attendance.activity")}
                    <select
                      className={`${input} mt-1.5`}
                      value={row.activityType}
                      onChange={(event) => updateRow(row.id, { activityType: event.target.value as AttendanceRow["activityType"] })}
                    >
                      <option value="training">{t("employee.selfService.attendance.training")}</option>
                      <option value="small_numbers">{t("employee.selfService.attendance.smallNumbers")}</option>
                      <option value="other">{t("employee.selfService.attendance.other")}</option>
                    </select>
                  </label>
                  <label className="font-display text-[11px] font-bold text-ink-2">
                    {t("employee.selfService.attendance.hours")}
                    <input
                      type="number"
                      className={`${input} mt-1.5`}
                      inputMode="decimal"
                      min="0.25"
                      max="12"
                      step="0.25"
                      value={row.hours}
                      onChange={(event) => updateRow(row.id, { hours: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="min-h-11 self-end rounded-lg border border-line px-3 font-display text-xs font-bold text-overdue hover:border-overdue"
                    onClick={() => {
                      setRows((current) => current.filter((item) => item.id !== row.id));
                      setDirty(true);
                    }}
                    aria-label={t("employee.selfService.attendance.remove", { count: index + 1 })}
                  >
                    {t("common.delete")}
                  </button>
                  <label className="font-display text-[11px] font-bold text-ink-2 md:col-span-4">
                    {t("employee.selfService.attendance.note")}
                    <input
                      className={`${input} mt-1.5`}
                      maxLength={2000}
                      value={row.note}
                      onChange={(event) => updateRow(row.id, { note: event.target.value })}
                    />
                  </label>
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </div>

      {query.data?.attendance.reviewerNote && (
        <div className="mt-4 rounded-xl border border-overdue/20 bg-overdue-soft px-3 py-3 font-body text-xs text-overdue">
          <strong className="font-display">{t("employee.selfService.reviewerNote")}:</strong> {query.data.attendance.reviewerNote}
        </div>
      )}
      {query.data && (
        <div className="mt-5 flex flex-wrap gap-3 border-line border-t pt-4">
          <button type="button" className={secondary} onClick={() => void save("save_draft")} disabled={saving !== null || terminal || !dirty}>
            {saving === "save_draft" ? t("employee.selfService.saving") : t("employee.selfService.saveDraft")}
          </button>
          <button type="button" className={primary} onClick={() => void save("submit")} disabled={saving !== null || terminal || rows.length === 0}>
            {saving === "submit" ? t("employee.selfService.submitting") : t("employee.selfService.submit")}
          </button>
          {dirty && <span className="self-center font-body text-[11px] text-ink-3">{t("employee.selfService.unsaved")}</span>}
        </div>
      )}
    </section>
  );
}

function SmallNumbersPanel() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(currentPeriod);
  const query = useEmployeeSmallNumbers(period, true);
  const [choreographyId, setChoreographyId] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"draft" | "submitted" | null>(null);
  const operation = useStableOperationId();

  useEffect(() => {
    const data = query.data?.smallNumbers;
    if (!data || dirty) return;
    const selected = choreographyId || data.choreographies[0]?.id || "";
    if (selected !== choreographyId) setChoreographyId(selected);
    const entry = data.entries.find((row) => row.choreographyId === selected);
    const total = entry?.hoursMinutes ?? 0;
    setHours(String(Math.floor(total / 60)));
    setMinutes(String(total % 60));
    setNote(entry?.note ?? "");
  }, [choreographyId, dirty, query.data]);

  const selectedEntry = useMemo(
    () => query.data?.smallNumbers.entries.find((row) => row.choreographyId === choreographyId),
    [choreographyId, query.data?.smallNumbers.entries],
  );

  const choose = (id: string) => {
    const entry = query.data?.smallNumbers.entries.find((row) => row.choreographyId === id);
    const total = entry?.hoursMinutes ?? 0;
    setChoreographyId(id);
    setHours(String(Math.floor(total / 60)));
    setMinutes(String(total % 60));
    setNote(entry?.note ?? "");
    setDirty(false);
  };

  const save = async (status: "draft" | "submitted") => {
    if (!choreographyId || saving) return;
    const total = Number(hours) * 60 + Number(minutes);
    if (!Number.isInteger(total) || total < 0 || total > 1440) {
      showToast(t("employee.selfService.smallNumbers.invalid"));
      return;
    }
    if (status === "submitted" && !window.confirm(t("employee.selfService.smallNumbers.confirmSubmit"))) return;
    setSaving(status);
    try {
      const command = {
        period,
        expectedVersion: selectedEntry?.version ?? 0,
        choreographyId,
        hoursMinutes: total,
        note: note.trim() || null,
        status,
      };
      await saveEmployeeSmallNumber({ ...command, operationId: operation.forPayload(command) });
      operation.clear();
      setDirty(false);
      showToast(t(status === "submitted" ? "employee.selfService.smallNumbers.submitted" : "employee.selfService.smallNumbers.saved"));
      void query.refetch();
    } catch (error) {
      showToast(t(`employee.selfService.error.${mutationMessage(error)}`));
    } finally {
      setSaving(null);
    }
  };

  const terminal = ["submitted", "approved", "locked"].includes(selectedEntry?.status ?? "");

  return (
    <section id="mala-cisla" className={`${card} scroll-mt-24 p-5`} aria-labelledby="employee-small-numbers-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
          <Icon name="trvani" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="employee-small-numbers-title" className="font-display text-sm font-bold text-ink">
            {t("employee.selfService.smallNumbers.title")}
          </h2>
          <p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
            {t("employee.selfService.smallNumbers.description")}
          </p>
        </div>
        {selectedEntry && <StatusBadge status={selectedEntry.status} />}
      </div>

      <div className="mt-5">
        {query.isLoading ? (
          <LoadingBlock label={t("employee.selfService.loading")} />
        ) : query.isError || !query.data ? (
          <ErrorBlock onRetry={() => void query.refetch()} />
        ) : query.data.smallNumbers.choreographies.length === 0 ? (
          <LoadingBlock label={t("employee.selfService.smallNumbers.empty")} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="font-display text-xs font-bold text-ink-2">
              {t("employee.selfService.period")}
              <input
                type="month"
                className={`${input} mt-1.5`}
                value={period}
                max={currentPeriod()}
                onChange={(event) => {
                  setPeriod(event.target.value || currentPeriod());
                  setDirty(false);
                }}
              />
            </label>
            <label className="font-display text-xs font-bold text-ink-2">
              {t("employee.selfService.smallNumbers.choreography")}
              <select className={`${input} mt-1.5`} value={choreographyId} onChange={(event) => choose(event.target.value)}>
                {query.data.smallNumbers.choreographies.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label className="font-display text-xs font-bold text-ink-2">
              {t("employee.selfService.smallNumbers.hours")}
              <input
                type="number"
                className={`${input} mt-1.5`}
                min="0"
                max="24"
                step="1"
                value={hours}
                disabled={terminal}
                onChange={(event) => { setHours(event.target.value); setDirty(true); }}
              />
            </label>
            <label className="font-display text-xs font-bold text-ink-2">
              {t("employee.selfService.smallNumbers.minutes")}
              <select
                className={`${input} mt-1.5`}
                value={minutes}
                disabled={terminal}
                onChange={(event) => { setMinutes(event.target.value); setDirty(true); }}
              >
                {[0, 15, 20, 30, 40, 45].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="font-display text-xs font-bold text-ink-2 md:col-span-2">
              {t("employee.selfService.smallNumbers.note")}
              <textarea
                className={`${input} mt-1.5 min-h-24 resize-y py-3`}
                maxLength={1000}
                value={note}
                disabled={terminal}
                onChange={(event) => { setNote(event.target.value); setDirty(true); }}
              />
            </label>
          </div>
        )}
      </div>

      {selectedEntry?.reviewerNote && (
        <div className="mt-4 rounded-xl border border-overdue/20 bg-overdue-soft px-3 py-3 font-body text-xs text-overdue">
          <strong className="font-display">{t("employee.selfService.reviewerNote")}:</strong> {selectedEntry.reviewerNote}
        </div>
      )}
      {query.data && query.data.smallNumbers.choreographies.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-3 border-line border-t pt-4">
          <button type="button" className={secondary} onClick={() => void save("draft")} disabled={saving !== null || terminal || !dirty}>
            {saving === "draft" ? t("employee.selfService.saving") : t("employee.selfService.saveDraft")}
          </button>
          <button type="button" className={primary} onClick={() => void save("submitted")} disabled={saving !== null || terminal || !choreographyId}>
            {saving === "submitted" ? t("employee.selfService.submitting") : t("employee.selfService.submit")}
          </button>
          {dirty && <span className="self-center font-body text-[11px] text-ink-3">{t("employee.selfService.unsaved")}</span>}
        </div>
      )}
    </section>
  );
}

export function EmployeeSelfService() {
  const { t } = useTranslation();
  const links = [
    ["profil", "prirazeni", "profile"],
    ["dochazka", "termin", "attendance"],
    ["mala-cisla", "trvani", "smallNumbers"],
  ] as const;
  return (
    <div className="mt-6">
      <div className="mb-4">
        <h2 className="font-display text-base font-extrabold text-ink">{t("employee.selfService.title")}</h2>
        <p className="mt-1 max-w-[72ch] font-body text-xs leading-relaxed text-ink-3">
          {t("employee.selfService.description")}
        </p>
      </div>
      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label={t("employee.selfService.navigation")}>
        {links.map(([href, icon, key]) => (
          <a key={href} href={`#${href}`} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-card px-3 font-display text-xs font-bold text-ink-2 hover:border-brass hover:text-brass-text">
            <Icon name={icon} size={16} />
            {t(`employee.selfService.${key}.nav`)}
          </a>
        ))}
      </nav>
      <div className="space-y-4">
        <ProfilePanel />
        <AttendancePanel />
        <SmallNumbersPanel />
      </div>
    </div>
  );
}
