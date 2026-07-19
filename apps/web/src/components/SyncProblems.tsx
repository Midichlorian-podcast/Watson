import { useQuery as usePsQuery, useStatus } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RejectedOpRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import {
	formatQueueBytes,
	normalizePendingOperation,
	operationDiff,
	parseRejectedOperation,
	type OutboxOperation,
} from "../lib/powersync/outbox";
import { retryRejectedOperation } from "../lib/powersync/syncRecovery";
import { useTaskDetail } from "../lib/taskDetail";
import { showToast } from "../lib/toast";
import { useTrustState } from "./TrustState";

type QueueSnapshot = {
	count: number;
	size: number | null;
	operations: OutboxOperation[];
	haveMore: boolean;
	capturedAt: Date;
};

const ENTITY_KEYS: Record<string, string> = {
	tasks: "task",
	projects: "project",
	assignments: "assignment",
	comments: "comment",
	goals: "goal",
	chains: "flow",
	chain_steps: "flowStep",
	task_activity: "taskActivity",
	filters: "savedView",
	availability_blocks: "availability",
	user_availability: "availabilityProfile",
};

const FIELD_KEYS: Record<string, string> = {
	name: "name",
	description: "description",
	status: "status",
	priority: "priority",
	project_id: "project",
	assignee_id: "assignee",
	due_date: "dueDate",
	start_date: "startDate",
	assignment_mode: "assignmentMode",
	recurrence_basis: "recurrenceBasis",
	recurrence_rule: "recurrenceRule",
	schedule_mode: "scheduleMode",
	estimate_minutes: "estimate",
};

/**
 * F3 — recovery-first outbox. Zachovává durable rejected operace a navíc ukazuje
 * veřejnou PowerSync upload frontu: počet, velikost, retry stav a redigovaný diff.
 * Pending operace se pouze čtou; potvrzení/odstranění smí dělat jedině connector.
 */
export function SyncProblems() {
	const { t, i18n } = useTranslation();
	const status = useStatus();
	const { sync } = useTrustState();
	const taskDetail = useTaskDetail();
	const { data: rows } = usePsQuery<RejectedOpRow>(
		"SELECT * FROM local_rejected_ops WHERE status = 'open' ORDER BY created_at DESC LIMIT 50",
	);
	const [queue, setQueue] = useState<QueueSnapshot | null>(null);
	const [queueError, setQueueError] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [retryingId, setRetryingId] = useState<string | null>(null);
	const list = rows ?? [];
	const locale = i18n.resolvedLanguage ?? i18n.language ?? "cs";

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			const [stats, batch] = await Promise.all([
				powerSync.getUploadQueueStats(true),
				powerSync.getCrudBatch(50),
			]);
			setQueue({
				count: stats.count,
				size: stats.size,
				operations: (batch?.crud ?? []).map((operation) => normalizePendingOperation(operation)),
				haveMore: batch?.haveMore ?? false,
				capturedAt: new Date(),
			});
			setQueueError(false);
		} catch {
			setQueueError(true);
		} finally {
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => void refresh(), 2_000);
		window.addEventListener("online", refresh);
		window.addEventListener("offline", refresh);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("online", refresh);
			window.removeEventListener("offline", refresh);
		};
	}, [refresh]);

	const discard = async (id: string) => {
		if (!window.confirm(t("sync.problemDiscardConfirm"))) return;
		try {
			await powerSync.execute("UPDATE local_rejected_ops SET status = 'discarded' WHERE id = ?", [id]);
			showToast(t("sync.problemDiscarded"));
		} catch {
			showToast(t("sync.problemDiscardFailed"));
		}
	};
	const retry = async (row: RejectedOpRow) => {
		if (retryingId) return;
		setRetryingId(row.id);
		try {
			const result = await retryRejectedOperation(powerSync, row);
			showToast(
				result.ok
					? t("sync.problemRetrySuccess")
					: t("sync.problemRetryFailed", { code: result.code ?? "unknown" }),
			);
		} finally {
			setRetryingId(null);
			void refresh();
		}
	};
	const copyOne = async (row: RejectedOpRow) => {
		try {
			const operation = parseRejectedOperation(
				row.id,
				row.table_name ?? "",
				row.row_id ?? "",
				row.op ?? "PUT",
				row.payload,
			);
			await navigator.clipboard.writeText(
				JSON.stringify(
					{
						id: row.id,
						clientId: row.client_id,
						operationId: row.operation_id,
						table: operation.table,
						rowId: operation.rowId,
						op: operation.op,
						httpCode: row.http_code,
						serverCode: row.server_code,
						requestId: row.request_id,
						createdAt: row.created_at,
						changes: operationDiff(operation, Number.MAX_SAFE_INTEGER),
					},
					null,
					2,
				),
			);
			showToast(t("sync.problemCopied"));
		} catch {
			showToast(t("sync.problemCopyFailed"));
		}
	};

	const queueState = queueStatusLabel(
		sync.kind,
		Boolean(status.dataFlowStatus.uploading),
		queue?.count,
		t,
	);
	const capturedAt = queue?.capturedAt
		? new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(queue.capturedAt)
		: "—";

	return (
		<section aria-labelledby="sync-outbox-title" data-sync-outbox>
			<div
				id="sync-outbox-title"
				className="font-display"
				style={{
					fontSize: 11,
					fontWeight: 700,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					color: list.length ? "var(--w-overdue)" : "var(--w-ink-3)",
					margin: "0 0 8px",
				}}
			>
				{t("sync.outboxTitle")}
			</div>
			<div className="overflow-hidden rounded-xl border border-line bg-card" style={{ marginBottom: 10 }}>
				<div className="flex flex-wrap items-center gap-3 border-line border-b" style={{ padding: 14 }}>
					<QueueMetric value={queue ? String(queue.count) : "–"} label={t("sync.outboxPending")} />
					<QueueMetric value={String(list.length)} label={t("sync.outboxAttention")} danger={list.length > 0} />
					<QueueMetric value={queue ? formatQueueBytes(queue.size, locale) : "–"} label={t("sync.outboxSize")} />
					<div className="min-w-[180px] flex-1 font-body text-ink-3" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
						<div className="font-semibold text-ink-2">{queueState}</div>
						<div>{t("sync.outboxChecked", { time: capturedAt })}</div>
					</div>
					<button
						type="button"
						disabled={refreshing}
						onClick={() => void refresh()}
						aria-label={t("sync.outboxRefresh")}
						className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink-2 hover:border-brass hover:text-brass-text disabled:opacity-50"
					>
						<Icon name="opakovani" size={16} />
					</button>
				</div>

				{queueError ? (
					<p role="status" className="font-body text-overdue" style={{ padding: 14, fontSize: 12 }}>
						{t("sync.outboxLoadError")}
					</p>
				) : queue?.count === 0 && list.length === 0 ? (
					<div data-outbox-empty className="font-body text-ink-3" style={{ padding: 14, fontSize: 12 }}>
						{t("sync.outboxEmpty")}
					</div>
				) : null}

				{queue && queue.operations.length > 0 && (
					<div data-outbox-pending>
						<div className="border-line border-b bg-panel-2 font-display font-bold text-ink" style={{ padding: "9px 14px", fontSize: 12 }}>
							{t("sync.outboxPendingTitle")} ({queue.count})
						</div>
						{queue.operations.map((operation) => (
							<OperationDetails
								key={`pending-${operation.id}`}
								operation={operation}
								status={queueState}
								onOpenTask={operation.table === "tasks" ? () => taskDetail.open(operation.rowId) : undefined}
							/>
						))}
						{(queue.haveMore || queue.count > queue.operations.length) && (
							<div className="border-line border-t font-body text-ink-3" style={{ padding: "9px 14px", fontSize: 11.5 }}>
								{t("sync.outboxAndMore", { count: queue.count - queue.operations.length })}
							</div>
						)}
					</div>
				)}

				{list.length > 0 && (
					<div id="sync-problems-title" data-outbox-rejected>
						<div className="border-line border-y bg-overdue-soft font-display font-bold text-overdue" style={{ padding: "9px 14px", fontSize: 12 }}>
							{t("sync.problemsTitle")} ({list.length})
						</div>
						<p className="border-line border-b font-body text-ink-3" style={{ padding: "10px 14px", fontSize: 11.5, lineHeight: 1.5 }}>
							{t("sync.problemsDesc")}
						</p>
						{list.map((row) => {
							const operation = parseRejectedOperation(row.id, row.table_name ?? "", row.row_id ?? "", row.op ?? "PUT", row.payload);
							return (
								<OperationDetails
									key={row.id}
									open
									operation={operation}
									status={t("sync.outboxRejectedStatus", { code: row.server_code ?? row.http_code ?? "—" })}
									meta={`${formatDate(row.created_at, locale)}${row.request_id ? ` · req:${row.request_id}` : ""}`}
									onOpenTask={operation.table === "tasks" ? () => taskDetail.open(operation.rowId) : undefined}
									actions={
										<>
											<button type="button" disabled={retryingId !== null} onClick={() => void retry(row)} className="min-h-11 rounded-lg border border-line px-3 font-display font-semibold text-brass-text hover:border-brass disabled:opacity-50" style={{ fontSize: 11.5 }}>
												{retryingId === row.id ? t("sync.problemRetrying") : t("sync.problemRetry")}
											</button>
											<button type="button" onClick={() => void copyOne(row)} className="min-h-11 rounded-lg border border-line px-3 font-display font-semibold text-ink-2 hover:border-brass" style={{ fontSize: 11.5 }}>
												{t("sync.problemCopy")}
											</button>
							<button type="button" onClick={() => void discard(row.id)} className="min-h-11 rounded-lg border border-line px-3 font-display font-semibold text-overdue hover:border-overdue" style={{ fontSize: 11.5 }}>
												{t("sync.problemDiscard")}
											</button>
										</>
									}
								/>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
}

function QueueMetric({ value, label, danger = false }: { value: string; label: string; danger?: boolean }) {
	return (
		<div className="min-w-[82px]">
			<div className="font-mono" style={{ fontSize: 20, lineHeight: 1, color: danger ? "var(--w-overdue)" : "var(--w-ink)" }}>{value}</div>
			<div className="mt-1 font-body text-ink-3" style={{ fontSize: 10.5 }}>{label}</div>
		</div>
	);
}

function OperationDetails({
	operation,
	status,
	meta,
	onOpenTask,
	actions,
	open = false,
}: {
	operation: OutboxOperation;
	status: string;
	meta?: string;
	onOpenTask?: () => void;
	actions?: ReactNode;
	open?: boolean;
}) {
	const { t } = useTranslation();
	const fullDiff = operationDiff(operation, Number.MAX_SAFE_INTEGER);
	const diff = fullDiff.slice(0, 8);
	const omitted = fullDiff.length - diff.length;
	const entityKey = ENTITY_KEYS[operation.table];
	const entity = entityKey ? t(`sync.entity.${entityKey}`) : operation.table.replaceAll("_", " ");
	const showBefore = operation.op !== "PUT";
	const showAfter = operation.op !== "DELETE";
	const columns = showBefore && showAfter
		? "minmax(76px, .72fr) minmax(0, 1fr) minmax(0, 1fr)"
		: "minmax(94px, .72fr) minmax(0, 1.6fr)";
	return (
		<details open={open || undefined} data-outbox-operation className="group border-line border-b last:border-b-0">
			<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden hover:bg-panel-2">
				<span aria-hidden className="shrink-0 text-ink-3 transition-transform group-open:rotate-90">›</span>
				<span className="min-w-0 flex-1 font-display font-semibold text-ink" style={{ fontSize: 12.5 }}>
					{t(`sync.operation.${operation.op.toLowerCase()}`)} · {entity}
				</span>
				<span className="max-w-[44%] shrink text-right font-body text-ink-3" style={{ fontSize: 10.5, lineHeight: 1.35 }}>{status}</span>
			</summary>
			<div className="bg-panel-2" style={{ padding: "2px 14px 12px 39px" }}>
				<div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-ink-3" style={{ fontSize: 10 }}>
					<span>{operation.rowId}</span>
					{meta && <span>{meta}</span>}
				</div>
				{diff.length > 0 ? (
					<div data-outbox-diff className="grid overflow-hidden rounded-lg border border-line bg-card" style={{ gridTemplateColumns: columns, fontSize: 10.5 }}>
						<div className="border-line border-b p-2 font-display font-semibold text-ink-3">{t("sync.outboxField")}</div>
						{showBefore && <div className="border-line border-b p-2 font-display font-semibold text-ink-3">{t("sync.outboxBefore")}</div>}
						{showAfter && <div className="border-line border-b p-2 font-display font-semibold text-ink-3">{showBefore ? t("sync.outboxAfter") : t("sync.outboxValue")}</div>}
						{diff.map((item) => (
							<div key={item.field} className="contents">
								<div className="min-w-0 break-words border-line border-b p-2 font-display font-medium text-ink-3 last:border-b-0">
									{FIELD_KEYS[item.field] ? t(`sync.field.${FIELD_KEYS[item.field]}`) : item.field.replaceAll("_", " ")}
								</div>
								{showBefore && <div className="min-w-0 break-words border-line border-b p-2 font-body text-ink-3 last:border-b-0">{item.before}</div>}
								{showAfter && <div className="min-w-0 break-words border-line border-b p-2 font-body text-ink last:border-b-0">{item.after}</div>}
							</div>
						))}
					</div>
				) : (
					<div className="font-body text-ink-3" style={{ fontSize: 11.5 }}>{t("sync.outboxNoDiff")}</div>
				)}
				{omitted > 0 && (
					<div className="mt-2 font-body text-ink-3" style={{ fontSize: 10.5 }}>
						{t("sync.outboxMoreFields", { count: omitted })}
					</div>
				)}
				{(onOpenTask || actions) && (
					<div className="mt-3 flex flex-wrap gap-2">
						{onOpenTask && (
							<button type="button" onClick={onOpenTask} className="min-h-11 rounded-lg border border-line px-3 font-display font-semibold text-ink-2 hover:border-brass" style={{ fontSize: 11.5 }}>
								{t("sync.outboxOpenObject")}
							</button>
						)}
						{actions}
					</div>
				)}
			</div>
		</details>
	);
}

function queueStatusLabel(
	kind: string,
	uploading: boolean,
	count: number | undefined,
	t: (key: string) => string,
): string {
	if (count === 0) return t("sync.outboxQueueClear");
	if (kind === "offline_cached" || kind === "offline_empty") return t("sync.outboxWaitingConnection");
	if (uploading) return t("sync.outboxUploading");
	if (kind === "sync_error") return t("sync.outboxWillRetry");
	return t("sync.outboxWaitingConfirmation");
}

function formatDate(value: string | null, locale: string): string {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? "—"
		: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
