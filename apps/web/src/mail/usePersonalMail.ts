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
	const [messages, setMessages] = useState<PersonalMessageSummary[]>([]);
	const [cursors, setCursors] = useState<Record<string, string | null>>({});
	const [accountFilter, setAccountFilter] = useState<string>("all");
	const [selected, setSelected] = useState<{ accountId: string; messageId: string } | null>(null);
	const [detail, setDetail] = useState<PersonalMessageDetail | null>(null);
	const [loadingAccounts, setLoadingAccounts] = useState(true);
	const [loadingMessages, setLoadingMessages] = useState(false);
	const [loadingDetail, setLoadingDetail] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const firstPagesLoadedFor = useRef("");
	const hasLoadedPages = useRef(false);

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
		void loadAccounts().then(loadRuntime);
	}, [loadAccounts, loadRuntime]);

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
			void Promise.all([loadRuntime(activeAccounts), loadFirstPages(activeAccounts)]);
		}, 2_000);
		return () => window.clearTimeout(timer);
	}, [enabled, activeAccounts, runtime, loadFirstPages, loadRuntime]);

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
			void Promise.all([loadRuntime(activeAccounts), loadFirstPages(activeAccounts)]);
		}, 60_000);
		return () => window.clearInterval(timer);
	}, [activeAccounts, enabled, loadFirstPages, loadRuntime]);

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

	const openMessage = useCallback(async (message: PersonalMessageSummary) => {
		setSelected({ accountId: message.accountId, messageId: message.id });
		setDetail(null);
		setLoadingDetail(true);
		setError(null);
		try {
			const result = await readJson<{ message: Omit<PersonalMessageDetail, "accountId"> }>(
				`${API_URL}/api/mail/accounts/${message.accountId}/messages/${message.id}`,
			);
			setDetail({ ...result.message, accountId: message.accountId });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_message_unavailable");
		} finally {
			setLoadingDetail(false);
		}
	}, []);

	const closeMessage = useCallback(() => {
		setSelected(null);
		setDetail(null);
	}, []);

	const refresh = useCallback(async () => {
		const targets = await loadAccounts();
		await Promise.all([loadRuntime(targets), enabled ? loadFirstPages(targets) : Promise.resolve()]);
	}, [enabled, loadAccounts, loadFirstPages, loadRuntime]);

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
		error,
		unreadCount,
		totalCount,
		hasMore,
		openMessage,
		closeMessage,
		refresh,
		requestSync,
		loadMore,
	};
}
