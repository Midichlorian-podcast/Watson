import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import {
	type ChangeEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	EMPLOYEE_FILE_MAX_BYTES,
	type EmployeeContract,
	EmployeeFileError,
	type PublishedEmployeeDocument,
	publishedEmployeeDocumentUrl,
	signEmployeeContract,
	uploadEmployeeDocument,
	uploadEmployeeExpense,
	useEmployeeContracts,
	useEmployeeDocuments,
	useEmployeeExpenses,
} from "../lib/employeeFiles";
import { useEmployeeProfile } from "../lib/employeeSelfService";
import { showToast } from "../lib/toast";

const card = "rounded-2xl border border-line bg-card";
const input =
	"min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 font-body text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/15 disabled:cursor-not-allowed disabled:opacity-60";
const primary =
	"min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
	"min-h-11 rounded-lg border border-line bg-card px-4 font-display text-xs font-bold text-ink-2 transition hover:border-brass disabled:cursor-not-allowed disabled:opacity-50";
const supportedFiles =
	".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.txt,.csv,.xml,.doc,.docx,.xlsx";

function currentDay() {
	const date = new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sizeLabel(bytes: number | null) {
	if (bytes == null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
	const { t } = useTranslation();
	const positive = [
		"approved",
		"verified",
		"accepted",
		"completed",
		"reimbursed",
		"signed",
		"active",
	].includes(status);
	const negative = ["needs_changes", "rejected", "blocked", "failed"].includes(status);
	return (
		<span
			className={`rounded-full px-2.5 py-1 font-display text-[10px] font-bold ${
				positive
					? "bg-success-soft text-success-ink"
					: negative
						? "bg-overdue-soft text-overdue"
						: "bg-panel-2 text-ink-2"
			}`}
		>
			{t(`employee.files.status.${status}`, {
				defaultValue: status.replaceAll("_", " "),
			})}
		</span>
	);
}

function Loading({ label }: { label: string }) {
	return (
		<div
			className="rounded-xl border border-dashed border-line bg-panel-2 px-4 py-6 text-center font-body text-xs text-ink-3"
			role="status"
		>
			{label}
		</div>
	);
}

function LoadError({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslation();
	return (
		<div className="rounded-xl border border-overdue/20 bg-overdue-soft px-4 py-4" role="alert">
			<p className="font-body text-xs leading-relaxed text-overdue">
				{t("employee.files.loadFailed")}
			</p>
			<button type="button" className={`${secondary} mt-3`} onClick={onRetry}>
				{t("common.retry")}
			</button>
		</div>
	);
}

function useStableOperationId() {
	const state = useRef<{ fingerprint: string; id: string } | null>(null);
	return {
		forFingerprint(fingerprint: string) {
			if (state.current?.fingerprint === fingerprint) return state.current.id;
			const id = crypto.randomUUID();
			state.current = { fingerprint, id };
			return id;
		},
		clear() {
			state.current = null;
		},
	};
}

function mutationMessage(error: unknown) {
	if (!(error instanceof EmployeeFileError)) return "failed";
	const exact = new Set([
		"contract_finalization_failed",
		"employee_file_too_large",
		"employee_file_type_not_allowed",
		"file_malware_detected",
		"file_scan_unavailable",
		"file_storage_unavailable",
		"signature_challenge_failed",
	]);
	if (exact.has(error.code)) return error.code;
	if (error.status === 409) return "conflict";
	if (error.status === 423) return "revoked";
	return "failed";
}

function fileFingerprint(file: File | null) {
	return file ? `${file.name}:${file.size}:${file.lastModified}:${file.type}` : "missing";
}

function FileField({
	label,
	file,
	inputRef,
	className = "",
	onChange,
}: {
	label: string;
	file: File | null;
	inputRef: RefObject<HTMLInputElement | null>;
	className?: string;
	onChange: (file: File | null) => void;
}) {
	const { t } = useTranslation();
	return (
		<label className={`cursor-pointer font-display text-xs font-bold text-ink-2 ${className}`}>
			{label}
			<input
				ref={inputRef}
				type="file"
				accept={supportedFiles}
				className="peer sr-only"
				aria-label={label}
				onChange={(event) => onChange(event.target.files?.[0] ?? null)}
			/>
			<span
				className={`${input} mt-1.5 flex items-center gap-3 overflow-hidden p-0 pr-3 peer-focus-visible:border-brass peer-focus-visible:ring-2 peer-focus-visible:ring-brass/20`}
				aria-hidden="true"
			>
				<span className="flex min-h-11 shrink-0 items-center border-line border-r bg-card px-3 text-brass-text">
					{t("employee.files.chooseFile")}
				</span>
				<span className="min-w-0 truncate font-body font-normal text-ink-3">
					{file?.name ?? t("employee.files.noFileSelected")}
				</span>
			</span>
		</label>
	);
}

function DocumentsPanel() {
	const { t } = useTranslation();
	const query = useEmployeeDocuments(true);
	const [file, setFile] = useState<File | null>(null);
	const [type, setType] = useState("other");
	const [note, setNote] = useState("");
	const [validFrom, setValidFrom] = useState("");
	const [validUntil, setValidUntil] = useState("");
	const [saving, setSaving] = useState(false);
	const fileInput = useRef<HTMLInputElement | null>(null);
	const operation = useStableOperationId();

	const submit = async () => {
		if (!file || saving) return;
		if (file.size < 1 || file.size > EMPLOYEE_FILE_MAX_BYTES) {
			showToast(t("employee.files.error.employee_file_too_large"));
			return;
		}
		if (validFrom && validUntil && validUntil < validFrom) {
			showToast(t("employee.files.documents.invalidValidity"));
			return;
		}
		const command = {
			file: fileFingerprint(file),
			type,
			note: note.trim() || null,
			validFrom: validFrom || null,
			validUntil: validUntil || null,
		};
		setSaving(true);
		try {
			await uploadEmployeeDocument({
				...command,
				file,
				operationId: operation.forFingerprint(JSON.stringify(command)),
			});
			operation.clear();
			setFile(null);
			setNote("");
			setValidFrom("");
			setValidUntil("");
			if (fileInput.current) fileInput.current.value = "";
			showToast(t("employee.files.documents.submitted"));
			void query.refetch();
		} catch (error) {
			showToast(t(`employee.files.error.${mutationMessage(error)}`));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			id="dokumenty"
			className={`${card} scroll-mt-24 p-5`}
			aria-labelledby="employee-documents-title"
		>
			<div className="flex flex-wrap items-start gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
					<Icon name="priloha" size={20} />
				</div>
				<div className="min-w-0 flex-1">
					<h2 id="employee-documents-title" className="font-display text-sm font-bold text-ink">
						{t("employee.files.documents.title")}
					</h2>
					<p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
						{t("employee.files.documents.description")}
					</p>
				</div>
			</div>

			<div className="mt-5 rounded-xl border border-line bg-panel-2 p-4">
				<h3 className="font-display text-xs font-bold text-ink">
					{t("employee.files.documents.uploadTitle")}
				</h3>
				<p className="mt-1 font-body text-[11px] leading-relaxed text-ink-3">
					{t("employee.files.uploadPrivacy", { max: 25 })}
				</p>
				<div className="mt-4 grid gap-3 md:grid-cols-2">
					<FileField
						label={t("employee.files.file")}
						file={file}
						inputRef={fileInput}
						onChange={setFile}
					/>
					<label className="font-display text-xs font-bold text-ink-2">
						{t("employee.files.documents.type")}
						<select
							className={`${input} mt-1.5`}
							value={type}
							onChange={(event) => setType(event.target.value)}
						>
							{[
								"other",
								"tax_declaration",
								"bank_account_confirmation",
								"timesheet_support",
								"employment_contract",
								"dpp_contract",
							].map((value) => (
								<option key={value} value={value}>
									{t(`employee.files.documentType.${value}`)}
								</option>
							))}
						</select>
					</label>
					<label className="font-display text-xs font-bold text-ink-2">
						{t("employee.files.validFrom")}
						<input
							type="date"
							className={`${input} mt-1.5`}
							value={validFrom}
							onChange={(event) => setValidFrom(event.target.value)}
						/>
					</label>
					<label className="font-display text-xs font-bold text-ink-2">
						{t("employee.files.validUntil")}
						<input
							type="date"
							className={`${input} mt-1.5`}
							value={validUntil}
							min={validFrom || undefined}
							onChange={(event) => setValidUntil(event.target.value)}
						/>
					</label>
					<label className="font-display text-xs font-bold text-ink-2 md:col-span-2">
						{t("employee.files.note")}
						<textarea
							className={`${input} mt-1.5 min-h-20 resize-y py-3`}
							maxLength={1000}
							value={note}
							onChange={(event) => setNote(event.target.value)}
						/>
					</label>
				</div>
				<button
					type="button"
					className={`${primary} mt-4`}
					onClick={() => void submit()}
					disabled={!file || saving}
				>
					{saving ? t("employee.files.uploading") : t("employee.files.documents.submit")}
				</button>
			</div>

			<div className="mt-5">
				{query.isLoading ? (
					<Loading label={t("employee.files.loading")} />
				) : query.isError || !query.data ? (
					<LoadError onRetry={() => void query.refetch()} />
				) : (
					<div className="grid gap-4 lg:grid-cols-2">
						<div>
							<h3 className="font-display text-xs font-bold text-ink">
								{t("employee.files.documents.mine")}
							</h3>
							{query.data.documents.length === 0 ? (
								<p className="mt-2 rounded-xl border border-dashed border-line px-3 py-5 text-center font-body text-xs text-ink-3">
									{t("employee.files.documents.empty")}
								</p>
							) : (
								<ul className="mt-2 space-y-2">
									{query.data.documents.map((document) => (
										<li
											key={document.id}
											className="rounded-xl border border-line bg-panel-2 px-3 py-3"
										>
											<div className="flex flex-wrap items-start justify-between gap-2">
												<div className="min-w-0">
													<p className="truncate font-display text-xs font-bold text-ink">
														{document.fileName}
													</p>
													<p className="mt-1 font-body text-[11px] text-ink-3">
														{t(`employee.files.documentType.${document.type}`, {
															defaultValue: document.type,
														})}{" "}
														· {sizeLabel(document.fileSizeBytes)}
													</p>
												</div>
												<StatusBadge status={document.reviewStatus} />
											</div>
											{document.reviewNote && (
												<p className="mt-2 font-body text-xs text-overdue">{document.reviewNote}</p>
											)}
										</li>
									))}
								</ul>
							)}
						</div>
						<div>
							<h3 className="font-display text-xs font-bold text-ink">
								{t("employee.files.documents.official")}
							</h3>
							{query.data.publishedDocuments.length === 0 ? (
								<p className="mt-2 rounded-xl border border-dashed border-line px-3 py-5 text-center font-body text-xs text-ink-3">
									{t("employee.files.documents.officialEmpty")}
								</p>
							) : (
								<ul className="mt-2 space-y-2">
									{query.data.publishedDocuments.map((document) => (
										<li
											key={document.id}
											className="rounded-xl border border-line bg-panel-2 px-3 py-3"
										>
											<p className="font-display text-xs font-bold text-ink">{document.title}</p>
											<p className="mt-1 font-body text-[11px] text-ink-3">
												{document.fileName} · {sizeLabel(document.sizeBytes)}
											</p>
											<div className="mt-3 flex flex-wrap gap-2">
												<a
													className={secondary}
													href={publishedEmployeeDocumentUrl(document.id)}
													target="_blank"
													rel="noreferrer"
												>
													{t("employee.files.documents.open")}
												</a>
												<a
													className={secondary}
													href={publishedEmployeeDocumentUrl(document.id, true)}
												>
													{t("employee.files.documents.download")}
												</a>
											</div>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}

function ExpensesPanel() {
	const { t } = useTranslation();
	const query = useEmployeeExpenses(true);
	const [file, setFile] = useState<File | null>(null);
	const [title, setTitle] = useState("");
	const [amount, setAmount] = useState("");
	const [currency, setCurrency] = useState("CZK");
	const [exchangeRate, setExchangeRate] = useState("");
	const [date, setDate] = useState(currentDay);
	const [paymentSource, setPaymentSource] = useState("personal_card");
	const [category, setCategory] = useState("transport");
	const [reimbursementSource, setReimbursementSource] = useState("accounting");
	const [trainerProjectId, setTrainerProjectId] = useState("");
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const fileInput = useRef<HTMLInputElement | null>(null);
	const operation = useStableOperationId();

	const submit = async () => {
		if (!file || saving || !title.trim() || !amount || !date) return;
		const numericAmount = Number(amount);
		const numericRate = currency === "CZK" ? 1 : Number(exchangeRate);
		if (
			!Number.isFinite(numericAmount) ||
			numericAmount <= 0 ||
			!Number.isFinite(numericRate) ||
			numericRate <= 0
		) {
			showToast(t("employee.files.expenses.invalid"));
			return;
		}
		if (reimbursementSource === "trainer_fund" && !trainerProjectId) {
			showToast(t("employee.files.expenses.projectRequired"));
			return;
		}
		const command = {
			file: fileFingerprint(file),
			title: title.trim(),
			amount,
			currency,
			exchangeRate: currency === "CZK" ? null : exchangeRate,
			date,
			paymentSource,
			category,
			note: note.trim() || null,
			reimbursementSource,
			trainerProjectId: reimbursementSource === "trainer_fund" ? trainerProjectId : null,
		};
		setSaving(true);
		try {
			await uploadEmployeeExpense({
				...command,
				file,
				operationId: operation.forFingerprint(JSON.stringify(command)),
			});
			operation.clear();
			setFile(null);
			setTitle("");
			setAmount("");
			setExchangeRate("");
			setNote("");
			setReimbursementSource("accounting");
			setTrainerProjectId("");
			if (fileInput.current) fileInput.current.value = "";
			showToast(t("employee.files.expenses.submitted"));
			void query.refetch();
		} catch (error) {
			showToast(t(`employee.files.error.${mutationMessage(error)}`));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			id="vydaje"
			className={`${card} scroll-mt-24 p-5`}
			aria-labelledby="employee-expenses-title"
		>
			<div className="flex flex-wrap items-start gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
					<Icon name="reporty" size={20} />
				</div>
				<div className="min-w-0 flex-1">
					<h2 id="employee-expenses-title" className="font-display text-sm font-bold text-ink">
						{t("employee.files.expenses.title")}
					</h2>
					<p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
						{t("employee.files.expenses.description")}
					</p>
				</div>
			</div>

			<div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
				<label className="font-display text-xs font-bold text-ink-2 lg:col-span-2">
					{t("employee.files.expenses.titleField")}
					<input
						className={`${input} mt-1.5`}
						maxLength={180}
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</label>
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.expenses.date")}
					<input
						type="date"
						className={`${input} mt-1.5`}
						max={currentDay()}
						value={date}
						onChange={(event) => setDate(event.target.value)}
					/>
				</label>
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.expenses.amount")}
					<input
						type="number"
						inputMode="decimal"
						min="0.01"
						step="0.01"
						className={`${input} mt-1.5`}
						value={amount}
						onChange={(event) => setAmount(event.target.value)}
					/>
				</label>
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.expenses.currency")}
					<select
						className={`${input} mt-1.5`}
						value={currency}
						onChange={(event) => {
							setCurrency(event.target.value);
							setExchangeRate("");
						}}
					>
						{["CZK", "EUR", "USD", "PLN"].map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</label>
				{currency !== "CZK" && (
					<label className="font-display text-xs font-bold text-ink-2">
						{t("employee.files.expenses.exchangeRate")}
						<input
							type="number"
							inputMode="decimal"
							min="0.0001"
							step="0.0001"
							className={`${input} mt-1.5`}
							value={exchangeRate}
							onChange={(event) => setExchangeRate(event.target.value)}
						/>
					</label>
				)}
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.expenses.paymentSource")}
					<select
						className={`${input} mt-1.5`}
						value={paymentSource}
						onChange={(event) => setPaymentSource(event.target.value)}
					>
						{["personal_card", "personal_cash", "studio_card", "studio_cash"].map((value) => (
							<option key={value} value={value}>
								{t(`employee.files.paymentSource.${value}`)}
							</option>
						))}
					</select>
				</label>
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.expenses.category")}
					<select
						className={`${input} mt-1.5`}
						value={category}
						onChange={(event) => setCategory(event.target.value)}
					>
						{[
							"transport",
							"costumes",
							"props",
							"refreshments",
							"entry_fees",
							"accommodation",
							"other_expense_claim",
						].map((value) => (
							<option key={value} value={value}>
								{t(`employee.files.expenseCategory.${value}`)}
							</option>
						))}
					</select>
				</label>
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.expenses.reimbursement")}
					<select
						className={`${input} mt-1.5`}
						value={reimbursementSource}
						onChange={(event) => {
							setReimbursementSource(event.target.value);
							setTrainerProjectId("");
						}}
					>
						{["accounting", "internal_cash", "trainer_fund"].map((value) => (
							<option key={value} value={value}>
								{t(`employee.files.reimbursement.${value}`)}
							</option>
						))}
					</select>
				</label>
				{reimbursementSource === "trainer_fund" && (
					<label className="font-display text-xs font-bold text-ink-2">
						{t("employee.files.expenses.trainerProject")}
						<select
							className={`${input} mt-1.5`}
							value={trainerProjectId}
							onChange={(event) => setTrainerProjectId(event.target.value)}
						>
							<option value="">{t("employee.files.expenses.selectProject")}</option>
							{(query.data?.trainerProjects ?? [])
								.filter((project) => project.status === "active")
								.map((project) => (
									<option key={project.id} value={project.id}>
										{project.name}
									</option>
								))}
						</select>
					</label>
				)}
				<FileField
					className="lg:col-span-2"
					label={t("employee.files.expenses.receipt")}
					file={file}
					inputRef={fileInput}
					onChange={setFile}
				/>
				<label className="font-display text-xs font-bold text-ink-2 lg:col-span-3">
					{t("employee.files.note")}
					<textarea
						className={`${input} mt-1.5 min-h-20 resize-y py-3`}
						maxLength={1000}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				</label>
			</div>
			<button
				type="button"
				className={`${primary} mt-4`}
				onClick={() => void submit()}
				disabled={!file || !title.trim() || !amount || saving}
			>
				{saving ? t("employee.files.uploading") : t("employee.files.expenses.submit")}
			</button>

			<div className="mt-5 border-line border-t pt-4">
				<h3 className="font-display text-xs font-bold text-ink">
					{t("employee.files.expenses.history")}
				</h3>
				{query.isLoading ? (
					<div className="mt-2">
						<Loading label={t("employee.files.loading")} />
					</div>
				) : query.isError || !query.data ? (
					<div className="mt-2">
						<LoadError onRetry={() => void query.refetch()} />
					</div>
				) : query.data.claims.length === 0 ? (
					<p className="mt-2 rounded-xl border border-dashed border-line px-3 py-5 text-center font-body text-xs text-ink-3">
						{t("employee.files.expenses.empty")}
					</p>
				) : (
					<ul className="mt-2 grid gap-2 md:grid-cols-2">
						{query.data.claims.map((claim) => (
							<li key={claim.id} className="rounded-xl border border-line bg-panel-2 px-3 py-3">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div>
										<p className="font-display text-xs font-bold text-ink">{claim.title}</p>
										<p className="mt-1 font-body text-[11px] text-ink-3">
											{claim.amount ?? "—"} {claim.currency ?? ""} · {claim.date ?? "—"}
										</p>
									</div>
									<StatusBadge status={claim.status} />
								</div>
								{claim.reviewerNote && (
									<p className="mt-2 font-body text-xs text-overdue">{claim.reviewerNote}</p>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

function SignaturePad({
	value,
	onChange,
}: {
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	const { t } = useTranslation();
	const canvas = useRef<HTMLCanvasElement | null>(null);
	const drawing = useRef(false);

	useEffect(() => {
		const element = canvas.current;
		const context = element?.getContext("2d");
		if (!element || !context) return;
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, element.width, element.height);
		context.strokeStyle = "#17283f";
		context.lineWidth = 5;
		context.lineCap = "round";
		context.lineJoin = "round";
		if (value) {
			const image = new Image();
			image.onload = () => context.drawImage(image, 0, 0, element.width, element.height);
			image.src = value;
		}
	}, [value]);

	const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const element = canvas.current;
		if (!element) return { x: 0, y: 0 };
		const rect = element.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left) * (element.width / rect.width),
			y: (event.clientY - rect.top) * (element.height / rect.height),
		};
	};

	const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const context = canvas.current?.getContext("2d");
		if (!context || !canvas.current) return;
		canvas.current.setPointerCapture(event.pointerId);
		drawing.current = true;
		const position = point(event);
		context.beginPath();
		context.moveTo(position.x, position.y);
	};

	const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!drawing.current) return;
		const context = canvas.current?.getContext("2d");
		if (!context) return;
		const position = point(event);
		context.lineTo(position.x, position.y);
		context.stroke();
	};

	const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (canvas.current?.hasPointerCapture(event.pointerId))
			canvas.current.releasePointerCapture(event.pointerId);
		if (!drawing.current || !canvas.current) return;
		drawing.current = false;
		onChange(canvas.current.toDataURL("image/png"));
	};

	const uploadImage = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1_400_000) {
			showToast(t("employee.files.contracts.signatureImageInvalid"));
			event.target.value = "";
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") onChange(reader.result);
		};
		reader.readAsDataURL(file);
	};

	return (
		<div className="rounded-xl border border-line bg-panel-2 p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<label className="min-h-11 cursor-pointer rounded-lg border border-line bg-card px-3 py-3 font-display text-xs font-bold text-ink-2 hover:border-brass">
					{t("employee.files.contracts.uploadSignature")}
					<input
						type="file"
						accept="image/png,image/jpeg"
						className="sr-only"
						onChange={uploadImage}
					/>
				</label>
				<button type="button" className={secondary} onClick={() => onChange(null)}>
					{t("employee.files.contracts.clearSignature")}
				</button>
			</div>
			<canvas
				ref={canvas}
				width={1200}
				height={320}
				className="mt-3 block h-40 w-full touch-none rounded-lg border border-dashed border-line bg-white"
				aria-label={t("employee.files.contracts.signatureCanvas")}
				aria-describedby="employee-signature-help"
				onPointerDown={pointerDown}
				onPointerMove={pointerMove}
				onPointerUp={pointerUp}
				onPointerCancel={pointerUp}
			/>
			<p
				id="employee-signature-help"
				className="mt-2 font-body text-[11px] leading-relaxed text-ink-3"
			>
				{t("employee.files.contracts.signatureHelp")}
			</p>
		</div>
	);
}

function ContractSignForm({
	contract,
	previewDocument,
	onDone,
	onCancel,
}: {
	contract: EmployeeContract;
	previewDocument: PublishedEmployeeDocument | null;
	onDone: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const profile = useEmployeeProfile(true);
	const [fullName, setFullName] = useState("");
	const [birthDate, setBirthDate] = useState("");
	const [bankSuffix, setBankSuffix] = useState("");
	const [signature, setSignature] = useState<string | null>(null);
	const [consent, setConsent] = useState(false);
	const [saving, setSaving] = useState(false);
	const operation = useStableOperationId();

	useEffect(() => {
		if (!fullName && profile.data?.profile.name) setFullName(profile.data.profile.name);
	}, [fullName, profile.data?.profile.name]);

	const submit = async () => {
		if (!fullName.trim() || !birthDate || !signature || !consent || saving) return;
		if (!window.confirm(t("employee.files.contracts.confirmSign", { title: contract.title })))
			return;
		const command = {
			contractId: contract.id,
			expectedVersion: contract.version,
			consent: true as const,
			fullName: fullName.trim(),
			birthDate,
			bankAccountSuffix: bankSuffix.trim() || null,
			signatureDataUrl: signature,
		};
		setSaving(true);
		try {
			await signEmployeeContract({
				...command,
				operationId: operation.forFingerprint(JSON.stringify(command)),
			});
			operation.clear();
			showToast(t("employee.files.contracts.signed"));
			onDone();
		} catch (error) {
			showToast(t(`employee.files.error.${mutationMessage(error)}`));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mt-3 rounded-xl border border-brass/30 bg-brass-soft/30 p-4">
			{previewDocument ? (
				<div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/20 bg-success-soft px-3 py-3">
					<p className="font-body text-xs leading-relaxed text-success-ink">
						{t("employee.files.contracts.previewReady", { version: contract.version })}
					</p>
					<a className={secondary} href={publishedEmployeeDocumentUrl(previewDocument.id)} target="_blank" rel="noreferrer">
						{t("employee.files.contracts.openPreview")}
					</a>
				</div>
			) : (
				<div className="mb-3 rounded-xl border border-overdue/20 bg-overdue-soft px-3 py-3" role="alert">
					<p className="font-body text-xs leading-relaxed text-overdue">
						{t("employee.files.contracts.previewUnavailable", { version: contract.version })}
					</p>
				</div>
			)}
			<p className="font-body text-xs leading-relaxed text-ink-2">
				{t("employee.files.contracts.challenge")}
			</p>
			<div className="mt-3 grid gap-3 md:grid-cols-2">
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.contracts.fullName")}
					<input
						className={`${input} mt-1.5`}
						maxLength={200}
						autoComplete="name"
						value={fullName}
						onChange={(event) => setFullName(event.target.value)}
					/>
				</label>
				<label className="font-display text-xs font-bold text-ink-2">
					{t("employee.files.contracts.birthDate")}
					<input
						type="date"
						className={`${input} mt-1.5`}
						autoComplete="bday"
						max={currentDay()}
						value={birthDate}
						onChange={(event) => setBirthDate(event.target.value)}
					/>
				</label>
				<label className="font-display text-xs font-bold text-ink-2 md:col-span-2">
					{t("employee.files.contracts.bankSuffix")}
					<input
						className={`${input} mt-1.5`}
						inputMode="numeric"
						pattern="[0-9]{4}"
						maxLength={4}
						value={bankSuffix}
						onChange={(event) => setBankSuffix(event.target.value)}
					/>
				</label>
			</div>
			<div className="mt-3">
				<SignaturePad value={signature} onChange={setSignature} />
			</div>
			<label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card px-3 py-3 font-body text-xs leading-relaxed text-ink-2">
				<input
					type="checkbox"
					className="mt-0.5 h-5 w-5 shrink-0 accent-brass"
					checked={consent}
					onChange={(event) => setConsent(event.target.checked)}
				/>
				<span>
					{t("employee.files.contracts.consent", {
						title: contract.title,
						version: contract.version,
					})}
				</span>
			</label>
			<div className="mt-4 flex flex-wrap gap-2">
				<button
					type="button"
					className={primary}
					onClick={() => void submit()}
					disabled={!fullName.trim() || !birthDate || !signature || !consent || saving}
				>
					{saving ? t("employee.files.contracts.signing") : t("employee.files.contracts.sign")}
				</button>
				<button type="button" className={secondary} onClick={onCancel} disabled={saving}>
					{t("common.cancel")}
				</button>
			</div>
		</div>
	);
}

function ContractsPanel() {
	const { t } = useTranslation();
	const query = useEmployeeContracts(true);
	const documents = useEmployeeDocuments(true);
	const [signingId, setSigningId] = useState<string | null>(null);
	return (
		<section
			id="smlouvy"
			className={`${card} scroll-mt-24 p-5`}
			aria-labelledby="employee-contracts-title"
		>
			<div className="flex flex-wrap items-start gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
					<Icon name="hotovo" size={20} />
				</div>
				<div className="min-w-0 flex-1">
					<h2 id="employee-contracts-title" className="font-display text-sm font-bold text-ink">
						{t("employee.files.contracts.title")}
					</h2>
					<p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
						{t("employee.files.contracts.description")}
					</p>
				</div>
			</div>
			<div className="mt-5">
				{query.isLoading ? (
					<Loading label={t("employee.files.loading")} />
				) : query.isError || !query.data ? (
					<LoadError onRetry={() => void query.refetch()} />
				) : query.data.contracts.length === 0 ? (
					<Loading label={t("employee.files.contracts.empty")} />
				) : (
					<ul className="space-y-3">
						{query.data.contracts.map((contract) => {
							const previewDocument =
								documents.data?.publishedDocuments.find(
									(document) =>
										document.fileName === contract.fileName &&
										document.version === contract.version,
								) ?? null;
							return (
								<li key={contract.id} className="rounded-xl border border-line bg-panel-2 px-4 py-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="font-display text-sm font-bold text-ink">{contract.title}</p>
										<p className="mt-1 font-body text-[11px] text-ink-3">
											{t("employee.files.contracts.version", {
												version: contract.version,
											})}
											{contract.validFrom ? ` · ${contract.validFrom}` : ""}
											{contract.validUntil ? ` – ${contract.validUntil}` : ""}
										</p>
									</div>
									<StatusBadge status={contract.workflowStatus} />
								</div>
								{contract.canSign && signingId !== contract.id && (
									<button
										type="button"
										className={`${primary} mt-3`}
										onClick={() => setSigningId(contract.id)}
									>
										{t("employee.files.contracts.openSign")}
									</button>
								)}
								{contract.signedDate && (
									<p className="mt-3 font-body text-xs text-success-ink">
										{t("employee.files.contracts.signedAt", {
											date: contract.signedDate,
										})}
									</p>
								)}
								{signingId === contract.id && (
									<ContractSignForm
										contract={contract}
										previewDocument={previewDocument}
										onCancel={() => setSigningId(null)}
										onDone={() => {
											setSigningId(null);
											void query.refetch();
										}}
									/>
								)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}

export function EmployeeFiles() {
	return (
		<>
			<DocumentsPanel />
			<ExpensesPanel />
			<ContractsPanel />
		</>
	);
}
