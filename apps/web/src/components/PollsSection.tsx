import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import {
	clearPollResponse,
	createPoll,
	deletePoll,
	POLL_RESPONSE_TYPES,
	PollApiError,
	type PollOption,
	type PollResponseType,
	parsePollOptions,
	parsePollValue,
	savePollResponse,
	setPollClosed,
	updatePoll,
} from "../lib/polls";
import type { TaskPollResponseRow, TaskPollRow } from "../lib/powersync/AppSchema";
import { showToast } from "../lib/toast";

type Member = { id: string; name: string };
type Poll = Omit<TaskPollRow, "response_type" | "options"> & {
	response_type: PollResponseType;
	options: PollOption[];
};
type Response = Omit<TaskPollResponseRow, "value"> & { value: unknown };

function errorMessage(error: unknown, t: (key: string) => string) {
	if (error instanceof PollApiError) {
		if (error.code === "poll_closed") return t("detail.pollErrorClosed");
		if (error.code === "poll_locked_after_response") return t("detail.pollErrorLocked");
		if (error.code === "poll_delete_owner_or_manager") return t("detail.pollErrorDeleteRole");
		if (error.code === "poll_confirmation_mismatch") return t("detail.pollErrorConfirm");
		if (error.code === "poll_response_invalid") return t("detail.pollErrorResponse");
		if (error.code === "poll_limit") return t("detail.pollErrorLimit");
	}
	return t("detail.pollErrorSave");
}

const labelsFromText = (text: string) =>
	text
		.split("\n")
		.map((label) => label.trim())
		.filter(Boolean);

function PollDefinitionEditor({
	initialQuestion = "",
	initialType = "single_choice",
	initialOptions = "",
	busy,
	onCancel,
	onSave,
}: {
	initialQuestion?: string;
	initialType?: PollResponseType;
	initialOptions?: string;
	busy: boolean;
	onCancel: () => void;
	onSave: (input: {
		question: string;
		responseType: PollResponseType;
		options?: string[];
	}) => Promise<void>;
}) {
	const { t } = useTranslation();
	const [question, setQuestion] = useState(initialQuestion);
	const [type, setType] = useState<PollResponseType>(initialType);
	const [optionText, setOptionText] = useState(initialOptions);
	const choice = type === "single_choice" || type === "multiple_choice";
	const save = async () => {
		const options = labelsFromText(optionText);
		if (!question.trim() || (choice && options.length < 2)) {
			showToast(t("detail.pollIncomplete"));
			return;
		}
		await onSave({
			question: question.trim(),
			responseType: type,
			...(choice ? { options } : {}),
		});
	};
	return (
		<div className="rounded-xl border border-brass bg-brass-soft p-3">
			<label className="block font-display font-semibold text-ink-2" style={{ fontSize: 11.5 }}>
				{t("detail.pollQuestion")}
				<input
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					maxLength={240}
					placeholder={t("detail.pollQuestionPlaceholder")}
					className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brass"
				/>
			</label>
			<label className="mt-2 block font-display font-semibold text-ink-2" style={{ fontSize: 11.5 }}>
				{t("detail.pollResponseType")}
				<select
					value={type}
					onChange={(event) => setType(event.target.value as PollResponseType)}
					className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brass"
				>
					{POLL_RESPONSE_TYPES.map((candidate) => (
						<option key={candidate} value={candidate}>
							{t(`detail.pollType_${candidate}`)}
						</option>
					))}
				</select>
			</label>
			{choice && (
				<label className="mt-2 block font-display font-semibold text-ink-2" style={{ fontSize: 11.5 }}>
					{t("detail.pollOptions")}
					<textarea
						value={optionText}
						onChange={(event) => setOptionText(event.target.value)}
						rows={4}
						placeholder={t("detail.pollOptionsPlaceholder")}
						className="mt-1 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brass"
					/>
					<span className="mt-1 block font-body font-normal text-ink-3" style={{ fontSize: 11 }}>
						{t("detail.pollOptionsHint")}
					</span>
				</label>
			)}
			<div className="mt-3 flex justify-end" style={{ gap: 7 }}>
				<button
					type="button"
					onClick={onCancel}
					className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-2 hover:bg-card"
				>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => void save()}
					className="min-h-11 rounded-lg bg-brass px-4 font-display font-bold text-white disabled:opacity-60"
				>
					{busy ? t("common.saving") : t("common.save")}
				</button>
			</div>
		</div>
	);
}

function PollResponseEditor({
	poll,
	current,
	disabled,
	busy,
	onSave,
	onClear,
}: {
	poll: Poll;
	current: Response | undefined;
	disabled: boolean;
	busy: boolean;
	onSave: (value: unknown) => Promise<void>;
	onClear: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<unknown>(current?.value ?? null);
	useEffect(() => setDraft(current?.value ?? null), [current?.value]);
	const commit = async (value: unknown) => {
		try {
			await onSave(value);
		} catch {
			setDraft(current?.value ?? null);
		}
	};
	const saveButton = (ready: boolean) => (
		<div className="mt-2 flex flex-wrap justify-end" style={{ gap: 7 }}>
			{current && (
				<button
					type="button"
					disabled={disabled || busy}
					onClick={() => void onClear()}
					className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-3 hover:bg-card disabled:opacity-60"
				>
					{t("detail.pollClearResponse")}
				</button>
			)}
			<button
				type="button"
				disabled={disabled || busy || !ready}
				onClick={() => void commit(draft)}
				className="min-h-11 rounded-lg bg-brass px-4 font-display font-bold text-white disabled:opacity-50"
			>
				{busy ? t("common.saving") : t("detail.pollSubmitResponse")}
			</button>
		</div>
	);

	if (poll.response_type === "single_choice") {
		return (
			<div className="space-y-1.5">
				{poll.options.map((option) => {
					const selected = draft === option.id;
					return (
						<button
							key={option.id}
							type="button"
							disabled={disabled || busy}
							aria-pressed={selected}
							onClick={() => {
								setDraft(option.id);
								void commit(option.id);
							}}
							className={`flex min-h-11 w-full items-center rounded-lg border px-3 text-left font-body ${selected ? "border-brass bg-brass-soft text-brass-text" : "border-line bg-card text-ink-2 hover:border-brass"}`}
							style={{ gap: 9, fontSize: 12.5 }}
						>
							<span
								aria-hidden
								className={`h-4 w-4 rounded-full border ${selected ? "border-[5px] border-brass" : "border-line"}`}
							/>
							{option.label}
						</button>
					);
				})}
				{current && (
					<div className="flex justify-end">
						<button
							type="button"
							disabled={disabled || busy}
							onClick={() => void onClear()}
							className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-3 hover:bg-card"
						>
							{t("detail.pollClearResponse")}
						</button>
					</div>
				)}
			</div>
		);
	}

	if (poll.response_type === "multiple_choice") {
		const selected = Array.isArray(draft) ? draft.filter((value): value is string => typeof value === "string") : [];
		return (
			<div>
				<div className="space-y-1.5">
					{poll.options.map((option) => {
						const checked = selected.includes(option.id);
						return (
							<button
								key={option.id}
								type="button"
								disabled={disabled || busy}
								aria-pressed={checked}
								onClick={() =>
									setDraft(
										checked
											? selected.filter((id) => id !== option.id)
											: [...selected, option.id],
									)
								}
								className={`flex min-h-11 w-full items-center rounded-lg border px-3 text-left font-body ${checked ? "border-brass bg-brass-soft text-brass-text" : "border-line bg-card text-ink-2 hover:border-brass"}`}
								style={{ gap: 9, fontSize: 12.5 }}
							>
								<span
									aria-hidden
									className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] border ${checked ? "border-brass bg-brass text-white" : "border-line"}`}
								>
									{checked ? "✓" : ""}
								</span>
								{option.label}
							</button>
						);
					})}
				</div>
				{saveButton(selected.length > 0)}
			</div>
		);
	}

	const value = draft == null ? "" : String(draft);
	return (
		<div>
			{poll.response_type === "text" ? (
				<textarea
					value={value}
					disabled={disabled || busy}
					maxLength={1000}
					rows={3}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={t("detail.pollResponsePlaceholder")}
					className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brass disabled:opacity-60"
				/>
			) : (
				<input
					type={poll.response_type === "number" ? "number" : "date"}
					step={poll.response_type === "number" ? "any" : undefined}
					value={value}
					disabled={disabled || busy}
					onChange={(event) =>
						setDraft(
							poll.response_type === "number"
								? event.target.value === ""
									? null
									: Number(event.target.value)
								: event.target.value,
						)
					}
					className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brass disabled:opacity-60"
				/>
			)}
			{saveButton(
				poll.response_type === "number"
					? typeof draft === "number" && Number.isFinite(draft)
					: value.trim().length > 0,
			)}
		</div>
	);
}

function responseLabel(poll: Poll, response: Response): string {
	if (poll.response_type === "single_choice")
		return poll.options.find((option) => option.id === response.value)?.label ?? "—";
	if (poll.response_type === "multiple_choice" && Array.isArray(response.value))
		return response.value
			.map((id) => poll.options.find((option) => option.id === id)?.label)
			.filter(Boolean)
			.join(", ");
	return response.value == null ? "—" : String(response.value);
}

function PollResults({ poll, responses, members }: { poll: Poll; responses: Response[]; members: Member[] }) {
	const { t } = useTranslation();
	const choice = poll.response_type === "single_choice" || poll.response_type === "multiple_choice";
	const counts = new Map<string, number>();
	for (const response of responses) {
		const values = Array.isArray(response.value) ? response.value : [response.value];
		for (const value of values) if (typeof value === "string") counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	const numbers = responses
		.map((response) => response.value)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	return (
		<div className="mt-3 border-line border-t pt-3">
			<div className="flex items-center justify-between" style={{ gap: 8 }}>
				<span className="font-display font-semibold text-ink-2" style={{ fontSize: 11.5 }}>
					{t("detail.pollResults")}
				</span>
				<span className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
					{t("detail.pollResponsesCount", { count: responses.length })}
				</span>
			</div>
			{responses.length === 0 ? (
				<p className="mt-2 font-body text-ink-3" style={{ fontSize: 11.5 }}>
					{t("detail.pollNoResponses")}
				</p>
			) : choice ? (
				<div className="mt-2 space-y-2">
					{poll.options.map((option) => {
						const count = counts.get(option.id) ?? 0;
						const percent = Math.round((count / responses.length) * 100);
						return (
							<div key={option.id}>
								<div className="mb-1 flex justify-between font-body text-ink-2" style={{ gap: 8, fontSize: 11.5 }}>
									<span className="min-w-0 truncate">{option.label}</span>
									<span className="shrink-0 font-mono text-ink-3">{count} · {percent}%</span>
								</div>
								<div
									role="progressbar"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={percent}
									aria-label={`${option.label}: ${percent}%`}
									className="h-1.5 overflow-hidden rounded-full bg-line"
								>
									<span className="block h-full rounded-full bg-brass" style={{ width: `${percent}%` }} />
								</div>
							</div>
						);
					})}
				</div>
			) : poll.response_type === "number" && numbers.length > 0 ? (
				<div className="mt-2 grid grid-cols-3 gap-2">
					{[
						[t("detail.pollAverage"), numbers.reduce((sum, value) => sum + value, 0) / numbers.length],
						[t("detail.pollMinimum"), Math.min(...numbers)],
						[t("detail.pollMaximum"), Math.max(...numbers)],
					].map(([label, value]) => (
						<div key={String(label)} className="rounded-lg bg-card px-2 py-2 text-center">
							<div className="font-mono text-ink" style={{ fontSize: 12 }}>{Number(value).toLocaleString()}</div>
							<div className="font-body text-ink-3" style={{ fontSize: 10.5 }}>{label}</div>
						</div>
					))}
				</div>
			) : null}
			{responses.length > 0 && (
				<details className="mt-2 rounded-lg bg-card px-3 py-2">
					<summary className="flex min-h-11 cursor-pointer items-center font-display font-semibold text-ink-2" style={{ fontSize: 11.5 }}>
						{t("detail.pollNamedResponses")}
					</summary>
					<ul className="space-y-1.5 pt-1">
						{responses.map((response) => (
							<li key={response.id} className="flex items-start justify-between font-body" style={{ gap: 10, fontSize: 11.5 }}>
								<span className="shrink-0 font-display font-semibold text-ink-2">
									{members.find((member) => member.id === response.respondent_id)?.name ?? t("detail.timelineUnknownUser")}
								</span>
								<span className="min-w-0 break-words text-right text-ink-3">{responseLabel(poll, response)}</span>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

export function PollsSection({
	taskId,
	members,
	currentUserId,
	canManage,
	isManager,
}: {
	taskId: string;
	members: Member[];
	currentUserId: string | null;
	canManage: boolean;
	isManager: boolean;
}) {
	const { t } = useTranslation();
	const { data: rawPolls } = usePsQuery<TaskPollRow>(
		"SELECT * FROM task_polls WHERE task_id = ? ORDER BY created_at, id",
		[taskId],
	);
	const { data: rawResponses } = usePsQuery<TaskPollResponseRow>(
		"SELECT * FROM task_poll_responses WHERE task_id = ? ORDER BY created_at, id",
		[taskId],
	);
	const polls = useMemo<Poll[]>(
		() =>
			(rawPolls ?? [])
				.filter((poll) => POLL_RESPONSE_TYPES.includes(poll.response_type as PollResponseType))
				.map((poll) => ({
					...poll,
					response_type: poll.response_type as PollResponseType,
					options: parsePollOptions(poll.options),
				})),
		[rawPolls],
	);
	const responses = useMemo<Response[]>(
		() => (rawResponses ?? []).map((response) => ({ ...response, value: parsePollValue(response.value) })),
		[rawResponses],
	);
	const [builderOpen, setBuilderOpen] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

	const run = async (key: string, action: () => Promise<void>, successKey: string) => {
		if (busyId) return;
		setBusyId(key);
		try {
			await action();
			showToast(t(successKey));
		} catch (error) {
			showToast(errorMessage(error, t));
			throw error;
		} finally {
			setBusyId(null);
		}
	};

	return (
		<section aria-labelledby={`polls-${taskId}`}>
			<div className="flex min-h-11 items-center justify-between" style={{ gap: 8, marginTop: 15 }}>
				<h3 id={`polls-${taskId}`} className="font-display font-bold text-ink-3 uppercase" style={{ fontSize: 11, letterSpacing: ".06em" }}>
					{t("detail.polls")} · {polls.length}
				</h3>
				{canManage && (
					<button
						type="button"
						aria-expanded={builderOpen}
						onClick={() => setBuilderOpen((open) => !open)}
						className="min-h-11 rounded-lg px-3 font-display font-semibold text-brass-text hover:bg-panel-2"
						style={{ fontSize: 11.5 }}
					>
						{builderOpen ? t("common.cancel") : `+ ${t("detail.pollAdd")}`}
					</button>
				)}
			</div>
			{builderOpen && (
				<PollDefinitionEditor
					busy={busyId === "create"}
					onCancel={() => setBuilderOpen(false)}
					onSave={async (input) => {
						try {
							await run(
								"create",
								() => createPoll({ id: crypto.randomUUID(), taskId, ...input }),
								"detail.pollCreated",
							);
							setBuilderOpen(false);
						} catch {
							// Error toast is emitted by run; keep the draft open.
						}
					}}
				/>
			)}
			{polls.length === 0 && !builderOpen && (
				<p className="rounded-lg border border-line border-dashed bg-panel-2 px-3 py-3 font-body text-ink-3" style={{ fontSize: 12 }}>
					{t(canManage ? "detail.pollsEmptyEditor" : "detail.pollsEmpty")}
				</p>
			)}
			<div className="space-y-2">
				{polls.map((poll) => {
					const pollResponses = responses.filter((response) => response.poll_id === poll.id);
					const current = pollResponses.find((response) => response.respondent_id === currentUserId);
					const closed = Boolean(poll.closed_at);
					const canDelete =
						canManage &&
						(pollResponses.length === 0 || isManager || poll.created_by === currentUserId);
					if (editing === poll.id) {
						return (
							<PollDefinitionEditor
								key={poll.id}
								initialQuestion={poll.question ?? ""}
								initialType={poll.response_type}
								initialOptions={poll.options.map((option) => option.label).join("\n")}
								busy={busyId === poll.id}
								onCancel={() => setEditing(null)}
								onSave={async (input) => {
									try {
										await run(poll.id, () => updatePoll(poll.id, input), "detail.pollSaved");
										setEditing(null);
									} catch {
										// Keep editor open for correction.
									}
								}}
							/>
						);
					}
					return (
						<article key={poll.id} className="rounded-xl border border-line bg-panel-2 p-3">
							<div className="flex items-start justify-between" style={{ gap: 10 }}>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center" style={{ gap: 6 }}>
										<span className={`rounded-full px-2 py-1 font-display font-semibold ${closed ? "bg-line text-ink-3" : "bg-success-soft text-success-ink"}`} style={{ fontSize: 10.5 }}>
											{t(closed ? "detail.pollClosed" : "detail.pollOpen")}
										</span>
										<span className="font-mono text-ink-3" style={{ fontSize: 10.5 }}>
											{t(`detail.pollType_${poll.response_type}`)}
										</span>
									</div>
									<h4 className="mt-1.5 break-words font-display font-bold text-ink" style={{ fontSize: 13.5 }}>
										{poll.question}
									</h4>
								</div>
								{canManage && (
									<details className="relative shrink-0">
										<summary aria-label={t("detail.pollActions")} className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-lg text-ink-3 hover:bg-card">
											•••
										</summary>
										<div className="absolute right-0 z-10 min-w-40 rounded-xl border border-line bg-card p-1 shadow-xl">
											{pollResponses.length === 0 && (
												<button type="button" onClick={() => setEditing(poll.id)} className="min-h-11 w-full rounded-lg px-3 text-left font-display font-semibold text-ink-2 hover:bg-panel-2">
													{t("common.edit")}
												</button>
											)}
											<button
												type="button"
												disabled={busyId === poll.id}
												onClick={() => void run(poll.id, () => setPollClosed(poll.id, !closed), closed ? "detail.pollReopened" : "detail.pollClosedToast").catch(() => undefined)}
												className="min-h-11 w-full rounded-lg px-3 text-left font-display font-semibold text-ink-2 hover:bg-panel-2 disabled:opacity-60"
											>
												{t(closed ? "detail.pollReopen" : "detail.pollClose")}
											</button>
											{canDelete && (
												<button
													type="button"
													disabled={busyId === poll.id}
													onClick={() => {
														if (deleteConfirm !== poll.id) {
															setDeleteConfirm(poll.id);
															showToast(t("detail.pollDeleteConfirm"));
															return;
														}
														void run(poll.id, () => deletePoll(poll.id, poll.question ?? ""), "detail.pollDeleted")
															.then(() => setDeleteConfirm(null))
															.catch(() => undefined);
													}}
													className={`min-h-11 w-full rounded-lg px-3 text-left font-display font-semibold hover:bg-overdue-soft hover:text-overdue ${deleteConfirm === poll.id ? "bg-overdue-soft text-overdue" : "text-ink-2"}`}
												>
													{t(deleteConfirm === poll.id ? "detail.pollDeleteNow" : "common.delete")}
												</button>
											)}
										</div>
									</details>
								)}
							</div>
							<div className="mt-3">
								{closed ? (
									<p className="rounded-lg bg-card px-3 py-2 font-body text-ink-3" style={{ fontSize: 11.5 }}>
										{t("detail.pollClosedHint")}
									</p>
								) : currentUserId ? (
									<PollResponseEditor
										poll={poll}
										current={current}
										disabled={!currentUserId}
										busy={busyId === `response:${poll.id}`}
										onSave={(value) =>
											run(
												`response:${poll.id}`,
												() => savePollResponse(poll.id, value),
												"detail.pollResponseSaved",
											)
										}
										onClear={() =>
											run(
												`response:${poll.id}`,
												() => clearPollResponse(poll.id),
												"detail.pollResponseCleared",
											)
										}
									/>
								) : null}
							</div>
							<PollResults poll={poll} responses={pollResponses} members={members} />
						</article>
					);
				})}
			</div>
		</section>
	);
}
