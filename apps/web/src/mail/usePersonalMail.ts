import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/api";

export type PersonalMailAccount = {
	id: string;
	provider: "google" | "imap_smtp";
	emailAddress: string;
	displayName: string | null;
	status: "connected" | "syncing" | "degraded" | "reauth_required" | "revoked";
	lastErrorCode: string | null;
};

export type PersonalSyncState = {
	status: "pending" | "running" | "idle" | "retry" | "dead" | "reauth_required";
	mode: "full" | "partial";
	lastSuccessAt: string | null;
	lastErrorCode: string | null;
	version: number;
};

export type PersonalMailCounts = { total: number; unread: number; inbox: number };

export type PersonalMailOutbound = {
	id: string;
	accountId: string;
	status: "queued" | "sending" | "retry" | "accepted" | "cancelled" | "uncertain" | "failed";
	subject: string | null;
	recipientCount: number | null;
	contentUnavailable: boolean;
	scheduledFor: string;
	undoUntil: string;
	nextAttemptAt: string | null;
	attempts: number;
	providerMessageId: string | null;
	providerThreadId: string | null;
	acceptedAt: string | null;
	cancelledAt: string | null;
	lastErrorCode: string | null;
	version: number;
	createdAt: string;
	canCancel: boolean;
};

export type EnqueuePersonalMailInput = {
	id: string;
	operationId: string;
	accountId: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	textBody: string;
	sendAt: string | null;
};

export type PersonalMailExecution = {
	linkId: string;
	accountId: string;
	messageId: string;
	providerMessageId: string;
	taskId: string;
	projectId: string;
	taskExists: boolean;
	taskName: string | null;
	priority: number | null;
	completedAt: string | null;
	createdAt: string;
};

export type PersonalMailProject = { id: string; name: string; color: string | null };

export type CreateExecutionTaskInput = {
	operationId: string;
	taskId: string;
	projectId: string;
	name: string;
	description?: string | null;
	priority: number;
	dueDate: string | null;
	replaceDeleted?: boolean;
};

export type PersonalMessageSummary = {
	accountId: string;
	id: string;
	providerMessageId: string;
	threadId: string;
	historyId: string;
	internalDate: string;
	labelIds: string[];
	sizeEstimate: number;
	contentTruncated: boolean;
	subject: string;
	from: string;
	to: string[];
	cc: string[];
	replyTo: string;
	dateHeader: string;
	snippet: string;
	hasText: boolean;
	hasHtml: boolean;
	attachmentCount: number;
};

export type PersonalMessageDetail = Omit<PersonalMessageSummary, "hasText" | "attachmentCount"> & {
	textBody: string;
	security: {
		level: "danger" | "warning" | "verified" | "unknown";
		reasons: string[];
		fromDomain: string | null;
		replyDomain: string | null;
		returnDomain: string | null;
		authentication: { spf: "pass" | "fail" | "unknown"; dkim: "pass" | "fail" | "unknown"; dmarc: "pass" | "fail" | "unknown" };
	};
	attachments: Array<{
		filename: string;
		mimeType: string;
		size: number;
		attachmentId: string | null;
	}>;
};

type AccountRuntime = {
	sync: PersonalSyncState | null;
	counts: PersonalMailCounts;
};

const EMPTY_COUNTS: PersonalMailCounts = { total: 0, unread: 0, inbox: 0 };

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, credentials: "include" });
	const body = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? `mail_http_${response.status}`);
	return body;
}

const messageKey = (message: Pick<PersonalMessageSummary, "accountId" | "id">) =>
	`${message.accountId}:${message.id}`;

function mergeMessages(current: PersonalMessageSummary[], incoming: PersonalMessageSummary[]) {
	const merged = new Map(current.map((message) => [messageKey(message), message]));
	for (const message of incoming) merged.set(messageKey(message), message);
	return [...merged.values()].sort((a, b) => {
		const byDate = Date.parse(b.internalDate) - Date.parse(a.internalDate);
		return byDate || messageKey(a).localeCompare(messageKey(b));
	});
}

export type PersonalMailModel = ReturnType<typeof usePersonalMail>;

export function usePersonalMail(enabled: boolean) {
	const [accounts, setAccounts] = useState<PersonalMailAccount[]>([]);
	const [runtime, setRuntime] = useState<Record<string, AccountRuntime>>({});
	const [executions, setExecutions] = useState<Record<string, PersonalMailExecution>>({});
	const [outbound, setOutbound] = useState<PersonalMailOutbound[]>([]);
	const [projects, setProjects] = useState<Record<string, PersonalMailProject[]>>({});
	const [messages, setMessages] = useState<PersonalMessageSummary[]>([]);
	const [cursors, setCursors] = useState<Record<string, string | null>>({});
	const [accountFilter, setAccountFilter] = useState<string>("all");
	const [selected, setSelected] = useState<{ accountId: string; messageId: string } | null>(null);
	const [detail, setDetail] = useState<PersonalMessageDetail | null>(null);
	const [loadingAccounts, setLoadingAccounts] = useState(true);
	const [loadingMessages, setLoadingMessages] = useState(false);
	const [loadingDetail, setLoadingDetail] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [creatingTask, setCreatingTask] = useState(false);
	const [sendingMail, setSendingMail] = useState(false);
	const [cancellingOutboundId, setCancellingOutboundId] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const firstPagesLoadedFor = useRef("");
	const hasLoadedPages = useRef(false);
	const cancelOperations = useRef<Record<string, string>>({});

	const activeAccounts = useMemo(
		() => accounts.filter((account) => account.status !== "revoked"),
		[accounts],
	);
	const accountIds = activeAccounts.map((account) => account.id).join(",");

	const loadAccounts = useCallback(async () => {
		setLoadingAccounts(true);
		try {
			const result = await readJson<{ accounts: PersonalMailAccount[] }>(`${API_URL}/api/mail/accounts`);
			setAccounts(result.accounts);
			setError(null);
			return result.accounts.filter((account) => account.status !== "revoked");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_accounts_unavailable");
			return [];
		} finally {
			setLoadingAccounts(false);
		}
	}, []);

	const loadRuntime = useCallback(async (targets: PersonalMailAccount[]) => {
		const entries = await Promise.all(
			targets.map(async (account) => {
				try {
					const result = await readJson<{
						sync: PersonalSyncState | null;
						counts: PersonalMailCounts;
					}>(`${API_URL}/api/mail/accounts/${account.id}/sync`);
					return [account.id, { sync: result.sync, counts: result.counts }] as const;
				} catch {
					return [account.id, { sync: null, counts: EMPTY_COUNTS }] as const;
				}
			}),
		);
		setRuntime(Object.fromEntries(entries));
	}, []);

	const loadExecutions = useCallback(async (targets: PersonalMailAccount[]) => {
		const results = await Promise.allSettled(
			targets.map(async (account) => {
				const result = await readJson<{
					executions: PersonalMailExecution[];
					projects: PersonalMailProject[];
				}>(`${API_URL}/api/mail/accounts/${account.id}/executions`);
				return { accountId: account.id, ...result };
			}),
		);
		const successful = results.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		setExecutions((current) => {
			const successfulIds = new Set(successful.map((entry) => entry.accountId));
			const next = Object.fromEntries(
				Object.entries(current).filter(([, execution]) => !successfulIds.has(execution.accountId)),
			);
			for (const entry of successful) {
				for (const execution of entry.executions) {
					next[`${execution.accountId}:${execution.providerMessageId}`] = execution;
				}
			}
			return next;
		});
		setProjects((current) => ({
			...current,
			...Object.fromEntries(successful.map((entry) => [entry.accountId, entry.projects])),
		}));
	}, []);

	const loadOutbound = useCallback(async (targets: PersonalMailAccount[]) => {
		const results = await Promise.allSettled(
			targets.map(async (account) => {
				const result = await readJson<{ outbound: PersonalMailOutbound[] }>(
					`${API_URL}/api/mail/accounts/${account.id}/outbound?limit=30`,
				);
				return result.outbound;
			}),
		);
		const successful = results.flatMap((result) =>
			result.status === "fulfilled" ? result.value : [],
		);
		setOutbound(
			successful.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)),
		);
	}, []);

	const loadFirstPages = useCallback(async (targets: PersonalMailAccount[]) => {
		const foreground = !hasLoadedPages.current;
		if (foreground) setLoadingMessages(true);
		try {
			const results = await Promise.allSettled(
				targets.map(async (account) => {
					const result = await readJson<{ messages: Omit<PersonalMessageSummary, "accountId">[]; nextCursor: string | null }>(
						`${API_URL}/api/mail/accounts/${account.id}/messages?limit=25`,
					);
					return {
						accountId: account.id,
						messages: result.messages.map((message) => ({ ...message, accountId: account.id })),
						nextCursor: result.nextCursor,
					};
				}),
			);
			const pages = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
			const failedAccountIds = new Set(
				results.flatMap((result, index) => result.status === "rejected" ? [targets[index]?.id ?? ""] : []),
			);
			if (pages.length === 0 && targets.length > 0) {
				const rejected = results.find((result) => result.status === "rejected");
				throw rejected?.status === "rejected" ? rejected.reason : new Error("mail_messages_unavailable");
			}
			setMessages((current) => mergeMessages(
				current.filter((message) => failedAccountIds.has(message.accountId)),
				pages.flatMap((page) => page.messages),
			));
			setCursors((current) => ({
				...Object.fromEntries([...failedAccountIds].map((accountId) => [accountId, current[accountId] ?? null])),
				...Object.fromEntries(pages.map((page) => [page.accountId, page.nextCursor])),
			}));
			hasLoadedPages.current = true;
			setError(failedAccountIds.size > 0 ? "mail_messages_partial" : null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_messages_unavailable");
		} finally {
			if (foreground) setLoadingMessages(false);
		}
	}, []);

	useEffect(() => {
		void loadAccounts().then((targets) =>
			Promise.all([loadRuntime(targets), loadExecutions(targets), loadOutbound(targets)]),
		);
	}, [loadAccounts, loadExecutions, loadOutbound, loadRuntime]);

	useEffect(() => {
		if (!enabled || !accountIds || firstPagesLoadedFor.current === accountIds) return;
		firstPagesLoadedFor.current = accountIds;
		void loadFirstPages(activeAccounts);
	}, [enabled, accountIds, activeAccounts, loadFirstPages]);

	useEffect(() => {
		if (
			!enabled ||
			!activeAccounts.some((account) => {
				const status = runtime[account.id]?.sync?.status;
				return status === "pending" || status === "running";
			})
		) return;
		const timer = window.setTimeout(() => {
			void Promise.all([
				loadRuntime(activeAccounts),
				loadExecutions(activeAccounts),
				loadOutbound(activeAccounts),
				loadFirstPages(activeAccounts),
			]);
		}, 2_000);
		return () => window.clearTimeout(timer);
	}, [enabled, activeAccounts, runtime, loadExecutions, loadFirstPages, loadOutbound, loadRuntime]);

	useEffect(() => {
		if (
			!enabled ||
			!outbound.some((message) =>
				message.status === "queued" || message.status === "sending" || message.status === "retry",
			)
		) return;
		const timer = window.setTimeout(() => void loadOutbound(activeAccounts), 1_000);
		return () => window.clearTimeout(timer);
	}, [activeAccounts, enabled, loadOutbound, outbound]);

	useEffect(() => {
		if (accountFilter === "all" || activeAccounts.some((account) => account.id === accountFilter)) return;
		setAccountFilter("all");
	}, [accountFilter, activeAccounts]);

	useEffect(() => {
		if (!selected || activeAccounts.some((account) => account.id === selected.accountId)) return;
		setSelected(null);
		setDetail(null);
	}, [activeAccounts, selected]);

	// Provider polling běží na serveru. Otevřený inbox si jednou za minutu jen
	// obnoví owner-only read model, aby nová pošta dorazila bez reloadu stránky.
	useEffect(() => {
		if (!enabled || activeAccounts.length === 0) return;
		const timer = window.setInterval(() => {
			void Promise.all([
				loadRuntime(activeAccounts),
				loadExecutions(activeAccounts),
				loadOutbound(activeAccounts),
				loadFirstPages(activeAccounts),
			]);
		}, 60_000);
		return () => window.clearInterval(timer);
	}, [activeAccounts, enabled, loadExecutions, loadFirstPages, loadOutbound, loadRuntime]);

	const visibleMessages = useMemo(
		() =>
			accountFilter === "all"
				? messages
				: messages.filter((message) => message.accountId === accountFilter),
		[accountFilter, messages],
	);
	const visibleAccounts = useMemo(
		() =>
			accountFilter === "all"
				? activeAccounts
				: activeAccounts.filter((account) => account.id === accountFilter),
		[accountFilter, activeAccounts],
	);
	const unreadCount = visibleAccounts.reduce(
		(sum, account) => sum + (runtime[account.id]?.counts.unread ?? 0),
		0,
	);
	const totalCount = visibleAccounts.reduce(
		(sum, account) => sum + (runtime[account.id]?.counts.total ?? 0),
		0,
	);
	const hasMore = visibleAccounts.some((account) => Boolean(cursors[account.id]));

	const openMessageById = useCallback(async (accountId: string, messageId: string) => {
		setSelected({ accountId, messageId });
		setDetail(null);
		setLoadingDetail(true);
		setError(null);
		try {
			const result = await readJson<{ message: Omit<PersonalMessageDetail, "accountId"> }>(
				`${API_URL}/api/mail/accounts/${accountId}/messages/${messageId}`,
			);
			setDetail({ ...result.message, accountId });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_message_unavailable");
		} finally {
			setLoadingDetail(false);
		}
	}, []);

	const openMessage = useCallback(
		(message: PersonalMessageSummary) => openMessageById(message.accountId, message.id),
		[openMessageById],
	);

	const closeMessage = useCallback(() => {
		setSelected(null);
		setDetail(null);
	}, []);

	const refresh = useCallback(async () => {
		const targets = await loadAccounts();
		await Promise.all([
			loadRuntime(targets),
			loadExecutions(targets),
			loadOutbound(targets),
			enabled ? loadFirstPages(targets) : Promise.resolve(),
		]);
	}, [enabled, loadAccounts, loadExecutions, loadFirstPages, loadOutbound, loadRuntime]);

	const executionFor = useCallback(
		(message: Pick<PersonalMessageSummary, "accountId" | "providerMessageId">) =>
			executions[`${message.accountId}:${message.providerMessageId}`] ?? null,
		[executions],
	);

	const createExecutionTask = useCallback(
		async (message: PersonalMessageSummary, input: CreateExecutionTaskInput) => {
			if (creatingTask) throw new Error("mail_execution_busy");
			setCreatingTask(true);
			setError(null);
			try {
				const result = await readJson<{ execution: PersonalMailExecution; replayed: boolean }>(
					`${API_URL}/api/mail/accounts/${message.accountId}/messages/${message.id}/execution-task`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(input),
					},
				);
				setExecutions((current) => ({
					...current,
					[`${result.execution.accountId}:${result.execution.providerMessageId}`]: result.execution,
				}));
				return result.execution;
			} catch (cause) {
				const code = cause instanceof Error ? cause.message : "mail_execution_unavailable";
				setError(code);
				await loadExecutions(activeAccounts);
				throw cause;
			} finally {
				setCreatingTask(false);
			}
		},
		[activeAccounts, creatingTask, loadExecutions],
	);

	const requestSync = useCallback(async () => {
		const targets = visibleAccounts.filter((account) => account.status === "connected");
		if (!targets.length || syncing) return;
		setSyncing(true);
		setError(null);
		try {
			await Promise.all(
				targets.map((account) =>
					readJson(`${API_URL}/api/mail/accounts/${account.id}/sync`, { method: "POST" }),
				),
			);
			setRuntime((current) => {
				const next = { ...current };
				for (const account of targets) {
					const previous = next[account.id];
					next[account.id] = {
						counts: previous?.counts ?? EMPTY_COUNTS,
						sync: previous?.sync
							? { ...previous.sync, status: "pending", lastErrorCode: null }
							: null,
					};
				}
				return next;
			});
			window.setTimeout(() => void refresh(), 1_500);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_sync_unavailable");
		} finally {
			setSyncing(false);
		}
	}, [refresh, syncing, visibleAccounts]);

	const enqueueOutbound = useCallback(
		async (input: EnqueuePersonalMailInput) => {
			if (sendingMail) throw new Error("mail_outbound_busy");
			setSendingMail(true);
			setError(null);
			try {
				const result = await readJson<{ outbound: PersonalMailOutbound; replayed: boolean }>(
					`${API_URL}/api/mail/accounts/${input.accountId}/outbound`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							id: input.id,
							operationId: input.operationId,
							to: input.to,
							cc: input.cc,
							bcc: input.bcc,
							subject: input.subject,
							textBody: input.textBody,
							sendAt: input.sendAt,
						}),
					},
				);
				setOutbound((current) => [
					result.outbound,
					...current.filter((message) => message.id !== result.outbound.id),
				]);
				return result.outbound;
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : "mail_outbound_unavailable");
				throw cause;
			} finally {
				setSendingMail(false);
			}
		},
		[sendingMail],
	);

	const cancelOutbound = useCallback(
		async (message: PersonalMailOutbound) => {
			if (cancellingOutboundId) return;
			setCancellingOutboundId(message.id);
			setError(null);
			const operationId = cancelOperations.current[message.id] ?? crypto.randomUUID();
			cancelOperations.current[message.id] = operationId;
			try {
				const result = await readJson<{ outbound: Pick<PersonalMailOutbound, "id" | "status" | "version"> }>(
					`${API_URL}/api/mail/accounts/${message.accountId}/outbound/${message.id}/cancel`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							operationId,
							expectedVersion: message.version,
						}),
					},
				);
				setOutbound((current) =>
					current.map((item) =>
						item.id === message.id
							? { ...item, status: result.outbound.status, version: result.outbound.version, canCancel: false }
							: item,
					),
				);
				delete cancelOperations.current[message.id];
				await loadOutbound(activeAccounts);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : "mail_outbound_unavailable");
				await loadOutbound(activeAccounts);
				throw cause;
			} finally {
				setCancellingOutboundId(null);
			}
		},
		[activeAccounts, cancellingOutboundId, loadOutbound],
	);

	const loadMore = useCallback(async () => {
		const targets = visibleAccounts.filter((account) => Boolean(cursors[account.id]));
		if (!targets.length || loadingMore) return;
		setLoadingMore(true);
		setError(null);
		try {
			const results = await Promise.allSettled(
				targets.map(async (account) => {
					const result = await readJson<{ messages: Omit<PersonalMessageSummary, "accountId">[]; nextCursor: string | null }>(
						`${API_URL}/api/mail/accounts/${account.id}/messages?limit=25&cursor=${encodeURIComponent(cursors[account.id] ?? "")}`,
					);
					return {
						accountId: account.id,
						messages: result.messages.map((message) => ({ ...message, accountId: account.id })),
						nextCursor: result.nextCursor,
					};
				}),
			);
			const pages = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
			if (pages.length === 0) {
				const rejected = results.find((result) => result.status === "rejected");
				throw rejected?.status === "rejected" ? rejected.reason : new Error("mail_messages_unavailable");
			}
			setMessages((current) => mergeMessages(current, pages.flatMap((page) => page.messages)));
			setCursors((current) => ({
				...current,
				...Object.fromEntries(pages.map((page) => [page.accountId, page.nextCursor])),
			}));
			setError(pages.length === targets.length ? null : "mail_messages_partial");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_messages_unavailable");
		} finally {
			setLoadingMore(false);
		}
	}, [cursors, loadingMore, visibleAccounts]);

	return {
		accounts: activeAccounts,
		runtime,
		executions,
		outbound,
		projects,
		messages: visibleMessages,
		accountFilter,
		setAccountFilter,
		selected,
		detail,
		loadingAccounts,
		loadingMessages,
		loadingDetail,
		loadingMore,
		syncing,
		creatingTask,
		sendingMail,
		cancellingOutboundId,
		error,
		unreadCount,
		totalCount,
		hasMore,
		openMessage,
		openMessageById,
		closeMessage,
		refresh,
		requestSync,
		loadMore,
		executionFor,
		createExecutionTask,
		enqueueOutbound,
		cancelOutbound,
	};
}
