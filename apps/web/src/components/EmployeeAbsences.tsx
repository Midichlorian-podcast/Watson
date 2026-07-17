import { useTranslation } from "@watson/i18n";
import { deviceTimeZone } from "@watson/shared";
import { Icon } from "@watson/ui";
import { type FormEvent, useMemo, useRef, useState } from "react";
import {
	type EmployeeAbsenceCase,
	EmployeeAbsenceError,
	type EmployeeAbsenceKind,
	requestEmployeeAbsence,
	useEmployeeAbsences,
} from "../lib/employeeAbsences";
import { showToast } from "../lib/toast";

const card = "rounded-2xl border border-line bg-card";
const input =
	"min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 font-body text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/15 disabled:cursor-not-allowed disabled:opacity-60";
const primary =
	"min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
	"min-h-11 rounded-lg border border-line bg-card px-4 font-display text-xs font-bold text-ink-2 transition hover:border-brass disabled:cursor-not-allowed disabled:opacity-50";

function localDay() {
	const date = new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: EmployeeAbsenceCase["status"] }) {
	const { t } = useTranslation();
	const positive = status === "resolved";
	const negative = status === "rejected" || status === "cancelled";
	return (
		<span
			className={`rounded-full px-2.5 py-1 font-display text-[10px] font-bold ${
				positive
					? "bg-success-soft text-success-ink"
					: negative
						? "bg-overdue-soft text-overdue"
						: "bg-brass-soft text-brass-text"
			}`}
		>
			{t(`employee.absences.status.${status}`)}
		</span>
	);
}

function displayDate(value: string, locale: string) {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return value;
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
		new Date(Date.UTC(year, month - 1, day, 12)),
	);
}

function mutationMessage(error: unknown) {
	if (!(error instanceof EmployeeAbsenceError)) return "failed";
	if (error.code === "absence_overlap" || error.status === 409) return "overlap";
	if (error.status === 423) return "revoked";
	if (error.status === 422) return "invalid";
	return "failed";
}

export function EmployeeAbsences() {
	const { t, i18n } = useTranslation();
	const query = useEmployeeAbsences(true);
	const [kind, setKind] = useState<EmployeeAbsenceKind>("vacation");
	const [startDate, setStartDate] = useState(localDay);
	const [endDate, setEndDate] = useState(localDay);
	const [visibility, setVisibility] = useState<"team" | "private">("team");
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const retry = useRef<{ fingerprint: string; id: string } | null>(null);
	const timezone = useMemo(deviceTimeZone, []);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving || !startDate || !endDate || endDate < startDate) {
			showToast(t("employee.absences.error.invalid"));
			return;
		}
		const payload = {
			kind,
			startDate,
			endDate,
			timezone,
			visibility,
			note: note.trim() || null,
		};
		if (!window.confirm(t("employee.absences.confirm", { from: startDate, to: endDate }))) return;
		const fingerprint = JSON.stringify(payload);
		const operationId =
			retry.current?.fingerprint === fingerprint ? retry.current.id : crypto.randomUUID();
		retry.current = { fingerprint, id: operationId };
		setSaving(true);
		try {
			await requestEmployeeAbsence({ operationId, ...payload });
			retry.current = null;
			setNote("");
			showToast(t("employee.absences.sent"));
			await query.refetch();
		} catch (error) {
			showToast(t(`employee.absences.error.${mutationMessage(error)}`));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			id="absence"
			className={`${card} scroll-mt-24 p-5`}
			aria-labelledby="employee-absences-title"
		>
			<div className="flex flex-wrap items-start gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
					<Icon name="termin" size={20} />
				</div>
				<div className="min-w-0 flex-1">
					<h2 id="employee-absences-title" className="font-display text-sm font-bold text-ink">
						{t("employee.absences.title")}
					</h2>
					<p className="mt-1 max-w-[76ch] font-body text-xs leading-relaxed text-ink-3">
						{t("employee.absences.description")}
					</p>
				</div>
			</div>

			<form className="mt-5 rounded-xl border border-line bg-panel-2 p-4" onSubmit={submit}>
				<div className="grid gap-3 md:grid-cols-3">
					<label className="font-display text-[11px] font-bold text-ink-2">
						{t("employee.absences.kindLabel")}
						<select
							className={`${input} mt-1.5`}
							value={kind}
							onChange={(event) => setKind(event.target.value as EmployeeAbsenceKind)}
						>
							{(["vacation", "sickness", "doctor", "family_care", "other"] as const).map(
								(value) => (
									<option key={value} value={value}>
										{t(`employee.absences.kind.${value}`)}
									</option>
								),
							)}
						</select>
					</label>
					<label className="font-display text-[11px] font-bold text-ink-2">
						{t("employee.absences.from")}
						<input
							type="date"
							className={`${input} mt-1.5`}
							value={startDate}
							onChange={(event) => {
								const value = event.target.value;
								setStartDate(value);
								if (endDate < value) setEndDate(value);
							}}
						/>
					</label>
					<label className="font-display text-[11px] font-bold text-ink-2">
						{t("employee.absences.to")}
						<input
							type="date"
							className={`${input} mt-1.5`}
							value={endDate}
							min={startDate}
							onChange={(event) => setEndDate(event.target.value)}
						/>
					</label>
				</div>
				<label className="mt-3 block font-display text-[11px] font-bold text-ink-2">
					{t("employee.absences.note")}
					<textarea
						className={`${input} mt-1.5 min-h-24 resize-y py-2.5`}
						maxLength={2_000}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				</label>
				<label className="mt-3 flex min-h-11 items-start gap-3 rounded-lg border border-line bg-card px-3 py-3 font-body text-xs leading-relaxed text-ink-2">
					<input
						type="checkbox"
						className="mt-0.5 h-4 w-4 accent-brass"
						checked={visibility === "private"}
						onChange={(event) => setVisibility(event.target.checked ? "private" : "team")}
					/>
					<span>{t("employee.absences.private")}</span>
				</label>
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<button type="submit" className={primary} disabled={saving}>
						{saving ? t("employee.absences.sending") : t("employee.absences.submit")}
					</button>
					<span className="font-body text-[11px] text-ink-3">
						{t("employee.absences.timezone", { timezone })}
					</span>
				</div>
			</form>

			<div className="mt-5">
				<h3 className="font-display text-xs font-bold text-ink">{t("employee.absences.history")}</h3>
				{query.isLoading ? (
					<div className="mt-3 rounded-xl border border-dashed border-line px-4 py-5 text-center font-body text-xs text-ink-3" role="status">
						{t("employee.absences.loading")}
					</div>
				) : query.isError || !query.data ? (
					<div className="mt-3 rounded-xl border border-overdue/20 bg-overdue-soft px-4 py-4" role="alert">
						<p className="font-body text-xs text-overdue">{t("employee.absences.loadFailed")}</p>
						<button type="button" className={`${secondary} mt-3`} onClick={() => void query.refetch()}>
							{t("common.retry")}
						</button>
					</div>
				) : query.data.cases.length === 0 ? (
					<p className="mt-3 rounded-xl border border-dashed border-line px-4 py-5 text-center font-body text-xs text-ink-3">
						{t("employee.absences.empty")}
					</p>
				) : (
					<ul className="mt-3 space-y-3">
						{query.data.cases.map((item) => (
							<li key={item.id} className="rounded-xl border border-line bg-panel-2 px-4 py-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p className="font-display text-sm font-bold text-ink">
											{t(`employee.absences.kind.${item.kind}`)}
										</p>
										<p className="mt-1 font-body text-xs text-ink-3">
											{displayDate(item.startDate, i18n.language)} – {displayDate(item.endDate, i18n.language)}
										</p>
									</div>
									<StatusBadge status={item.status} />
								</div>
								{item.resolutionPublic && (
									<p className="mt-3 rounded-lg border border-line bg-card px-3 py-3 font-body text-xs leading-relaxed text-ink-2">
										{item.resolutionPublic}
									</p>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
