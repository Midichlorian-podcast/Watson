import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	EmployeeLifecycleError,
	type EmployeeLifecycleInstance,
	type EmployeeLifecycleResponseType,
	respondToEmployeeLifecycle,
	respondToEmployeeLifecycleWithFile,
	useEmployeeLifecycle,
} from "../lib/employeeLifecycle";
import { showToast } from "../lib/toast";

const card = "rounded-2xl border border-line bg-card";
const input =
	"min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 font-body text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/15 disabled:cursor-not-allowed disabled:opacity-60";
const primary =
	"min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
	"min-h-11 rounded-lg border border-line bg-card px-4 font-display text-xs font-bold text-ink-2 transition hover:border-brass disabled:cursor-not-allowed disabled:opacity-50";
const supportedFiles = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.txt,.csv,.xml,.doc,.docx,.xlsx";

function displayDate(value: string, locale: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function mutationMessage(error: unknown) {
	if (!(error instanceof EmployeeLifecycleError)) return "failed";
	if (error.status === 409) return "conflict";
	if (error.status === 423) return "revoked";
	if (error.status === 415 || error.status === 422) return "invalid";
	return "failed";
}

function StatusBadge({ status }: { status: EmployeeLifecycleInstance["status"] }) {
	const { t } = useTranslation();
	const positive = status === "completed";
	const negative = status === "cancelled" || status === "needs_changes";
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
			{t(`employee.lifecycle.status.${status}`)}
		</span>
	);
}

function ResponseEditor({ instance }: { instance: EmployeeLifecycleInstance }) {
	const { t } = useTranslation();
	const openItems = instance.items.filter((item) => !item.completed);
	const [itemKey, setItemKey] = useState(openItems[0]?.key ?? "");
	const selected = openItems.find((item) => item.key === itemKey) ?? openItems[0];
	const [responseType, setResponseType] = useState<EmployeeLifecycleResponseType>(
		selected?.suggestedResponseType ?? "confirmation",
	);
	const [value, setValue] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [saving, setSaving] = useState(false);
	const retry = useRef<{ fingerprint: string; operationId: string } | null>(null);
	const query = useEmployeeLifecycle(true);
	const terminal = ["submitted", "completed", "cancelled"].includes(instance.status);

	useEffect(() => {
		const next = openItems[0];
		if (!next || openItems.some((item) => item.key === itemKey)) return;
		setItemKey(next.key);
		setResponseType(next.suggestedResponseType);
		setValue("");
		setFile(null);
		retry.current = null;
	}, [itemKey, openItems]);

	if (terminal || openItems.length === 0) {
		return (
			<p className="mt-3 rounded-xl border border-line bg-panel-2 px-3 py-3 font-body text-xs leading-relaxed text-ink-3">
				{t(instance.status === "completed" ? "employee.lifecycle.completed" : "employee.lifecycle.waitingReview")}
			</p>
		);
	}

	const selectItem = (key: string) => {
		setItemKey(key);
		const next = instance.items.find((item) => item.key === key);
		setResponseType(next?.suggestedResponseType ?? "confirmation");
		setValue("");
		setFile(null);
		retry.current = null;
	};

	const submit = async () => {
		if (!selected || saving || (responseType === "file" ? !file : false)) return;
		const needsValue = ["text", "form", "decline", "question"].includes(responseType);
		if (needsValue && !value.trim()) {
			showToast(t("employee.lifecycle.error.invalid"));
			return;
		}
		if (!window.confirm(t("employee.lifecycle.confirm", { item: selected.label }))) return;
		const fingerprint = JSON.stringify({
			instanceId: instance.id,
			version: instance.version,
			itemKey: selected.key,
			responseType,
			value: value.trim(),
			file: file ? [file.name, file.size, file.lastModified] : null,
		});
		const operationId =
			retry.current?.fingerprint === fingerprint ? retry.current.operationId : crypto.randomUUID();
		retry.current = { fingerprint, operationId };
		setSaving(true);
		try {
			if (responseType === "file" && file) {
				await respondToEmployeeLifecycleWithFile({
					operationId,
					lifecycleType: instance.type,
					lifecycleId: instance.id,
					expectedVersion: instance.version,
					itemKey: selected.key,
					file,
				});
			} else if (responseType !== "file") {
				await respondToEmployeeLifecycle({
					operationId,
					lifecycleType: instance.type,
					lifecycleId: instance.id,
					expectedVersion: instance.version,
					itemKey: selected.key,
					responseType,
					value: value.trim() || null,
					confirmed: ["confirmation", "consent"].includes(responseType),
				});
			}
			retry.current = null;
			setValue("");
			setFile(null);
			showToast(t("employee.lifecycle.sent"));
			await query.refetch();
		} catch (error) {
			showToast(t(`employee.lifecycle.error.${mutationMessage(error)}`));
			if (error instanceof EmployeeLifecycleError && error.status === 409) await query.refetch();
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mt-4 rounded-xl border border-line bg-panel-2 p-4">
			<div className="grid gap-3 md:grid-cols-2">
				<label className="font-display text-[11px] font-bold text-ink-2">
					{t("employee.lifecycle.item")}
					<select className={`${input} mt-1.5`} value={selected?.key ?? ""} onChange={(event) => selectItem(event.target.value)}>
						{openItems.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
					</select>
				</label>
				<label className="font-display text-[11px] font-bold text-ink-2">
					{t("employee.lifecycle.responseTypeLabel")}
					<select className={`${input} mt-1.5`} value={responseType} onChange={(event) => { setResponseType(event.target.value as EmployeeLifecycleResponseType); setValue(""); setFile(null); retry.current = null; }}>
						{(["confirmation", "text", "form", "file", "consent", "question", "decline"] as const).map((type) => (
							<option key={type} value={type}>{t(`employee.lifecycle.responseType.${type}`)}</option>
						))}
					</select>
				</label>
			</div>
			{selected?.description && <p className="mt-3 font-body text-xs leading-relaxed text-ink-3">{selected.description}</p>}
			{["text", "form", "decline", "question"].includes(responseType) && (
				<label className="mt-3 block font-display text-[11px] font-bold text-ink-2">
					{t(`employee.lifecycle.valueLabel.${responseType}`)}
					<textarea className={`${input} mt-1.5 min-h-24 resize-y py-3`} maxLength={5000} value={value} onChange={(event) => { setValue(event.target.value); retry.current = null; }} />
				</label>
			)}
			{responseType === "file" && (
				<label className="mt-3 block cursor-pointer font-display text-[11px] font-bold text-ink-2">
					{t("employee.lifecycle.file")}
					<input type="file" accept={supportedFiles} className="peer sr-only" aria-label={t("employee.lifecycle.file")} onChange={(event) => { setFile(event.target.files?.[0] ?? null); retry.current = null; }} />
					<span className={`${input} mt-1.5 flex items-center gap-3 overflow-hidden p-0 pr-3 peer-focus-visible:border-brass peer-focus-visible:ring-2 peer-focus-visible:ring-brass/20`} aria-hidden="true">
						<span className="flex min-h-11 shrink-0 items-center border-line border-r bg-card px-3 text-brass-text">{t("employee.files.chooseFile")}</span>
						<span className="min-w-0 truncate font-body font-normal text-ink-3">{file?.name ?? t("employee.files.noFileSelected")}</span>
					</span>
				</label>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<button type="button" className={primary} disabled={saving || (responseType === "file" && !file)} onClick={() => void submit()}>
					{saving ? t("employee.lifecycle.sending") : t("employee.lifecycle.submit")}
				</button>
				<p className="max-w-[64ch] font-body text-[11px] leading-relaxed text-ink-3">{t("employee.lifecycle.privacy")}</p>
			</div>
		</div>
	);
}

export function EmployeeLifecycle() {
	const { t, i18n } = useTranslation();
	const query = useEmployeeLifecycle(true);
	const instances = useMemo(
		() => query.data?.instances.filter((instance) => instance.status !== "cancelled") ?? [],
		[query.data?.instances],
	);

	return (
		<section id="nastup-a-odchod" className={`${card} scroll-mt-24 p-5`} aria-labelledby="employee-lifecycle-title">
			<div className="flex flex-wrap items-start gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
					<Icon name="postup" size={20} />
				</div>
				<div className="min-w-0 flex-1">
					<h2 id="employee-lifecycle-title" className="font-display text-sm font-bold text-ink">{t("employee.lifecycle.title")}</h2>
					<p className="mt-1 max-w-[76ch] font-body text-xs leading-relaxed text-ink-3">{t("employee.lifecycle.description")}</p>
				</div>
			</div>

			{query.isLoading ? (
				<div className="mt-4 rounded-xl border border-dashed border-line bg-panel-2 px-4 py-6 text-center font-body text-xs text-ink-3" role="status">{t("employee.lifecycle.loading")}</div>
			) : query.isError ? (
				<div className="mt-4 rounded-xl border border-overdue/20 bg-overdue-soft px-4 py-4" role="alert">
					<p className="font-body text-xs text-overdue">{t("employee.lifecycle.loadFailed")}</p>
					<button type="button" className={`${secondary} mt-3`} onClick={() => void query.refetch()}>{t("common.retry")}</button>
				</div>
			) : instances.length === 0 ? (
				<p className="mt-4 rounded-xl border border-dashed border-line bg-panel-2 px-4 py-6 text-center font-body text-xs text-ink-3">{t("employee.lifecycle.empty")}</p>
			) : (
				<div className="mt-4 space-y-3">
					{instances.map((instance) => {
						const percent = Math.round((instance.completedCount / instance.totalCount) * 100);
						return (
							<article key={instance.id} id={instance.type} className="scroll-mt-24 rounded-xl border border-line p-4">
								<div className="flex flex-wrap items-start gap-3">
									<div className="min-w-0 flex-1">
										<p className="font-display text-[10px] font-bold uppercase tracking-[.12em] text-ink-3">{t(`employee.lifecycle.type.${instance.type}`)}</p>
										<h3 className="mt-1 font-display text-sm font-bold text-ink">{instance.title}</h3>
									</div>
									<StatusBadge status={instance.status} />
								</div>
								<div className="mt-3 flex items-center gap-3">
									<div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-brass transition-[width]" style={{ width: `${percent}%` }} /></div>
									<span className="shrink-0 font-mono text-[11px] text-ink-3">{instance.completedCount}/{instance.totalCount}</span>
								</div>
								{instance.dueAt && <p className="mt-2 font-body text-[11px] text-ink-3">{t("employee.lifecycle.due", { date: displayDate(instance.dueAt, i18n.language) })}</p>}
								<ResponseEditor instance={instance} />
							</article>
						);
					})}
				</div>
			)}
		</section>
	);
}
