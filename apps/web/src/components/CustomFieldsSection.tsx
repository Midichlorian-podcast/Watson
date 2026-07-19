import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import {
	CUSTOM_FIELD_TYPES,
	CustomFieldApiError,
	type CustomFieldOption,
	type CustomFieldType,
	createCustomField,
	deleteCustomField,
	parseCustomFieldOptions,
	parseCustomFieldValue,
	setTaskCustomFieldValue,
	updateCustomField,
} from "../lib/customFields";
import type {
	ProjectCustomFieldRow,
	TaskCustomFieldValueRow,
} from "../lib/powersync/AppSchema";
import { showToast } from "../lib/toast";

type Member = { id: string; name: string };
type Field = Omit<ProjectCustomFieldRow, "field_type" | "options"> & {
	field_type: CustomFieldType;
	options: CustomFieldOption[];
};

function errorMessage(error: unknown, t: (key: string) => string) {
	if (error instanceof CustomFieldApiError) {
		if (error.code === "custom_field_name_conflict") return t("detail.customFieldNameConflict");
		if (error.code === "custom_field_option_in_use") return t("detail.customFieldOptionInUse");
		if (error.code === "custom_field_delete_manager_only")
			return t("detail.customFieldDeleteManagerOnly");
		if (error.code === "invalid_custom_field_value") return t("detail.customFieldInvalidValue");
	}
	return t("detail.customFieldSaveFailed");
}

function FieldControl({
	field,
	value,
	members,
	disabled,
	onSave,
}: {
	field: Field;
	value: unknown;
	members: Member[];
	disabled: boolean;
	onSave: (value: unknown) => Promise<void>;
}) {
	const { t } = useTranslation();
	const serialized = value == null ? "" : String(value);
	const [draft, setDraft] = useState(serialized);
	const [busy, setBusy] = useState(false);
	useEffect(() => setDraft(serialized), [serialized]);
	const save = async (next: unknown) => {
		if (busy || disabled) return;
		setBusy(true);
		try {
			await onSave(next);
		} catch {
			setDraft(serialized);
		} finally {
			setBusy(false);
		}
	};
	const inputClass =
		"min-h-11 w-full rounded-lg border border-line bg-card px-3 font-body text-ink outline-none focus:border-brass disabled:cursor-not-allowed disabled:opacity-60";

	if (field.field_type === "checkbox") {
		const checked = draft === "true";
		return (
			<button
				type="button"
				disabled={disabled || busy}
				aria-pressed={checked}
				onClick={() => {
					setDraft(String(!checked));
					void save(!checked);
				}}
				className="flex min-h-11 w-full items-center rounded-lg border border-line bg-card px-3 text-left font-body text-ink-2 hover:border-brass disabled:opacity-60"
				style={{ gap: 9, fontSize: 12.5 }}
			>
				<span
					className="grid h-[18px] w-[18px] place-items-center rounded-[5px] border"
					style={{
						borderColor: checked ? "var(--w-brass)" : "var(--w-line)",
						background: checked ? "var(--w-brass)" : "transparent",
						color: "#fff",
					}}
				>
					{checked ? "✓" : ""}
				</span>
				{t(checked ? "common.yes" : "common.no")}
			</button>
		);
	}

	if (field.field_type === "select" || field.field_type === "person") {
		return (
			<select
				value={draft}
				disabled={disabled || busy}
				onChange={(event) => {
					setDraft(event.target.value);
					void save(event.target.value || null);
				}}
				className={inputClass}
				style={{ fontSize: 12.5 }}
			>
				<option value="">{t("detail.customFieldEmptyValue")}</option>
				{field.field_type === "select"
					? field.options.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))
					: members.map((member) => (
							<option key={member.id} value={member.id}>
								{member.name}
							</option>
						))}
			</select>
		);
	}

	const type =
		field.field_type === "number"
			? "number"
			: field.field_type === "date"
				? "date"
				: field.field_type === "url"
					? "url"
					: "text";
	return (
		<input
			type={type}
			value={draft}
			disabled={disabled || busy}
			maxLength={field.field_type === "text" ? 4000 : field.field_type === "url" ? 2048 : undefined}
			step={field.field_type === "number" ? "any" : undefined}
			onChange={(event) => setDraft(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
			}}
			onBlur={() => {
				if (draft === serialized) return;
				const next =
					draft === "" ? null : field.field_type === "number" ? Number(draft) : draft;
				void save(next);
			}}
			placeholder={t("detail.customFieldEmptyValue")}
			className={inputClass}
			style={{ fontSize: 12.5 }}
		/>
	);
}

export function CustomFieldsSection({
	taskId,
	projectId,
	members,
	canEdit,
}: {
	taskId: string;
	projectId: string;
	members: Member[];
	canEdit: boolean;
}) {
	const { t } = useTranslation();
	const { data: rawFields } = usePsQuery<ProjectCustomFieldRow>(
		"SELECT * FROM project_custom_fields WHERE project_id = ? ORDER BY position, created_at, id",
		[projectId],
	);
	const { data: values } = usePsQuery<TaskCustomFieldValueRow>(
		"SELECT * FROM task_custom_field_values WHERE task_id = ?",
		[taskId],
	);
	const fields = useMemo<Field[]>(
		() =>
			(rawFields ?? [])
				.filter((field) => CUSTOM_FIELD_TYPES.includes(field.field_type as CustomFieldType))
				.map((field) => ({
					...field,
					field_type: field.field_type as CustomFieldType,
					options: parseCustomFieldOptions(field.options),
				})),
		[rawFields],
	);
	const valueByField = new Map(
		(values ?? []).map((row) => [row.field_id, parseCustomFieldValue(row.value)] as const),
	);
	const [builderOpen, setBuilderOpen] = useState(false);
	const [name, setName] = useState("");
	const [type, setType] = useState<CustomFieldType>("text");
	const [optionText, setOptionText] = useState("");
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const [editOptions, setEditOptions] = useState("");
	const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

	const labelsFromText = (text: string) =>
		text
			.split("\n")
			.map((label) => label.trim())
			.filter(Boolean);

	const create = async () => {
		const labels = labelsFromText(optionText);
		if (!name.trim() || (type === "select" && labels.length < 2)) {
			showToast(t("detail.customFieldIncomplete"));
			return;
		}
		setBusy(true);
		try {
			await createCustomField({
				id: crypto.randomUUID(),
				projectId,
				name: name.trim(),
				fieldType: type,
				...(type === "select" ? { options: labels } : {}),
			});
			setName("");
			setType("text");
			setOptionText("");
			setBuilderOpen(false);
			showToast(t("detail.customFieldCreated"));
		} catch (error) {
			showToast(errorMessage(error, t));
		} finally {
			setBusy(false);
		}
	};

	const saveDefinition = async (field: Field) => {
		const labels = labelsFromText(editOptions);
		if (!editName.trim() || (field.field_type === "select" && labels.length < 2)) {
			showToast(t("detail.customFieldIncomplete"));
			return;
		}
		setBusy(true);
		try {
			await updateCustomField(field.id, {
				name: editName.trim(),
				...(field.field_type === "select" ? { options: labels } : {}),
			});
			setEditing(null);
			showToast(t("detail.customFieldSaved"));
		} catch (error) {
			showToast(errorMessage(error, t));
		} finally {
			setBusy(false);
		}
	};

	const removeDefinition = async (field: Field) => {
		if (deleteConfirm !== field.id) {
			setDeleteConfirm(field.id);
			showToast(t("detail.customFieldDeleteConfirm"));
			return;
		}
		setBusy(true);
		try {
			await deleteCustomField(field.id, field.name ?? "");
			setDeleteConfirm(null);
			setEditing(null);
			showToast(t("detail.customFieldDeleted"));
		} catch (error) {
			showToast(errorMessage(error, t));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section aria-labelledby={`custom-fields-${taskId}`}>
			<div className="flex min-h-11 items-center justify-between" style={{ gap: 8, marginTop: 15 }}>
				<h3
					id={`custom-fields-${taskId}`}
					className="font-display font-bold text-ink-3 uppercase"
					style={{ fontSize: 11, letterSpacing: ".06em" }}
				>
					{t("detail.customFields")} · {fields.length}
				</h3>
				{canEdit && (
					<button
						type="button"
						onClick={() => setBuilderOpen((open) => !open)}
						aria-expanded={builderOpen}
						className="min-h-11 rounded-lg px-3 font-display font-semibold text-brass-text hover:bg-panel-2"
						style={{ fontSize: 11.5 }}
					>
						{builderOpen ? t("common.cancel") : `+ ${t("detail.customFieldAdd")}`}
					</button>
				)}
			</div>

			{fields.length === 0 && !builderOpen && (
				<p className="rounded-lg border border-line border-dashed bg-panel-2 px-3 py-3 font-body text-ink-3" style={{ fontSize: 12 }}>
					{t(canEdit ? "detail.customFieldsEmptyEditor" : "detail.customFieldsEmpty")}
				</p>
			)}

			<div className="space-y-2">
				{fields.map((field) => {
					const isEditing = editing === field.id;
					return (
						<div key={field.id} className="rounded-xl border border-line bg-panel-2 p-3">
							{isEditing ? (
								<div className="space-y-2">
									<input
										value={editName}
										onChange={(event) => setEditName(event.target.value)}
										maxLength={120}
										aria-label={t("detail.customFieldName")}
										className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brass"
									/>
									{field.field_type === "select" && (
										<textarea
											value={editOptions}
											onChange={(event) => setEditOptions(event.target.value)}
											rows={3}
											aria-label={t("detail.customFieldOptions")}
											className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brass"
										/>
									)}
									<div className="flex flex-wrap justify-end" style={{ gap: 7 }}>
										<button
											type="button"
											disabled={busy}
											onClick={() => void removeDefinition(field)}
											className={`min-h-11 rounded-lg px-3 font-display font-semibold ${deleteConfirm === field.id ? "bg-overdue-soft text-overdue" : "text-ink-3 hover:text-overdue"}`}
											style={{ fontSize: 11.5 }}
										>
											{deleteConfirm === field.id
												? t("detail.customFieldDeleteNow")
												: t("common.delete")}
										</button>
										<button
											type="button"
											onClick={() => setEditing(null)}
											className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-2"
										>
											{t("common.cancel")}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => void saveDefinition(field)}
											className="min-h-11 rounded-lg bg-brass px-3 font-display font-bold text-white disabled:opacity-60"
										>
											{t("common.save")}
										</button>
									</div>
								</div>
							) : (
								<>
									<div className="mb-1 flex min-h-8 items-center justify-between" style={{ gap: 8 }}>
									<span className="font-display font-semibold text-ink-2" style={{ fontSize: 11.5 }}>
										{field.name}
									</span>
										{canEdit && (
											<button
												type="button"
												aria-label={t("detail.customFieldEdit")}
												onClick={() => {
													setEditing(field.id);
													setEditName(field.name ?? "");
													setEditOptions(field.options.map((option) => option.label).join("\n"));
													setDeleteConfirm(null);
												}}
												className="grid h-11 w-11 place-items-center rounded-lg text-ink-3 hover:bg-card hover:text-brass-text"
											>
												•••
											</button>
										)}
									</div>
									<FieldControl
										field={field}
										value={valueByField.get(field.id) ?? null}
										members={members}
										disabled={!canEdit}
										onSave={async (value) => {
											try {
												await setTaskCustomFieldValue(taskId, projectId, field.id, value);
												showToast(t("detail.customFieldSaved"));
											} catch (error) {
												showToast(errorMessage(error, t));
												throw error;
											}
										}}
									/>
								</>
							)}
						</div>
					);
				})}
			</div>

			{builderOpen && (
				<div className="mt-2 rounded-xl border border-brass bg-brass-soft p-3">
					<div className="grid gap-2 sm:grid-cols-[1fr_150px]">
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={120}
							placeholder={t("detail.customFieldName")}
							className="min-h-11 rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brass"
						/>
						<select
							value={type}
							onChange={(event) => setType(event.target.value as CustomFieldType)}
							aria-label={t("detail.customFieldType")}
							className="min-h-11 rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brass"
						>
							{CUSTOM_FIELD_TYPES.map((candidate) => (
								<option key={candidate} value={candidate}>
									{t(`detail.customFieldType_${candidate}`)}
								</option>
							))}
						</select>
					</div>
					{type === "select" && (
						<>
							<textarea
								value={optionText}
								onChange={(event) => setOptionText(event.target.value)}
								rows={3}
								placeholder={t("detail.customFieldOptionsPlaceholder")}
								className="mt-2 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brass"
							/>
							<p className="mt-1 font-body text-ink-3" style={{ fontSize: 11 }}>
								{t("detail.customFieldOptionsHint")}
							</p>
						</>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() => void create()}
						className="mt-3 min-h-11 w-full rounded-lg bg-brass px-3 font-display font-bold text-white disabled:opacity-60"
						style={{ fontSize: 12 }}
					>
						{busy ? t("common.saving") : t("detail.customFieldCreate")}
					</button>
				</div>
			)}
		</section>
	);
}
