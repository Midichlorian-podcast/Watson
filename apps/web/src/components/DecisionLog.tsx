import { useQuery as usePsQuery } from "@powersync/react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import type { DecisionRow, ProjectRow } from "../lib/powersync/AppSchema";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";

type Status = "active" | "superseded" | "withdrawn";
type Source = "manual" | "comment" | "meeting";

type PublicDecision = {
	id: string;
	projectId: string;
	projectName: string;
	sourceType: Source;
	sourceObjectId: string | null;
	sourceExists: boolean;
	sourceTaskId: string | null;
	title: string;
	rationale: string | null;
	ownerUserId: string | null;
	ownerName: string | null;
	decidedAt: string;
	effectiveAt: string | null;
	reviewAt: string | null;
	status: Status;
	supersedesId: string | null;
	createdBy: string | null;
	creatorName: string | null;
	version: number;
	relatedTasks: Array<{ id: string; name: string }>;
};

type DecisionPage = { decisions: PublicDecision[]; nextCursor: string | null };
type LocalLink = { decision_id: string; id: string; name: string };
type DialogMode = "create" | "supersede" | "review";

const fieldClass =
	"min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass focus:ring-2 focus:ring-brass/20";
const primaryClass =
	"min-h-11 rounded-lg bg-brass px-4 py-2 font-display text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const ghostClass =
	"min-h-11 rounded-lg border border-line bg-transparent px-3 py-2 font-display text-sm font-semibold text-ink-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50";

function dateOnly(value: string | null | undefined) {
	return value?.slice(0, 10) ?? "";
}

function apiDate(value: string) {
	return value ? `${value}T12:00:00.000Z` : null;
}

function humanDate(value: string | null) {
	if (!value) return null;
	return new Intl.DateTimeFormat("cs-CZ", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(value));
}

function sourceLabel(source: Source) {
	if (source === "comment") return "Komentář";
	if (source === "meeting") return "Porada";
	return "Ruční zápis";
}

function statusLabel(status: Status) {
	if (status === "superseded") return "Nahrazeno";
	if (status === "withdrawn") return "Odvoláno";
	return "Platí";
}

function errorLabel(code: string | undefined) {
	if (code === "stale_version") return "Rozhodnutí mezitím někdo změnil. Přehled se obnovil.";
	if (code === "decision_owner_not_project_member") return "Vlastník musí být členem projektu.";
	if (code === "decision_task_scope_mismatch") return "Připojený úkol už do projektu nepatří.";
	if (code === "decision_supersedes_invalid" || code === "decision_terminal")
		return "Rozhodnutí už bylo nahrazeno nebo odvoláno.";
	if (code === "operation_id_reused") return "Příkaz se změnil během opakování. Zkus akci znovu.";
	return "Rozhodnutí se nepodařilo uložit.";
}

async function apiJson(path: string, init?: RequestInit) {
	const response = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
	const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok) {
		const error = new Error(String(payload.error ?? `HTTP ${response.status}`));
		(error as Error & { code?: string }).code = String(payload.error ?? "decision_unavailable");
		throw error;
	}
	return payload;
}

function DecisionDialog({
	mode,
	target,
	projects,
	members,
	onClose,
	onSaved,
}: {
	mode: DialogMode;
	target: PublicDecision | null;
	projects: ProjectRow[];
	members: Map<string, string>;
	onClose: () => void;
	onSaved: () => Promise<void>;
}) {
	const initialProject = target?.projectId ?? projects[0]?.id ?? "";
	const [projectId, setProjectId] = useState(initialProject);
	const [title, setTitle] = useState("");
	const [rationale, setRationale] = useState(target?.rationale ?? "");
	const [ownerId, setOwnerId] = useState(target?.ownerUserId ?? "");
	const [effectiveAt, setEffectiveAt] = useState(dateOnly(target?.effectiveAt));
	const [reviewAt, setReviewAt] = useState(dateOnly(target?.reviewAt));
	const [relatedIds, setRelatedIds] = useState<string[]>(
		target?.relatedTasks.map((task) => task.id) ?? [],
	);
	const [taskSearch, setTaskSearch] = useState("");
	const [busy, setBusy] = useState(false);
	const [withdrawConfirm, setWithdrawConfirm] = useState(false);
	const commandRef = useRef<{
		fingerprint: string;
		id: string;
		operationId: string;
	} | null>(null);
	const dialogRef = useOverlayLayer<HTMLDivElement>(true, () => {
		if (!busy) onClose();
	});
	const { data: projectMemberRows } = usePsQuery<{ user_id: string }>(
		"SELECT user_id FROM project_members WHERE project_id = ? ORDER BY created_at",
		[projectId || ""],
	);
	const { data: projectTasks } = usePsQuery<{ id: string; name: string }>(
		`SELECT id, name FROM tasks
		 WHERE project_id = ? AND kind <> 'meeting'
		 ORDER BY completed_at IS NOT NULL, lower(name) LIMIT 300`,
		[projectId || ""],
	);
	const projectMembers = (projectMemberRows ?? [])
		.map((row) => ({ id: row.user_id, name: members.get(row.user_id) ?? "Neznámý člen" }))
		.sort((a, b) => a.name.localeCompare(b.name, "cs"));
	const visibleTasks = (projectTasks ?? [])
		.filter((task) =>
			task.name.toLocaleLowerCase("cs").includes(taskSearch.trim().toLocaleLowerCase("cs")),
		)
		.slice(0, 40);
	const isReview = mode === "review";
	const changingProject = mode === "create";

	function switchProject(next: string) {
		setProjectId(next);
		setOwnerId("");
		setRelatedIds([]);
		setTaskSearch("");
		commandRef.current = null;
	}

	async function save(status?: "withdrawn") {
		if (busy || !projectId || (!isReview && !title.trim())) return;
		const bodyBase = {
			rationale: rationale.trim() || null,
			ownerUserId: ownerId || null,
			effectiveAt: apiDate(effectiveAt),
			reviewAt: apiDate(reviewAt),
			relatedTaskIds: relatedIds,
			status,
		};
		const fingerprint = JSON.stringify({ mode, target: target?.id, projectId, title, ...bodyBase });
		if (!commandRef.current || commandRef.current.fingerprint !== fingerprint) {
			commandRef.current = {
				fingerprint,
				id: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
			};
		}
		const command = commandRef.current;
		setBusy(true);
		try {
			if (isReview && target) {
				await apiJson(`/api/decisions/${target.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						operationId: command.operationId,
						expectedVersion: target.version,
						...bodyBase,
					}),
				});
			} else {
				await apiJson("/api/decisions", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id: command.id,
						operationId: command.operationId,
						projectId,
						title: title.trim(),
						rationale: bodyBase.rationale,
						ownerUserId: bodyBase.ownerUserId,
						effectiveAt: bodyBase.effectiveAt,
						reviewAt: bodyBase.reviewAt,
						relatedTaskIds: bodyBase.relatedTaskIds,
						supersedesId: mode === "supersede" ? target?.id : undefined,
					}),
				});
			}
			showToast(
				status === "withdrawn" ? "Rozhodnutí bylo odvoláno." : "Decision Log je aktualizovaný.",
			);
			await onSaved();
			onClose();
		} catch (error) {
			showToast(errorLabel((error as Error & { code?: string }).code));
			await onSaved();
		} finally {
			setBusy(false);
		}
	}

	function submit(event: FormEvent) {
		event.preventDefault();
		void save();
	}

	return (
		<div
			className="fixed inset-0 grid place-items-center p-2.5"
			style={{ zIndex: "var(--w-layer-nested)" }}
			data-esc-layer
		>
			<button
				type="button"
				aria-label="Zavřít"
				className="absolute inset-0 bg-black/35"
				onClick={busy ? undefined : onClose}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="decision-dialog-title"
				className="relative flex max-h-[calc(100dvh-20px)] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
			>
				<div className="border-line border-b px-4 py-3.5 sm:px-5">
					<div
						id="decision-dialog-title"
						className="font-display text-base font-extrabold text-ink"
					>
						{mode === "create"
							? "Nové rozhodnutí"
							: mode === "supersede"
								? "Nahradit rozhodnutí"
								: "Revize rozhodnutí"}
					</div>
					<div className="mt-1 font-body text-xs leading-relaxed text-ink-3">
						{mode === "supersede"
							? "Původní záznam zůstane v historii a nové rozhodnutí ho nahradí."
							: isReview
								? "Název a zdroj jsou neměnná stopa. Opravu názvu proveď přes Nahradit."
								: "Zapiš, co platí, proč to platí a kdy se má rozhodnutí znovu zkontrolovat."}
					</div>
				</div>
				<form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
					<div className="space-y-4">
						{isReview && target ? (
							<div className="rounded-xl border border-line bg-panel-2 px-3 py-3">
								<div className="font-display text-sm font-bold text-ink">{target.title}</div>
								<div className="mt-1 font-body text-xs text-ink-3">
									{target.projectName} · verze {target.version}
								</div>
							</div>
						) : (
							<label className="block font-display text-xs font-bold text-ink-2">
								Co jsme rozhodli?
								<input
									value={title}
									onChange={(event) => setTitle(event.target.value)}
									maxLength={2000}
									required
									placeholder="Jedna jasná, samostatně srozumitelná věta"
									className={`${fieldClass} mt-1.5`}
								/>
							</label>
						)}

						<div className="grid gap-4 sm:grid-cols-2">
							<label className="block font-display text-xs font-bold text-ink-2">
								Projekt
								<select
									value={projectId}
									onChange={(event) => switchProject(event.target.value)}
									disabled={!changingProject}
									className={`${fieldClass} mt-1.5 disabled:opacity-70`}
								>
									{projects.map((project) => (
										<option key={project.id} value={project.id}>
											{project.name}
										</option>
									))}
								</select>
							</label>
							<label className="block font-display text-xs font-bold text-ink-2">
								Vlastník rozhodnutí
								<select
									value={ownerId}
									onChange={(event) => setOwnerId(event.target.value)}
									className={`${fieldClass} mt-1.5`}
								>
									<option value="">Bez vlastníka</option>
									{projectMembers.map((member) => (
										<option key={member.id} value={member.id}>
											{member.name}
										</option>
									))}
								</select>
							</label>
						</div>

						<label className="block font-display text-xs font-bold text-ink-2">
							Proč toto rozhodnutí platí?{" "}
							<span className="font-body font-normal text-ink-3">(volitelně)</span>
							<textarea
								value={rationale}
								onChange={(event) => setRationale(event.target.value)}
								maxLength={10000}
								rows={4}
								placeholder="Kontext, omezení nebo důvod volby"
								className={`${fieldClass} mt-1.5 resize-y`}
							/>
						</label>

						<div className="grid gap-4 sm:grid-cols-2">
							<label className="block font-display text-xs font-bold text-ink-2">
								Platí od
								<input
									type="date"
									value={effectiveAt}
									onChange={(event) => setEffectiveAt(event.target.value)}
									className={`${fieldClass} mt-1.5`}
								/>
							</label>
							<label className="block font-display text-xs font-bold text-ink-2">
								Zkontrolovat znovu
								<input
									type="date"
									value={reviewAt}
									onChange={(event) => setReviewAt(event.target.value)}
									className={`${fieldClass} mt-1.5`}
								/>
							</label>
						</div>

						<div>
							<div className="flex items-center justify-between gap-3">
								<label
									htmlFor="decision-task-search"
									className="font-display text-xs font-bold text-ink-2"
								>
									Související úkoly
								</label>
								<span className="font-body text-[11px] text-ink-3">{relatedIds.length}/30</span>
							</div>
							<input
								id="decision-task-search"
								value={taskSearch}
								onChange={(event) => setTaskSearch(event.target.value)}
								placeholder="Najít úkol v projektu…"
								className={`${fieldClass} mt-1.5`}
							/>
							<div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-line">
								{visibleTasks.length === 0 ? (
									<div className="px-3 py-3 font-body text-xs text-ink-3">
										Žádný odpovídající úkol.
									</div>
								) : (
									visibleTasks.map((task) => {
										const checked = relatedIds.includes(task.id);
										return (
											<label
												key={task.id}
												className="flex min-h-11 cursor-pointer items-center gap-2 border-line border-b px-3 py-2 last:border-b-0 hover:bg-panel-2"
											>
												<input
													type="checkbox"
													checked={checked}
													disabled={!checked && relatedIds.length >= 30}
													onChange={() =>
														setRelatedIds((current) =>
															checked
																? current.filter((id) => id !== task.id)
																: [...current, task.id],
														)
													}
													className="accent-brass"
												/>
												<span className="min-w-0 truncate font-body text-xs text-ink-2">
													{task.name}
												</span>
											</label>
										);
									})
								)}
							</div>
						</div>
					</div>
				</form>
				<div className="flex flex-wrap items-center justify-end gap-2 border-line border-t bg-card px-4 py-3 sm:px-5">
					{isReview &&
						target?.status === "active" &&
						(withdrawConfirm ? (
							<>
								<span className="mr-auto font-body text-xs text-ink-3">
									Odvolání je trvalé. Pokračovat?
								</span>
								<button
									type="button"
									className={ghostClass}
									disabled={busy}
									onClick={() => setWithdrawConfirm(false)}
								>
									Ne
								</button>
								<button
									type="button"
									className="min-h-11 rounded-lg border border-red-400 px-3 font-display text-sm font-bold text-red-600 disabled:opacity-50"
									disabled={busy}
									onClick={() => void save("withdrawn")}
								>
									Ano, odvolat
								</button>
							</>
						) : (
							<button
								type="button"
								className="mr-auto min-h-11 rounded-lg px-2 font-display text-sm font-semibold text-red-600 hover:bg-red-500/10"
								disabled={busy}
								onClick={() => setWithdrawConfirm(true)}
							>
								Odvolat…
							</button>
						))}
					{!withdrawConfirm && (
						<button type="button" className={ghostClass} disabled={busy} onClick={onClose}>
							Zrušit
						</button>
					)}
					{!withdrawConfirm && (
						<button
							type="button"
							className={primaryClass}
							disabled={busy || !projectId || (!isReview && !title.trim())}
							onClick={() => void save()}
						>
							{busy
								? "Ukládám…"
								: isReview
									? "Uložit revizi"
									: mode === "supersede"
										? "Nahradit"
										: "Zapsat rozhodnutí"}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

export function DecisionLog({
	workspaceId,
	projects,
	editableProjects,
	members,
	onBack,
	onOpenTask,
	onOpenMeeting,
	focusId,
}: {
	workspaceId: string;
	projects: ProjectRow[];
	editableProjects: ProjectRow[];
	members: Map<string, string>;
	onBack: () => void;
	onOpenTask: (id: string) => void;
	onOpenMeeting: (id: string) => void;
	focusId?: string;
}) {
	const queryClient = useQueryClient();
	const [q, setQ] = useState("");
	const deferredQ = useDeferredValue(q.trim());
	const [projectId, setProjectId] = useState("");
	const [status, setStatus] = useState<"" | Status>(() => (focusId ? "" : "active"));
	const [source, setSource] = useState<"" | Source>("");
	const [dialog, setDialog] = useState<{ mode: DialogMode; target: PublicDecision | null } | null>(
		null,
	);
	useEffect(() => {
		if (focusId) setStatus("");
	}, [focusId]);

	const query = useInfiniteQuery({
		queryKey: ["decisions", workspaceId, focusId, projectId, status, source, deferredQ],
		initialPageParam: "" as string,
		queryFn: async ({ pageParam }) => {
			const params = new URLSearchParams({ workspaceId, limit: "50" });
			if (focusId) params.set("id", focusId);
			if (projectId) params.set("projectId", projectId);
			if (status) params.set("status", status);
			if (source) params.set("source", source);
			if (deferredQ) params.set("q", deferredQ);
			if (pageParam) params.set("cursor", pageParam);
			return (await apiJson(`/api/decisions?${params}`)) as unknown as DecisionPage;
		},
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		retry: 1,
	});

	const { data: localRows, isLoading: localLoading } = usePsQuery<DecisionRow>(
		"SELECT * FROM decisions WHERE workspace_id = ? ORDER BY decided_at DESC, id DESC",
		[workspaceId],
	);
	const { data: localLinks } = usePsQuery<LocalLink>(
		`SELECT link.decision_id, task.id, task.name
		 FROM decision_task_links link JOIN tasks task ON task.id = link.task_id
		 WHERE link.project_id IN (SELECT id FROM projects WHERE workspace_id = ?)`,
		[workspaceId],
	);
	const { data: localMeetingIds } = usePsQuery<{ id: string }>(
		"SELECT id FROM meetings WHERE workspace_id = ?",
		[workspaceId],
	);
	const { data: localCommentIds } = usePsQuery<{ id: string }>("SELECT id FROM comment_decisions");

	const localFallback = useMemo(() => {
		const projectNames = new Map(
			projects.map((project) => [project.id, project.name ?? "Projekt"]),
		);
		const links = new Map<string, Array<{ id: string; name: string }>>();
		for (const link of localLinks ?? [])
			links.set(link.decision_id, [
				...(links.get(link.decision_id) ?? []),
				{ id: link.id, name: link.name },
			]);
		const meetingIds = new Set((localMeetingIds ?? []).map((row) => row.id));
		const commentIds = new Set((localCommentIds ?? []).map((row) => row.id));
		return (localRows ?? [])
			.map((row): PublicDecision => {
				const relatedTasks = links.get(row.id) ?? [];
				const sourceType = row.source_type as Source;
				return {
					id: row.id,
					projectId: row.project_id ?? "",
					projectName: projectNames.get(row.project_id ?? "") ?? "Projekt",
					sourceType,
					sourceObjectId: row.source_object_id,
					sourceExists:
						sourceType === "manual" ||
						(sourceType === "meeting"
							? meetingIds.has(row.source_object_id ?? "")
							: commentIds.has(row.source_object_id ?? "")),
					sourceTaskId: sourceType === "comment" ? (relatedTasks[0]?.id ?? null) : null,
					title: row.title ?? "",
					rationale: row.rationale,
					ownerUserId: row.owner_user_id,
					ownerName: row.owner_user_id ? (members.get(row.owner_user_id) ?? null) : null,
					decidedAt: row.decided_at ?? row.created_at ?? new Date(0).toISOString(),
					effectiveAt: row.effective_at,
					reviewAt: row.review_at,
					status: row.status as Status,
					supersedesId: row.supersedes_id,
					createdBy: row.created_by,
					creatorName: row.created_by ? (members.get(row.created_by) ?? null) : null,
					version: row.version ?? 1,
					relatedTasks,
				};
			})
			.filter((row) => !projectId || row.projectId === projectId)
			.filter((row) => !focusId || row.id === focusId)
			.filter((row) => !status || row.status === status)
			.filter((row) => !source || row.sourceType === source)
			.filter(
				(row) =>
					!deferredQ ||
					`${row.title} ${row.rationale ?? ""}`
						.toLocaleLowerCase("cs")
						.includes(deferredQ.toLocaleLowerCase("cs")),
			);
	}, [
		projects,
		localLinks,
		localMeetingIds,
		localCommentIds,
		localRows,
		members,
		projectId,
		focusId,
		status,
		source,
		deferredQ,
	]);

	const remoteRows = query.data?.pages.flatMap((page) => page.decisions) ?? [];
	const rows = query.isError && remoteRows.length === 0 ? localFallback : remoteRows;
	const loading = query.isPending && localLoading;
	const scrolledFocus = useRef<string | null>(null);
	useEffect(() => {
		if (!focusId || loading || scrolledFocus.current === focusId) return;
		const target = document.getElementById(`decision-${focusId}`);
		if (!target) return;
		target.scrollIntoView({ block: "center", behavior: "smooth" });
		scrolledFocus.current = focusId;
	}, [focusId, loading]);
	const today = new Date().toISOString().slice(0, 10);
	const dueReviews = rows.filter(
		(row) => row.status === "active" && row.reviewAt && row.reviewAt.slice(0, 10) <= today,
	).length;
	const editableIds = new Set(editableProjects.map((project) => project.id));
	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: ["decisions", workspaceId] });
	};

	return (
		<div className="mx-auto max-w-[900px] px-4 pb-16 pt-5 sm:px-5">
			<div className="flex flex-wrap items-start gap-3">
				<div className="min-w-0 flex-1">
					<button
						type="button"
						onClick={onBack}
						className="mb-2 min-h-9 font-display text-xs font-semibold text-ink-3 hover:text-ink"
					>
						← Zpět na porady
					</button>
					<h1 className="font-display text-2xl font-extrabold text-ink">Decision Log</h1>
					<p className="mt-1 max-w-[660px] font-body text-[13px] leading-relaxed text-ink-3">
						Jedno místo pro platná i historická rozhodnutí. Zdroj, důvod, vlastník a navazující
						práce zůstávají dohledatelné.
					</p>
				</div>
				{editableProjects.length > 0 && (
					<button
						type="button"
						className={primaryClass}
						onClick={() => setDialog({ mode: "create", target: null })}
					>
						+ Nové rozhodnutí
					</button>
				)}
			</div>

			<div className="mt-5 grid gap-2 sm:grid-cols-[minmax(180px,1fr)_170px_145px_145px]">
				<label className="sr-only" htmlFor="decision-search">
					Hledat v rozhodnutích
				</label>
				<input
					id="decision-search"
					value={q}
					onChange={(event) => setQ(event.target.value)}
					placeholder="Hledat rozhodnutí nebo důvod…"
					className={fieldClass}
				/>
				<select
					aria-label="Filtrovat podle projektu"
					value={projectId}
					onChange={(event) => setProjectId(event.target.value)}
					className={fieldClass}
				>
					<option value="">Všechny projekty</option>
					{projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.name}
						</option>
					))}
				</select>
				<select
					aria-label="Filtrovat podle stavu"
					value={status}
					onChange={(event) => setStatus(event.target.value as "" | Status)}
					className={fieldClass}
				>
					<option value="active">Platná</option>
					<option value="">Všechny stavy</option>
					<option value="superseded">Nahrazená</option>
					<option value="withdrawn">Odvolaná</option>
				</select>
				<select
					aria-label="Filtrovat podle zdroje"
					value={source}
					onChange={(event) => setSource(event.target.value as "" | Source)}
					className={fieldClass}
				>
					<option value="">Všechny zdroje</option>
					<option value="manual">Ruční zápis</option>
					<option value="comment">Komentář</option>
					<option value="meeting">Porada</option>
				</select>
			</div>

			{query.isError && (
				<div
					role="status"
					className="mt-3 rounded-xl border border-line bg-panel-2 px-3 py-2.5 font-body text-xs text-ink-3"
				>
					Server není dostupný — zobrazuji poslední bezpečně synchronizovanou lokální kopii.
				</div>
			)}
			{dueReviews > 0 && (
				<div className="mt-3 rounded-xl border border-brass/40 bg-brass/10 px-3 py-2.5 font-body text-xs text-ink-2">
					<b>{dueReviews}</b> {dueReviews === 1 ? "rozhodnutí čeká" : "rozhodnutí čekají"} na
					plánovanou kontrolu.
				</div>
			)}

			<div className="mt-4 space-y-3" aria-live="polite">
				{loading &&
					[0, 1, 2].map((item) => (
						<div key={item} className="h-32 animate-pulse rounded-2xl border border-line bg-card" />
					))}
				{!loading && rows.length === 0 && (
					<div className="rounded-2xl border border-line bg-card px-5 py-10 text-center">
						<div className="font-display text-base font-bold text-ink">Nic tu zatím není</div>
						<div className="mx-auto mt-1 max-w-md font-body text-sm text-ink-3">
							Změň filtry, nebo zapiš první rozhodnutí tak, aby se za měsíc nemuselo znovu hledat v
							chatu.
						</div>
						{editableProjects.length > 0 && (
							<button
								type="button"
								className={`${primaryClass} mt-4`}
								onClick={() => setDialog({ mode: "create", target: null })}
							>
								Zapsat rozhodnutí
							</button>
						)}
					</div>
				)}
				{rows.map((row) => {
					const reviewDue =
						row.reviewAt && row.reviewAt.slice(0, 10) <= today && row.status === "active";
					return (
						<article
							key={row.id}
							id={`decision-${row.id}`}
							className={`rounded-2xl border bg-card px-4 py-4 shadow-sm sm:px-5 ${focusId === row.id ? "border-brass ring-2 ring-brass/20" : "border-line"}`}
						>
							<div className="flex flex-wrap items-center gap-2 font-body text-[11px] text-ink-3">
								<span
									className={`rounded-full px-2 py-1 font-display font-bold ${row.status === "active" ? "bg-success-soft text-success-ink" : "bg-panel-2 text-ink-3"}`}
								>
									{statusLabel(row.status)}
								</span>
								<span>{row.projectName}</span>
								<span aria-hidden>·</span>
								<span>{sourceLabel(row.sourceType)}</span>
								<span aria-hidden>·</span>
								<time dateTime={row.decidedAt}>{humanDate(row.decidedAt)}</time>
								{reviewDue && (
									<span className="rounded-full bg-brass/15 px-2 py-1 font-display font-bold text-brass-text">
										Čeká na kontrolu
									</span>
								)}
							</div>
							<h2 className="mt-2 font-display text-[16px] font-extrabold leading-snug text-ink">
								{row.title}
							</h2>
							{row.rationale && (
								<p className="mt-2 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-ink-2">
									{row.rationale}
								</p>
							)}
							<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-body text-[11.5px] text-ink-3">
								{row.ownerName && (
									<span>
										Vlastník: <b className="text-ink-2">{row.ownerName}</b>
									</span>
								)}
								{row.effectiveAt && (
									<span>
										Platí od: <b className="text-ink-2">{humanDate(row.effectiveAt)}</b>
									</span>
								)}
								{row.reviewAt && (
									<span>
										Kontrola: <b className="text-ink-2">{humanDate(row.reviewAt)}</b>
									</span>
								)}
							</div>
							{row.relatedTasks.length > 0 && (
								<div className="mt-3 flex flex-wrap gap-1.5">
									{row.relatedTasks.map((task) => (
										<button
											key={task.id}
											type="button"
											onClick={() => onOpenTask(task.id)}
											className="min-h-9 max-w-full truncate rounded-lg border border-line bg-panel-2 px-2.5 font-body text-xs text-ink-2 hover:border-brass"
										>
											↗ {task.name}
										</button>
									))}
								</div>
							)}
							<div className="mt-3 flex flex-wrap items-center gap-2 border-line border-t pt-3">
								{row.sourceType === "comment" && row.sourceTaskId && (
									<button
										type="button"
										onClick={() => row.sourceTaskId && onOpenTask(row.sourceTaskId)}
										className={ghostClass}
									>
										Otevřít komentář v úkolu
									</button>
								)}
								{row.sourceType === "meeting" && row.sourceObjectId && row.sourceExists && (
									<button
										type="button"
										onClick={() => row.sourceObjectId && onOpenMeeting(row.sourceObjectId)}
										className={ghostClass}
									>
										Otevřít poradu
									</button>
								)}
								{row.sourceType !== "manual" && !row.sourceExists && (
									<span className="font-body text-xs text-ink-3">
										Zdroj už není dostupný; historický snapshot zůstává.
									</span>
								)}
								{row.status === "active" && editableIds.has(row.projectId) && (
									<div className="ml-auto flex flex-wrap gap-2">
										<button
											type="button"
											className={ghostClass}
											onClick={() => setDialog({ mode: "review", target: row })}
										>
											Revidovat
										</button>
										<button
											type="button"
											className={ghostClass}
											onClick={() => setDialog({ mode: "supersede", target: row })}
										>
											Nahradit…
										</button>
									</div>
								)}
							</div>
						</article>
					);
				})}
			</div>
			{query.hasNextPage && (
				<div className="mt-4 text-center">
					<button
						type="button"
						className={ghostClass}
						disabled={query.isFetchingNextPage}
						onClick={() => void query.fetchNextPage()}
					>
						{query.isFetchingNextPage ? "Načítám…" : "Načíst starší rozhodnutí"}
					</button>
				</div>
			)}

			{dialog && (
				<DecisionDialog
					mode={dialog.mode}
					target={dialog.target}
					projects={
						dialog.mode === "create"
							? editableProjects
							: projects.filter((project) => project.id === dialog.target?.projectId)
					}
					members={members}
					onClose={() => setDialog(null)}
					onSaved={refresh}
				/>
			)}
		</div>
	);
}
