import { useTranslation } from "@watson/i18n";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import {
	ATTACHMENT_MAX_BYTES,
	cancelAttachmentStage,
	deleteAttachment,
	finalizeAttachment,
	stageAttachment,
} from "../lib/attachments";
import {
	IMPORT_FIELDS,
	type ImportField,
	type ImportMapping,
	type ImportMember,
	type ImportSource,
	matchSupportingFiles,
	normalizeImportRows,
	parseDelimitedText,
	sha256File,
	suggestMapping,
	type CsvTable,
} from "../lib/importCsv";

type Project = { id: string; name: string; workspaceId: string; role: string };
type Preview = {
	valid: boolean;
	errors: { sourceKey: string; field: string; code: string }[];
	summary: { items: number; completed: number; sections: number; labels: number; assignees: number; attachments: number };
};
type Batch = {
	id: string;
	projectId: string;
	source: ImportSource;
	sourceName: string;
	status: "imported" | "rolled_back";
	itemCount: number;
	attachmentExpected: number;
	attachmentRegistered: number;
	importedAt: string;
	rolledBackAt: string | null;
	updatedAt: string;
};
type ExecuteResult = {
	batch: Batch;
	items: { id: string; sourceKey: string; taskId: string }[];
	replayed: boolean;
};

const CARD: CSSProperties = {
	background: "var(--w-card)",
	border: "1px solid var(--w-line)",
	borderRadius: 13,
	overflow: "hidden",
};
const FIELD: CSSProperties = {
	width: "100%",
	minHeight: 44,
	fontSize: 13,
	color: "var(--w-ink)",
	background: "var(--w-panel-2)",
	border: "1px solid var(--w-line)",
	borderRadius: 9,
	padding: "9px 11px",
};
const PRIMARY: CSSProperties = {
	minHeight: 44,
	fontSize: 12.5,
	fontWeight: 700,
	color: "var(--w-brass-text)",
	background: "var(--w-brass-soft)",
	border: "1px solid var(--w-brass)",
	borderRadius: 9,
	padding: "9px 16px",
	cursor: "pointer",
};
const GHOST: CSSProperties = {
	...PRIMARY,
	color: "var(--w-ink-2)",
	background: "transparent",
	border: "1px solid var(--w-line)",
};
const MUTED: CSSProperties = { color: "var(--w-ink-3)", fontSize: 12, lineHeight: 1.55 };
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

class ImportRequestError extends Error {
	constructor(readonly code: string, readonly status: number) {
		super(code);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		credentials: "include",
		headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
	});
	const body = (await response.json().catch(() => null)) as ({ error?: unknown } & T) | null;
	if (!response.ok)
		throw new ImportRequestError(
			typeof body?.error === "string" ? body.error : "request_failed",
			response.status,
		);
	return body as T;
}

function disabledStyle(disabled: boolean): CSSProperties {
	return disabled ? { opacity: 0.48, cursor: "not-allowed" } : {};
}

function fileKey(sourceKey: string, file: File) {
	return `${sourceKey}:${file.name}:${file.size}:${file.lastModified}`;
}

export default function ImportWizard() {
	const { t, i18n } = useTranslation();
	const [projects, setProjects] = useState<Project[]>([]);
	const [projectsBusy, setProjectsBusy] = useState(true);
	const [projectId, setProjectId] = useState("");
	const [members, setMembers] = useState<ImportMember[]>([]);
	const [membersBusy, setMembersBusy] = useState(false);
	const [source, setSource] = useState<ImportSource>("csv");
	const [sourceFile, setSourceFile] = useState<File | null>(null);
	const [fingerprint, setFingerprint] = useState("");
	const [table, setTable] = useState<CsvTable | null>(null);
	const [mapping, setMapping] = useState<ImportMapping>({});
	const [supportFiles, setSupportFiles] = useState<File[]>([]);
	const [allowMissing, setAllowMissing] = useState(false);
	const [step, setStep] = useState(1);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [importId, setImportId] = useState(() => crypto.randomUUID());
	const [execution, setExecution] = useState<ExecuteResult | null>(null);
	const [uploadFailures, setUploadFailures] = useState<string[]>([]);
	const [uploadedKeys, setUploadedKeys] = useState<Set<string>>(() => new Set());
	const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
	const [history, setHistory] = useState<Batch[]>([]);
	const [historyBusy, setHistoryBusy] = useState(false);
	const [rollbackId, setRollbackId] = useState<string | null>(null);
	const [rollbackName, setRollbackName] = useState("");
	const sourceInputRef = useRef<HTMLInputElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const mountedRef = useRef(false);

	const importableProjects = projects;
	const selectedProject = importableProjects.find((project) => project.id === projectId);
	const normalized = useMemo(
		() => (table ? normalizeImportRows(table, mapping, members, source) : null),
		[table, mapping, members, source],
	);
	const attachments = useMemo(
		() => matchSupportingFiles(normalized?.items ?? [], supportFiles),
		[normalized, supportFiles],
	);
	const invalidSupportFiles = useMemo(
		() => [
			...new Set(
				[...attachments.bySourceKey.values()]
					.flat()
					.filter((file) => file.size <= 0 || file.size > ATTACHMENT_MAX_BYTES)
					.map((file) => file.name),
			),
		],
		[attachments],
	);
	const hasNameMapping = Boolean(mapping.name);
	const canCheck = Boolean(
		projectId && sourceFile && fingerprint && normalized && normalized.items.length > 0 && hasNameMapping && normalized.errors.length === 0 && !membersBusy,
	);
	const canExecute = Boolean(
		preview?.valid &&
			canCheck &&
			invalidSupportFiles.length === 0 &&
			(attachments.missing.length === 0 || allowMissing),
	);

	const command = useMemo(
		() =>
			sourceFile && fingerprint && normalized
				? {
						importId,
						projectId,
						source,
						sourceName: sourceFile.name,
						sourceFingerprint: fingerprint,
						items: normalized.items,
					}
				: null,
		[sourceFile, fingerprint, normalized, importId, projectId, source],
	);

	const errorText = (code: string) =>
		t(`importWizard.errors.${code}`, { defaultValue: t("importWizard.errors.generic") });

	useEffect(() => {
		if (!mountedRef.current) {
			mountedRef.current = true;
			return;
		}
		if (step >= 1) contentRef.current?.focus();
	}, [step]);

	useEffect(() => {
		let cancelled = false;
		void request<{ projects: Project[] }>("/api/imports/projects")
			.then((body) => {
				if (cancelled) return;
				setProjects(body.projects);
				const first = body.projects[0];
				if (first) setProjectId((current) => current || first.id);
			})
			.catch((reason: unknown) => {
				if (!cancelled) {
					const code = reason instanceof ImportRequestError ? reason.code : "generic";
					setError(t(`importWizard.errors.${code}`, { defaultValue: t("importWizard.errors.generic") }));
				}
			})
			.finally(() => {
				if (!cancelled) setProjectsBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [t]);

	useEffect(() => {
		if (!projectId) {
			setMembers([]);
			setHistory([]);
			return;
		}
		let cancelled = false;
		setMembersBusy(true);
		void request<{ members: ImportMember[] }>(`/api/projects/${projectId}/members`)
			.then((body) => {
				if (!cancelled) setMembers(body.members);
			})
			.catch(() => {
				if (!cancelled) setError(t("importWizard.errors.members"));
			})
			.finally(() => {
				if (!cancelled) setMembersBusy(false);
			});
		setHistoryBusy(true);
		void request<{ imports: Batch[] }>(`/api/projects/${projectId}/imports`)
			.then((body) => {
				if (!cancelled) setHistory(body.imports);
			})
			.catch(() => {
				if (!cancelled) setError(t("importWizard.errors.history"));
			})
			.finally(() => {
				if (!cancelled) setHistoryBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, t]);

	async function loadHistory(id = projectId) {
		if (!id) return;
		setHistoryBusy(true);
		try {
			const body = await request<{ imports: Batch[] }>(`/api/projects/${id}/imports`);
			setHistory(body.imports);
		} catch {
			setError(t("importWizard.errors.history"));
		} finally {
			setHistoryBusy(false);
		}
	}

	function resetValidation() {
		setPreview(null);
		setExecution(null);
		setUploadFailures([]);
		setUploadedKeys(new Set());
		setUploadProgress({ done: 0, total: 0 });
		setError(null);
	}

	async function chooseSourceFile(file?: File) {
		if (!file) return;
		resetValidation();
		setBusy(true);
		try {
			if (file.size <= 0) throw new Error("csv_empty");
			if (file.size > MAX_SOURCE_BYTES) throw new Error("csv_too_large");
			const nextTable = parseDelimitedText(await file.text());
			setSourceFile(file);
			setFingerprint(await sha256File(file));
			setTable(nextTable);
			setMapping(suggestMapping(source, nextTable.headers));
			setImportId(crypto.randomUUID());
			setStep(2);
		} catch (reason) {
			const code = reason instanceof Error ? reason.message : "generic";
			setError(errorText(code));
			setSourceFile(null);
			setFingerprint("");
			setTable(null);
		} finally {
			setBusy(false);
		}
	}

	function changeSource(next: ImportSource) {
		setSource(next);
		if (table) setMapping(suggestMapping(next, table.headers));
		resetValidation();
	}

	function changeMapping(field: ImportField, header: string) {
		setMapping((current) => ({ ...current, [field]: header || undefined }));
		resetValidation();
	}

	async function runPreview() {
		setStep(3);
		setError(null);
		setPreview(null);
		if (!command || !canCheck) return;
		setBusy(true);
		try {
			setPreview(
				await request<Preview>("/api/imports/preview", {
					method: "POST",
					body: JSON.stringify(command),
				}),
			);
		} catch (reason) {
			setError(errorText(reason instanceof ImportRequestError ? reason.code : "generic"));
		} finally {
			setBusy(false);
		}
	}

	async function uploadAttachments(result: ExecuteResult) {
		const itemBySource = new Map(result.items.map((item) => [item.sourceKey, item]));
		const succeeded = new Set(uploadedKeys);
		const failures: string[] = [];
		const pendingFiles = (normalized?.items ?? []).flatMap((item) =>
			(attachments.bySourceKey.get(item.sourceKey) ?? []).flatMap((file) =>
				succeeded.has(fileKey(item.sourceKey, file)) ? [] : [{ sourceKey: item.sourceKey, file }],
			),
		);
		setUploadProgress({ done: 0, total: pendingFiles.length });
		let processed = 0;
		for (const item of normalized?.items ?? []) {
			const mappingItem = itemBySource.get(item.sourceKey);
			if (!mappingItem) continue;
			for (const file of attachments.bySourceKey.get(item.sourceKey) ?? []) {
				const key = fileKey(item.sourceKey, file);
				if (succeeded.has(key)) continue;
				let stageId: string | null = null;
				let attachmentId: string | null = null;
				try {
					const staged = await stageAttachment(mappingItem.taskId, projectId, file);
					stageId = staged.stageId;
					attachmentId = await finalizeAttachment(stageId);
					await request(`/api/imports/${result.batch.id}/register-attachment`, {
						method: "POST",
						body: JSON.stringify({ itemId: mappingItem.id, attachmentId }),
					});
					succeeded.add(key);
				} catch {
					failures.push(file.name);
					if (attachmentId) await deleteAttachment(attachmentId).catch(() => undefined);
					else if (stageId) await cancelAttachmentStage(stageId).catch(() => undefined);
				}
				processed += 1;
				setUploadProgress({ done: processed, total: pendingFiles.length });
			}
		}
		setUploadedKeys(succeeded);
		setUploadFailures(failures);
		return failures;
	}

	async function executeImport() {
		if (!command || !canExecute) return;
		setBusy(true);
		setError(null);
		try {
			const result = await request<ExecuteResult>("/api/imports/execute", {
				method: "POST",
				body: JSON.stringify(command),
			});
			setExecution(result);
			setStep(4);
			const failures = await uploadAttachments(result);
			if (failures.length > 0) setError(t("importWizard.errors.attachments"));
			await loadHistory();
		} catch (reason) {
			setError(errorText(reason instanceof ImportRequestError ? reason.code : "generic"));
		} finally {
			setBusy(false);
		}
	}

	async function retryAttachments() {
		if (!execution) return;
		setBusy(true);
		setError(null);
		try {
			const failures = await uploadAttachments(execution);
			if (failures.length > 0) setError(t("importWizard.errors.attachments"));
			await loadHistory();
		} finally {
			setBusy(false);
		}
	}

	async function rollback(batch: Batch) {
		if (rollbackName !== batch.sourceName || busy) return;
		setBusy(true);
		setError(null);
		try {
			await request(`/api/imports/${batch.id}/rollback`, {
				method: "POST",
				body: JSON.stringify({ confirmSourceName: rollbackName, expectedUpdatedAt: batch.updatedAt }),
			});
			setRollbackId(null);
			setRollbackName("");
			if (execution?.batch.id === batch.id) startAnother();
			await loadHistory();
		} catch (reason) {
			setError(errorText(reason instanceof ImportRequestError ? reason.code : "generic"));
		} finally {
			setBusy(false);
		}
	}

	function startAnother() {
		setSourceFile(null);
		setFingerprint("");
		setTable(null);
		setMapping({});
		setSupportFiles([]);
		setAllowMissing(false);
		setImportId(crypto.randomUUID());
		resetValidation();
		setStep(1);
		sourceInputRef.current?.focus();
	}

	const issueText = (issue: { row?: number; sourceKey?: string; field: string; code: string; value?: string }) => {
		const location = issue.row ? t("importWizard.issueRow", { row: issue.row }) : issue.sourceKey;
		return `${location} · ${t(`importWizard.fields.${issue.field}`, { defaultValue: issue.field })}: ${t(`importWizard.issue.${issue.code}`, { defaultValue: issue.code })}${issue.value ? ` (${issue.value})` : ""}`;
	};

	return (
		<section aria-labelledby="import-wizard-title" aria-busy={busy} style={CARD}>
			<div style={{ padding: "17px 16px 14px", borderBottom: "1px solid var(--w-line)" }}>
				<div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
					<div style={{ minWidth: 0 }}>
						<h3 id="import-wizard-title" className="font-display" style={{ margin: 0, fontSize: 14, color: "var(--w-ink)" }}>
							{t("importWizard.title")}
						</h3>
						<p style={{ ...MUTED, margin: "4px 0 0", maxWidth: 720 }}>{t("importWizard.desc")}</p>
					</div>
					<span style={{ ...MUTED, whiteSpace: "nowrap" }}>{t("importWizard.privateNote")}</span>
				</div>
				<ol aria-label={t("importWizard.progress")} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", listStyle: "none", padding: 0, margin: "16px 0 0", gap: 6 }}>
					{[1, 2, 3, 4].map((number) => (
						<li key={number} aria-current={step === number ? "step" : undefined} style={{ minWidth: 0 }}>
							<div style={{ height: 3, borderRadius: 99, background: number <= step ? "var(--w-brass)" : "var(--w-line)" }} />
							<span className="font-display" style={{ display: "block", marginTop: 5, fontSize: 10.5, color: number === step ? "var(--w-ink)" : "var(--w-ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{t(`importWizard.step${number}`)}
							</span>
						</li>
					))}
				</ol>
			</div>

			<div ref={contentRef} tabIndex={-1} style={{ padding: 16, outline: "none" }}>
				{error && <div role="alert" style={{ padding: "10px 12px", marginBottom: 14, borderRadius: 9, border: "1px solid color-mix(in srgb, var(--w-red) 45%, var(--w-line))", color: "var(--w-red)", background: "color-mix(in srgb, var(--w-red) 7%, transparent)", fontSize: 12.5 }}>{error}</div>}
				<div aria-live="polite" className="sr-only">{busy ? t("importWizard.working") : ""}</div>

				{step === 1 && (
					<div className="grid gap-3 md:grid-cols-2">
						<label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 650, color: "var(--w-ink-2)" }}>
							{t("importWizard.source")}
							<select value={source} onChange={(event) => changeSource(event.target.value as ImportSource)} style={FIELD}>
								{(["csv", "asana", "trello", "todoist"] as const).map((value) => <option key={value} value={value}>{t(`importWizard.sources.${value}`)}</option>)}
							</select>
						</label>
						<label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 650, color: "var(--w-ink-2)" }}>
							{t("importWizard.targetProject")}
							<select disabled={projectsBusy || importableProjects.length === 0} value={projectId} onChange={(event) => { setProjectId(event.target.value); resetValidation(); }} style={{ ...FIELD, ...disabledStyle(projectsBusy || importableProjects.length === 0) }}>
								{importableProjects.length === 0 && <option value="">{projectsBusy ? t("common.loading") : t("importWizard.noProjects")}</option>}
								{importableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
							</select>
						</label>
						<label className="md:col-span-2" style={{ display: "grid", gap: 7, padding: 16, minHeight: 112, border: "1px dashed var(--w-line)", borderRadius: 11, background: "var(--w-panel-2)", cursor: "pointer" }}>
							<span className="font-display" style={{ fontWeight: 700, fontSize: 13, color: "var(--w-ink)" }}>{t("importWizard.chooseCsv")}</span>
							<span style={MUTED}>{t("importWizard.chooseCsvHint")}</span>
							<input ref={sourceInputRef} type="file" accept=".csv,text/csv,text/plain" disabled={busy || !projectId} onChange={(event) => void chooseSourceFile(event.target.files?.[0])} style={{ fontSize: 12, color: "var(--w-ink-2)" }} />
						</label>
					</div>
				)}

				{step === 2 && table && (
					<div>
						<div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", marginBottom: 14 }}>
							<div><strong style={{ color: "var(--w-ink)", fontSize: 13 }}>{sourceFile?.name}</strong><div style={MUTED}>{t("importWizard.detected", { rows: table.rows.length, columns: table.headers.length })}</div></div>
							<button type="button" onClick={() => setStep(1)} style={GHOST}>{t("importWizard.changeFile")}</button>
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							{IMPORT_FIELDS.map((field) => (
								<label key={field} style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 650, color: "var(--w-ink-2)" }}>
									<span>{t(`importWizard.fields.${field}`)}{field === "name" ? " *" : ""}</span>
									<select value={mapping[field] ?? ""} onChange={(event) => changeMapping(field, event.target.value)} style={FIELD}>
										<option value="">{t("importWizard.doNotImport")}</option>
										{table.headers.map((header) => <option key={header} value={header}>{header}</option>)}
									</select>
								</label>
							))}
						</div>
						{normalized && (normalized.errors.length > 0 || normalized.warnings.length > 0) && <IssueList errors={normalized.errors.map(issueText)} warnings={normalized.warnings.map(issueText)} />}
						<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
							<button type="button" onClick={() => setStep(1)} style={GHOST}>{t("common.cancel")}</button>
							<button type="button" disabled={!canCheck || busy} onClick={() => void runPreview()} style={{ ...PRIMARY, ...disabledStyle(!canCheck || busy) }}>{busy ? t("importWizard.checking") : t("importWizard.preview")}</button>
						</div>
					</div>
				)}

				{step === 3 && normalized && (
					<div>
						<div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
							{(["items", "completed", "sections", "labels", "assignees", "attachments"] as const).map((key) => <Metric key={key} value={preview?.summary[key] ?? (key === "items" ? normalized.items.length : 0)} label={t(`importWizard.metrics.${key}`)} />)}
						</div>
						{preview && !preview.valid && <IssueList errors={preview.errors.map(issueText)} warnings={[]} />}
						{normalized.warnings.length > 0 && <IssueList errors={[]} warnings={normalized.warnings.map(issueText)} />}
						<div style={{ marginTop: 15, padding: 14, borderRadius: 10, background: "var(--w-panel-2)", border: "1px solid var(--w-line)" }}>
							<strong style={{ display: "block", fontSize: 13, color: "var(--w-ink)" }}>{t("importWizard.supportingFiles")}</strong>
							<p style={{ ...MUTED, margin: "4px 0 10px" }}>{t("importWizard.supportingFilesHint")}</p>
							<input type="file" multiple onChange={(event) => { setSupportFiles(Array.from(event.target.files ?? [])); setAllowMissing(false); }} aria-label={t("importWizard.supportingFiles")} style={{ maxWidth: "100%", fontSize: 12, color: "var(--w-ink-2)" }} />
							<div style={{ ...MUTED, marginTop: 8 }}>{t("importWizard.fileMatch", { matched: supportFiles.length - attachments.unused.length, missing: attachments.missing.length, unused: attachments.unused.length })}</div>
							{invalidSupportFiles.length > 0 && <IssueList errors={invalidSupportFiles.map((name) => t("importWizard.fileInvalid", { name }))} warnings={[]} />}
							{attachments.missing.length > 0 && <label style={{ display: "flex", gap: 9, alignItems: "start", marginTop: 10, fontSize: 12, color: "var(--w-ink-2)" }}><input type="checkbox" checked={allowMissing} onChange={(event) => setAllowMissing(event.target.checked)} style={{ width: 18, height: 18, flex: "none" }} /><span>{t("importWizard.allowMissing", { count: attachments.missing.length })}</span></label>}
						</div>
						<div style={{ marginTop: 14, padding: 12, borderLeft: "3px solid var(--w-brass)", background: "var(--w-brass-soft)", borderRadius: 8, fontSize: 12, lineHeight: 1.55, color: "var(--w-ink-2)" }}>{t("importWizard.atomicNote", { project: selectedProject?.name ?? "" })}</div>
						<div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
							<button type="button" onClick={() => setStep(2)} style={GHOST}>{t("importWizard.backMapping")}</button>
							<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
								<button type="button" disabled={!canCheck || busy} onClick={() => void runPreview()} style={{ ...GHOST, ...disabledStyle(!canCheck || busy) }}>{t("importWizard.recheck")}</button>
								<button type="button" disabled={!canExecute || busy} onClick={() => void executeImport()} style={{ ...PRIMARY, ...disabledStyle(!canExecute || busy) }}>{busy ? t("importWizard.importing") : t("importWizard.execute", { count: normalized.items.length })}</button>
							</div>
						</div>
					</div>
				)}

				{step === 4 && execution && (
					<div>
						{busy && uploadProgress.total > 0 && <div style={{ marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, ...MUTED }}><span>{t("importWizard.uploadingFiles")}</span><span>{uploadProgress.done} / {uploadProgress.total}</span></div><progress value={uploadProgress.done} max={uploadProgress.total} style={{ width: "100%", height: 8, accentColor: "var(--w-brass)" }} /></div>}
						<div role="status" style={{ padding: 18, borderRadius: 11, background: "color-mix(in srgb, var(--w-green) 9%, var(--w-panel-2))", border: "1px solid color-mix(in srgb, var(--w-green) 35%, var(--w-line))" }}>
							<strong className="font-display" style={{ display: "block", color: "var(--w-ink)", fontSize: 15 }}>{uploadFailures.length === 0 ? t("importWizard.successTitle") : t("importWizard.partialTitle")}</strong>
							<p style={{ ...MUTED, margin: "4px 0 0" }}>{t("importWizard.successDesc", { count: execution.batch.itemCount, uploaded: uploadedKeys.size, expected: execution.batch.attachmentExpected })}</p>
						</div>
						{uploadFailures.length > 0 && <div style={{ marginTop: 12 }}><IssueList errors={uploadFailures.map((name) => t("importWizard.fileFailed", { name }))} warnings={[]} /><button type="button" disabled={busy} onClick={() => void retryAttachments()} style={{ ...PRIMARY, ...disabledStyle(busy) }}>{t("importWizard.retryFiles")}</button></div>}
						<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button type="button" onClick={startAnother} style={PRIMARY}>{t("importWizard.another")}</button></div>
					</div>
				)}
			</div>

			<div style={{ borderTop: "1px solid var(--w-line)", padding: 16 }}>
				<div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}><strong className="font-display" style={{ color: "var(--w-ink)", fontSize: 13 }}>{t("importWizard.history")}</strong>{historyBusy && <span style={MUTED}>{t("common.loading")}</span>}</div>
				{!projectId || history.length === 0 ? <p style={{ ...MUTED, margin: 0 }}>{t("importWizard.historyEmpty")}</p> : <div style={{ display: "grid", gap: 8 }}>
					{history.slice(0, 8).map((batch) => {
						const active = batch.status === "imported";
						return <div key={batch.id} style={{ padding: 11, borderRadius: 9, border: "1px solid var(--w-line)", background: "var(--w-panel-2)" }}>
							<div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
								<div style={{ minWidth: 0 }}><strong style={{ display: "block", color: "var(--w-ink)", fontSize: 12.5, overflowWrap: "anywhere" }}>{batch.sourceName}</strong><span style={MUTED}>{t(active ? "importWizard.historyImported" : "importWizard.historyRolledBack", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(batch.rolledBackAt ?? batch.importedAt)), count: batch.itemCount, files: batch.attachmentRegistered })}</span></div>
								{active && <button type="button" onClick={() => { setRollbackId((current) => current === batch.id ? null : batch.id); setRollbackName(""); }} style={{ ...GHOST, minHeight: 40, color: "var(--w-red)" }}>{t("importWizard.rollback")}</button>}
							</div>
							{rollbackId === batch.id && <div style={{ display: "grid", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--w-line)" }}><label style={{ fontSize: 12, color: "var(--w-ink-2)" }}>{t("importWizard.rollbackConfirm", { name: batch.sourceName })}<input value={rollbackName} onChange={(event) => setRollbackName(event.target.value)} autoComplete="off" style={{ ...FIELD, marginTop: 6 }} /></label><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={() => setRollbackId(null)} style={GHOST}>{t("common.cancel")}</button><button type="button" disabled={rollbackName !== batch.sourceName || busy} onClick={() => void rollback(batch)} style={{ ...PRIMARY, color: "var(--w-red)", ...disabledStyle(rollbackName !== batch.sourceName || busy) }}>{t("importWizard.rollbackAction")}</button></div></div>}
						</div>;
					})}
				</div>}
			</div>
		</section>
	);
}

function Metric({ value, label }: { value: number; label: string }) {
	return <div style={{ padding: "10px 11px", borderRadius: 9, background: "var(--w-panel-2)", border: "1px solid var(--w-line)" }}><strong className="font-display" style={{ display: "block", fontSize: 17, color: "var(--w-ink)" }}>{value}</strong><span style={{ color: "var(--w-ink-3)", fontSize: 10.5 }}>{label}</span></div>;
}

function IssueList({ errors, warnings }: { errors: string[]; warnings: string[] }) {
	const { t } = useTranslation();
	if (errors.length === 0 && warnings.length === 0) return null;
	return <div style={{ margin: "12px 0", display: "grid", gap: 6 }}>
		{errors.length > 0 && <details open><summary style={{ cursor: "pointer", color: "var(--w-red)", fontSize: 12, fontWeight: 700 }}>{t("importWizard.errorCount", { count: errors.length })}</summary><ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "var(--w-red)", fontSize: 11.5, lineHeight: 1.5 }}>{[...new Set(errors)].slice(0, 20).map((item) => <li key={item}>{item}</li>)}</ul></details>}
		{warnings.length > 0 && <details><summary style={{ cursor: "pointer", color: "var(--w-ink-2)", fontSize: 12, fontWeight: 700 }}>{t("importWizard.warningCount", { count: warnings.length })}</summary><ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "var(--w-ink-3)", fontSize: 11.5, lineHeight: 1.5 }}>{[...new Set(warnings)].slice(0, 20).map((item) => <li key={item}>{item}</li>)}</ul></details>}
	</div>;
}
