import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@watson/ui";
import { type ReactNode, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { deviceTimeZone } from "../lib/timeZone";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";

type TriggerType = "task_created" | "task_completed" | "task_reopened";
type AutomationConfig = {
	timezone: string;
	trigger: { type: TriggerType };
	conditions: Array<
		| { field: "priority"; operator: "equals"; value: number }
		| { field: "deadline"; operator: "is_set"; value: boolean }
		| { field: "assignee"; operator: "is_set"; value: boolean }
	>;
	actions: Array<
		| { type: "set_priority"; value: number }
		| { type: "set_due_offset"; days: number; overwrite: boolean }
		| { type: "add_comment"; body: string }
	>;
};

type Rule = {
	id: string;
	workspace_id: string;
	project_id: string;
	project_name: string;
	name: string;
	description: string | null;
	state: "enabled" | "paused" | "archived";
	draft_revision: number;
	draft_config: AutomationConfig;
	published_version_id: string | null;
	published_version: number | null;
	published_at: string | null;
	can_manage: boolean;
	run_total: number;
	run_succeeded: number;
	run_failed: number;
};

type RuleDetail = {
	rule: Rule;
	versions: Array<{
		id: string;
		version: number;
		config: AutomationConfig;
		published_by: string;
		published_at: string;
	}>;
	runs: Array<{
		id: string;
		rule_version_id: string;
		version: number;
		task_id: string;
		task_name: string | null;
		status: "queued" | "running" | "succeeded" | "skipped" | "failed" | "undone";
		trigger_type: TriggerType;
		error_code: string | null;
		created_at: string;
		completed_at: string | null;
		undo_expires_at: string | null;
		undone_at: string | null;
		can_undo: boolean;
	}>;
	previewTasks: Array<{ id: string; name: string }>;
};

type Project = { id: string; name: string | null; workspace_id: string | null };

const triggerLabels: Record<TriggerType, string> = {
	task_created: "Úkol je vytvořen",
	task_completed: "Úkol je dokončen",
	task_reopened: "Úkol je znovu otevřen",
};

const statusLabels: Record<Rule["state"], string> = {
	enabled: "Aktivní",
	paused: "Pozastaveno",
	archived: "Archivováno",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		credentials: "include",
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "automation_unavailable");
	return body as T;
}

function actionLabel(action: AutomationConfig["actions"][number]) {
	if (action.type === "set_priority") return `nastavit P${action.value}`;
	if (action.type === "set_due_offset") {
		return `plánovat za ${action.days} d. ${action.overwrite ? "i s přepsáním" : "jen bez data"}`;
	}
	return "přidat automatický komentář";
}

function ruleSummary(config: AutomationConfig) {
	const conditions = config.conditions.length
		? `pokud platí ${config.conditions.length} ${config.conditions.length === 1 ? "podmínka" : "podmínky"}`
		: "bez dalších podmínek";
	return `${triggerLabels[config.trigger.type]}, ${conditions} → ${config.actions.map(actionLabel).join(" · ")}`;
}

export function AutomationCenter({
	workspaceId,
	projects,
	onBack,
}: {
	workspaceId: string | null;
	projects: Project[];
	onBack: () => void;
}) {
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [builder, setBuilder] = useState<Rule | "new" | null>(null);
	const rulesQuery = useQuery({
		queryKey: ["automation-rules", workspaceId],
		enabled: Boolean(workspaceId),
		queryFn: () => api<{ rules: Rule[] }>(`/api/automation/rules?workspaceId=${workspaceId}`),
	});
	const rules = rulesQuery.data?.rules ?? [];
	const selected = rules.find((rule) => rule.id === selectedId) ?? null;

	const refresh = async (select?: string) => {
		await queryClient.invalidateQueries({ queryKey: ["automation-rules", workspaceId] });
		if (select) setSelectedId(select);
	};

	return (
		<div className="mx-auto max-w-[980px] px-4 pt-5 pb-24 sm:px-[22px]">
			<div className="flex flex-wrap items-start gap-3">
				<button
					type="button"
					onClick={onBack}
					className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-line bg-card text-ink-2 hover:border-brass"
					aria-label="Zpět na Postupy"
				>
					<span aria-hidden className="text-lg">←</span>
				</button>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="font-display text-lg font-extrabold text-ink">Automatizace</h1>
						<span className="rounded-full bg-brass-soft px-2 py-1 font-mono text-[9px] font-bold text-brass-text">
							PREVIEW · AUDIT · UNDO
						</span>
					</div>
					<p className="mt-1 max-w-[680px] font-body text-xs leading-relaxed text-ink-3">
						Pravidlo nejprve vznikne jako koncept. Teprve publikovaná, očíslovaná verze může měnit práci — a každý běh zůstane dohledatelný.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setBuilder("new")}
					disabled={projects.length === 0}
					className="min-h-11 rounded-xl bg-brass px-4 font-display text-xs font-bold text-white hover:brightness-105 disabled:opacity-50"
				>
					+ Nové pravidlo
				</button>
			</div>

			<div className="mt-5 rounded-2xl border border-line bg-panel-2 p-4">
				<div className="grid gap-3 sm:grid-cols-3">
					<PromiseCard number="1" title="Když" text="vznikne, dokončí se nebo se znovu otevře úkol" />
					<PromiseCard number="2" title="A pokud" text="sedí priorita, termín nebo přítomnost řešitele" />
					<PromiseCard number="3" title="Pak" text="změň prioritu či datum nebo přidej komentář" />
				</div>
			</div>

			{rulesQuery.isPending && (
				<div role="status" className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Načítám automatizace">
					<div className="h-36 animate-pulse rounded-2xl bg-panel-2" />
					<div className="h-36 animate-pulse rounded-2xl bg-panel-2" />
				</div>
			)}
			{rulesQuery.isError && (
				<div role="alert" className="mt-4 rounded-2xl border border-line bg-card p-5">
					<div className="font-display text-sm font-bold text-ink">Automatizace teď nelze načíst</div>
					<p className="mt-1 font-body text-xs text-ink-3">Data nevydáváme za aktuální. Zkuste načtení zopakovat.</p>
					<button type="button" onClick={() => void rulesQuery.refetch()} className="mt-3 min-h-11 rounded-lg bg-ink px-4 font-display text-xs font-bold text-card">
						Zkusit znovu
					</button>
				</div>
			)}
			{rulesQuery.data && rules.length === 0 && (
				<div className="mt-4 rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-center">
					<div className="font-display text-sm font-bold text-ink">Zatím žádné pravidlo</div>
					<p className="mx-auto mt-1 max-w-[520px] font-body text-xs text-ink-3">
						Začněte jedním úzkým pravidlem, otestujte jej na konkrétním úkolu a až potom publikujte.
					</p>
					<button type="button" onClick={() => setBuilder("new")} className="mt-4 min-h-11 rounded-xl bg-brass px-4 font-display text-xs font-bold text-white">
						Vytvořit první koncept
					</button>
				</div>
			)}

			{rules.length > 0 && (
				<div className="mt-4 grid gap-3 sm:grid-cols-2">
					{rules.map((rule) => (
						<button
							type="button"
							key={rule.id}
							onClick={() => setSelectedId(rule.id)}
							className="min-h-11 rounded-2xl border border-line bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-brass hover:shadow-md"
						>
							<div className="flex items-start gap-3">
								<span
									className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
									style={{ background: rule.state === "enabled" && rule.published_version ? "var(--w-brass)" : rule.state === "paused" ? "var(--w-overdue)" : "var(--w-ink-3)" }}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-display text-sm font-bold text-ink">{rule.name}</span>
										<span className="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[9px] text-ink-3">
											{rule.published_version ? `v${rule.published_version}` : "DRAFT"}
										</span>
									</div>
									<div className="mt-0.5 font-body text-[10px] text-ink-3">{rule.project_name} · {statusLabels[rule.state]}</div>
									<p className="mt-2 line-clamp-2 font-body text-[11px] leading-relaxed text-ink-2">{ruleSummary(rule.draft_config)}</p>
									<div className="mt-3 flex flex-wrap gap-3 font-mono text-[9px] text-ink-3">
										<span>{rule.run_total} běhů</span>
										<span>{rule.run_succeeded} úspěšných</span>
										{rule.run_failed > 0 && <span className="text-overdue">{rule.run_failed} chyb</span>}
									</div>
								</div>
								<span aria-hidden className="text-ink-3">→</span>
							</div>
						</button>
					))}
				</div>
			)}

			{selected && (
				<RuleDrawer
					rule={selected}
					onClose={() => setSelectedId(null)}
					onEdit={() => setBuilder(selected)}
					onChanged={() => void refresh(selected.id)}
				/>
			)}
			{builder && (
				<RuleBuilder
					projects={projects}
					initial={builder === "new" ? null : builder}
					onClose={() => setBuilder(null)}
					onSaved={(id) => {
						setBuilder(null);
						void refresh(id);
					}}
				/>
			)}
		</div>
	);
}

function PromiseCard({ number, title, text }: { number: string; title: string; text: string }) {
	return (
		<div className="flex items-start gap-3">
			<span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-card font-mono text-xs font-bold text-brass-text">{number}</span>
			<div>
				<div className="font-display text-xs font-bold text-ink">{title}</div>
				<p className="mt-0.5 font-body text-[10.5px] leading-relaxed text-ink-3">{text}</p>
			</div>
		</div>
	);
}

function RuleDrawer({ rule, onClose, onEdit, onChanged }: { rule: Rule; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
	const panelRef = useOverlayLayer<HTMLDivElement>(true, onClose);
	const queryClient = useQueryClient();
	const [taskId, setTaskId] = useState("");
	const [preview, setPreview] = useState<{ matched: boolean; facts: string[]; changes: PlannedChange[]; warning: string } | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const detailQuery = useQuery({
		queryKey: ["automation-rule", rule.id],
		queryFn: () => api<RuleDetail>(`/api/automation/rules/${rule.id}`),
	});
	const detail = detailQuery.data;
	const latest = detail?.versions[0] ?? null;
	const draftChanged = latest ? JSON.stringify(latest.config) !== JSON.stringify(rule.draft_config) : true;

	const mutate = async (key: string, path: string, body: unknown) => {
		setBusy(key);
		try {
			await api(path, { method: "POST", body: JSON.stringify(body) });
			await detailQuery.refetch();
			await queryClient.invalidateQueries({ queryKey: ["automation-rules", rule.workspace_id] });
			onChanged();
			showToast(key === "publish" ? "Publikovaná verze je aktivní" : key === "undo" ? "Běh byl bezpečně vrácen" : "Stav pravidla byl změněn");
		} catch (error) {
			showToast(`Akce se neprovedla: ${error instanceof Error ? error.message : "automation_unavailable"}`);
		} finally {
			setBusy(null);
		}
	};

	return (
		<>
			<button type="button" aria-label="Zavřít detail pravidla" onClick={onClose} className="fixed inset-0" style={{ background: "rgba(10,14,20,.34)", zIndex: "var(--w-layer-drawer)" }} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={`Automatizace ${rule.name}`}
				data-esc-layer
				className="fixed top-0 right-0 bottom-0 flex w-[520px] max-w-[96vw] flex-col border-line border-l bg-card"
				style={{ boxShadow: "var(--w-shadow)", zIndex: "calc(var(--w-layer-drawer) + 1)" }}
			>
				<div className="shrink-0 border-line border-b px-5 py-4">
					<div className="flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<div className="font-display text-base font-extrabold text-ink">{rule.name}</div>
							<div className="mt-0.5 font-body text-[10px] text-ink-3">{rule.project_name} · revize draftu {rule.draft_revision}</div>
						</div>
						<button type="button" onClick={onClose} aria-label="Zavřít" className="grid min-h-11 min-w-11 place-items-center rounded-full text-ink-3 hover:bg-panel-2">
							<Icon name="zavrit" size={16} />
						</button>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					<section aria-labelledby="automation-definition" className="rounded-2xl bg-panel-2 p-4">
						<div id="automation-definition" className="font-display text-xs font-bold text-ink">Definice pravidla</div>
						<p className="mt-2 font-body text-xs leading-relaxed text-ink-2">{ruleSummary(rule.draft_config)}</p>
						<div className="mt-3 flex flex-wrap gap-2">
							<span className="rounded-full bg-card px-2 py-1 font-mono text-[9px] text-ink-3">{latest ? `PUBLIKOVÁNO v${latest.version}` : "NEPUBLIKOVÁNO"}</span>
							{draftChanged && <span className="rounded-full bg-brass-soft px-2 py-1 font-mono text-[9px] text-brass-text">DRAFT MÁ ZMĚNY</span>}
						</div>
						{rule.can_manage && (
							<div className="mt-4 flex flex-wrap gap-2">
								<button type="button" onClick={onEdit} className="min-h-11 rounded-lg border border-line bg-card px-3 font-display text-xs font-bold text-ink-2">Upravit koncept</button>
								<button
									type="button"
									disabled={busy != null}
									onClick={() => void mutate("publish", `/api/automation/rules/${rule.id}/publish`, { expectedRevision: rule.draft_revision, operationId: crypto.randomUUID() })}
									className="min-h-11 rounded-lg bg-ink px-3 font-display text-xs font-bold text-card disabled:opacity-50"
								>
									{busy === "publish" ? "Publikuji…" : latest ? "Publikovat novou verzi" : "Publikovat v1"}
								</button>
								{latest && (
									<button
										type="button"
										disabled={busy != null}
										onClick={() => void mutate("state", `/api/automation/rules/${rule.id}/state`, { state: rule.state === "paused" ? "enabled" : "paused", operationId: crypto.randomUUID() })}
										className="min-h-11 rounded-lg border border-line bg-card px-3 font-display text-xs font-bold text-ink-2 disabled:opacity-50"
									>
										{rule.state === "paused" ? "Znovu spustit" : "Pozastavit"}
									</button>
								)}
							</div>
						)}
					</section>

					<section aria-labelledby="automation-preview" className="mt-4 rounded-2xl border border-line p-4">
						<div id="automation-preview" className="font-display text-xs font-bold text-ink">Bezpečný preview test</div>
						<p className="mt-1 font-body text-[10.5px] leading-relaxed text-ink-3">Vyberte skutečný úkol. Watson vypíše podmínky a změny, ale nic neuloží.</p>
						<div className="mt-3 flex flex-col gap-2 sm:flex-row">
							<select value={taskId} onChange={(event) => { setTaskId(event.target.value); setPreview(null); }} aria-label="Úkol pro preview" className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 font-body text-xs text-ink">
								<option value="">Vyberte úkol…</option>
								{(detail?.previewTasks ?? []).map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
							</select>
							<button
								type="button"
								disabled={!taskId || busy != null}
								onClick={() => {
									setBusy("preview");
									void api<{ matched: boolean; facts: string[]; changes: PlannedChange[]; warning: string }>(`/api/automation/rules/${rule.id}/preview`, { method: "POST", body: JSON.stringify({ taskId }) })
										.then(setPreview)
										.catch((error) => showToast(`Preview selhal: ${error instanceof Error ? error.message : "automation_unavailable"}`))
										.finally(() => setBusy(null));
								}}
								className="min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white disabled:opacity-50"
							>
								{busy === "preview" ? "Počítám…" : "Spustit preview"}
							</button>
						</div>
						{preview && (
							<div role="status" className="mt-3 rounded-xl bg-panel-2 p-3">
								<div className="font-display text-xs font-bold text-ink">{preview.matched ? `${preview.changes.length} navržené změny` : "Podmínky nejsou splněné"}</div>
								<ul className="mt-2 space-y-1 font-body text-[10.5px] text-ink-2">
									{preview.facts.map((fact) => <li key={fact}>• {fact}</li>)}
									{preview.changes.map((change) => <li key={`${change.type}:${change.label}`}>→ {change.label}</li>)}
								</ul>
								<p className="mt-2 font-body text-[9.5px] text-ink-3">{preview.warning}</p>
							</div>
						)}
					</section>

					<section aria-labelledby="automation-history" className="mt-4">
						<div className="flex items-center gap-2">
							<div id="automation-history" className="font-display text-xs font-bold text-ink">Historie běhů</div>
							{detail && <span className="font-mono text-[9px] text-ink-3">posledních {detail.runs.length}</span>}
						</div>
						{detailQuery.isPending && <div className="mt-2 h-20 animate-pulse rounded-xl bg-panel-2" />}
						{detailQuery.isError && <p role="alert" className="mt-2 font-body text-xs text-overdue">Historii se nepodařilo načíst.</p>}
						{detail && detail.runs.length === 0 && <p className="mt-2 rounded-xl bg-panel-2 p-3 font-body text-xs text-ink-3">Žádný běh. Preview se do historie nepočítá, protože nic nemění.</p>}
						<div className="mt-2 space-y-2">
							{detail?.runs.map((run) => (
								<div key={run.id} className="rounded-xl border border-line p-3">
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<div className="truncate font-display text-xs font-bold text-ink">{run.task_name ?? "Smazaný úkol"}</div>
											<div className="mt-0.5 font-mono text-[9px] text-ink-3">v{run.version} · {runStatus(run.status, run.error_code)} · {new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(run.created_at))}</div>
										</div>
										{run.can_undo && rule.can_manage && (
											<button type="button" disabled={busy != null} onClick={() => void mutate("undo", `/api/automation/runs/${run.id}/undo`, { operationId: crypto.randomUUID() })} className="min-h-11 rounded-lg border border-line px-3 font-display text-[10px] font-bold text-ink-2 disabled:opacity-50">Undo</button>
										)}
									</div>
								</div>
							))}
						</div>
					</section>
				</div>
			</div>
		</>
	);
}

type PlannedChange = { type: string; label: string; before: unknown; after: unknown };

function runStatus(status: RuleDetail["runs"][number]["status"], error: string | null) {
	if (status === "succeeded") return "provedeno";
	if (status === "undone") return "vráceno";
	if (status === "skipped") return error === "conditions_not_met" ? "podmínky nesplněny" : "přeskočeno";
	if (status === "failed") return `chyba ${error ?? "execution"}`;
	if (status === "running") return "probíhá";
	return "ve frontě";
}

function RuleBuilder({ projects, initial, onClose, onSaved }: { projects: Project[]; initial: Rule | null; onClose: () => void; onSaved: (id: string) => void }) {
	const modalRef = useOverlayLayer<HTMLDivElement>(true, onClose);
	const initialConfig = initial?.draft_config;
	const priorityCondition = initialConfig?.conditions.find((condition) => condition.field === "priority");
	const priorityAction = initialConfig?.actions.find((action) => action.type === "set_priority");
	const dueAction = initialConfig?.actions.find((action) => action.type === "set_due_offset");
	const commentAction = initialConfig?.actions.find((action) => action.type === "add_comment");
	const [name, setName] = useState(initial?.name ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [projectId, setProjectId] = useState(initial?.project_id ?? projects[0]?.id ?? "");
	const [trigger, setTrigger] = useState<TriggerType>(initialConfig?.trigger.type ?? "task_completed");
	const [conditionPriority, setConditionPriority] = useState(priorityCondition?.field === "priority" ? String(priorityCondition.value) : "");
	const [setPriority, setSetPriority] = useState(Boolean(priorityAction));
	const [priority, setPriorityValue] = useState(priorityAction?.type === "set_priority" ? priorityAction.value : 1);
	const [setDue, setSetDue] = useState(Boolean(dueAction));
	const [dueDays, setDueDays] = useState(dueAction?.type === "set_due_offset" ? dueAction.days : 2);
	const [overwriteDue, setOverwriteDue] = useState(dueAction?.type === "set_due_offset" ? dueAction.overwrite : false);
	const [addComment, setAddComment] = useState(Boolean(commentAction));
	const [comment, setComment] = useState(commentAction?.type === "add_comment" ? commentAction.body : "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const actions = useMemo<AutomationConfig["actions"]>(() => [
		...(setPriority ? [{ type: "set_priority" as const, value: priority }] : []),
		...(setDue ? [{ type: "set_due_offset" as const, days: dueDays, overwrite: overwriteDue }] : []),
		...(addComment && comment.trim() ? [{ type: "add_comment" as const, body: comment.trim() }] : []),
	], [setPriority, priority, setDue, dueDays, overwriteDue, addComment, comment]);

	const save = async () => {
		if (!name.trim() || !projectId || actions.length === 0) {
			setError("Vyplňte název, projekt a alespoň jednu úplnou akci.");
			return;
		}
		setSaving(true);
		setError(null);
		const config: AutomationConfig = {
			timezone: initialConfig?.timezone ?? deviceTimeZone(),
			trigger: { type: trigger },
			conditions: conditionPriority ? [{ field: "priority", operator: "equals", value: Number(conditionPriority) }] : [],
			actions,
		};
		try {
			if (initial) {
				await api(`/api/automation/rules/${initial.id}`, {
					method: "PATCH",
					body: JSON.stringify({ name: name.trim(), description: description.trim() || null, config, expectedRevision: initial.draft_revision }),
				});
				onSaved(initial.id);
			} else {
				const id = crypto.randomUUID();
				await api("/api/automation/rules", {
					method: "POST",
					body: JSON.stringify({ id, projectId, name: name.trim(), description: description.trim() || null, config, operationId: crypto.randomUUID() }),
				});
				onSaved(id);
			}
			showToast(initial ? "Koncept pravidla byl aktualizován" : "Koncept vznikl — před spuštěním jej otestujte a publikujte");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "automation_unavailable");
		} finally {
			setSaving(false);
		}
	};

	const input = "min-h-11 w-full rounded-lg border border-line bg-card px-3 font-body text-xs text-ink outline-none focus:border-brass";
	return (
		<>
			<button type="button" aria-label="Zavřít editor pravidla" onClick={onClose} className="fixed inset-0" style={{ background: "rgba(10,14,20,.42)", zIndex: "var(--w-layer-modal)" }} />
			<div className="pointer-events-none fixed inset-0 flex items-start justify-center px-3 pt-[4vh]" style={{ zIndex: "calc(var(--w-layer-modal) + 1)" }}>
				<div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="automation-builder-title" data-esc-layer className="pointer-events-auto max-h-[92vh] w-[720px] max-w-full overflow-y-auto rounded-2xl border border-line bg-card" style={{ boxShadow: "var(--w-shadow)" }}>
					<div className="sticky top-0 z-10 flex items-center gap-3 border-line border-b bg-card px-5 py-4">
						<div className="grid h-8 w-8 place-items-center rounded-xl bg-brass-soft text-brass-text"><Icon name="postup" size={16} /></div>
						<div className="min-w-0 flex-1">
							<div id="automation-builder-title" className="font-display text-base font-extrabold text-ink">{initial ? "Upravit koncept" : "Nové pravidlo"}</div>
							<div className="font-body text-[10px] text-ink-3">Uložení nic nespustí. Aktivní je až publikovaná verze.</div>
						</div>
						<button type="button" onClick={onClose} aria-label="Zavřít" className="grid min-h-11 min-w-11 place-items-center rounded-full text-ink-3 hover:bg-panel-2"><Icon name="zavrit" size={16} /></button>
					</div>
					<div className="space-y-5 p-5">
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="sm:col-span-2"><span className="mb-1 block font-display text-[10px] font-bold text-ink-2">Název pravidla</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} className={input} placeholder="Např. Po dokončení připrav report" /></label>
							<label><span className="mb-1 block font-display text-[10px] font-bold text-ink-2">Projekt</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={Boolean(initial)} className={input}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name ?? "Projekt"}</option>)}</select></label>
							<label><span className="mb-1 block font-display text-[10px] font-bold text-ink-2">Když</span><select value={trigger} onChange={(event) => setTrigger(event.target.value as TriggerType)} className={input}>{Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
							<label><span className="mb-1 block font-display text-[10px] font-bold text-ink-2">Volitelná podmínka priority</span><select value={conditionPriority} onChange={(event) => setConditionPriority(event.target.value)} className={input}><option value="">Jakákoli priorita</option>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>Pouze P{value}</option>)}</select></label>
							<label><span className="mb-1 block font-display text-[10px] font-bold text-ink-2">Popis pro správce</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} className={input} placeholder="Proč pravidlo existuje" /></label>
						</div>

						<fieldset>
							<legend className="font-display text-xs font-bold text-ink">Pak provést</legend>
							<div className="mt-2 space-y-2">
								<ActionRow checked={setPriority} onChecked={setSetPriority} title="Změnit prioritu" description="Pouze pokud je výsledná priorita jiná.">
									<select aria-label="Nová priorita" value={priority} onChange={(event) => setPriorityValue(Number(event.target.value))} disabled={!setPriority} className={`${input} w-28`}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>P{value}</option>)}</select>
								</ActionRow>
								<ActionRow checked={setDue} onChecked={setSetDue} title="Nastavit plánované datum" description="Počet kalendářních dní od spouštěcí události.">
									<div className="flex flex-wrap items-center gap-2"><input aria-label="Počet dní" type="number" min={0} max={365} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} disabled={!setDue} className={`${input} w-24`} /><label className="flex min-h-11 items-center gap-2 font-body text-[10px] text-ink-2"><input type="checkbox" checked={overwriteDue} onChange={(event) => setOverwriteDue(event.target.checked)} disabled={!setDue} /> Přepsat existující datum</label></div>
								</ActionRow>
								<ActionRow checked={addComment} onChecked={setAddComment} title="Přidat komentář" description="Autor je správce publikované verze; běh je jasně označen v auditu.">
									<textarea aria-label="Text automatického komentáře" value={comment} onChange={(event) => setComment(event.target.value)} disabled={!addComment} maxLength={2000} rows={3} className={`${input} min-h-20 resize-y py-2`} placeholder="Co má tým po automatickém kroku vědět?" />
								</ActionRow>
							</div>
						</fieldset>

						{error && <div role="alert" className="rounded-xl border border-overdue bg-overdue-soft px-3 py-2 font-body text-xs text-overdue">{error}</div>}
						<div className="flex flex-wrap justify-end gap-2 border-line border-t pt-4">
							<button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line px-4 font-display text-xs font-bold text-ink-2">Zrušit</button>
							<button type="button" onClick={() => void save()} disabled={saving} className="min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white disabled:opacity-50">{saving ? "Ukládám…" : "Uložit koncept"}</button>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

function ActionRow({ checked, onChecked, title, description, children }: { checked: boolean; onChecked: (value: boolean) => void; title: string; description: string; children: ReactNode }) {
	return (
		<div className={`rounded-xl border p-3 ${checked ? "border-brass bg-brass-soft/40" : "border-line bg-panel-2"}`}>
			<div className="flex items-start gap-3">
				<label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3">
					<input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} className="mt-1" />
					<span><span className="block font-display text-xs font-bold text-ink">{title}</span><span className="mt-0.5 block font-body text-[10px] leading-relaxed text-ink-3">{description}</span></span>
				</label>
			</div>
			<div className="mt-2 pl-7">{children}</div>
		</div>
	);
}
