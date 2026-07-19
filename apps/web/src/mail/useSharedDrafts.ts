import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../lib/api";

export type SharedDraftContent = { to: string[]; cc: string[]; bcc: string[]; subject: string; textBody: string };
export type SharedDraft = {
	id: string;
	workspaceId: string;
	accountId: string;
	ownerUserId: string;
	status: "draft" | "pending_approval" | "approved" | "rejected" | "queued" | "cancelled";
	requiredApprovals: number;
	content: SharedDraftContent | null;
	contentUnavailable: boolean;
	contentVersion: number;
	version: number;
	submittedAt: string | null;
	approvedAt: string | null;
	queuedAt: string | null;
	outboundId: string | null;
	outboundStatus: string | null;
	updatedAt: string;
	viewerRole: "owner" | "editor" | "approver";
	viewerApproval: { approverUserId: string; status: "pending" | "approved" | "rejected"; decidedAt: string | null; decidedContentVersion: number | null; name: string } | null;
	members: Array<{ userId: string; role: "editor" | "approver"; name: string; email: string }>;
	approvals: Array<{ approverUserId: string; status: "pending" | "approved" | "rejected"; decidedAt: string | null; decidedContentVersion: number | null; name: string }>;
};

export type SharedDraftOptions = {
	workspaces: Array<{
		id: string;
		name: string;
		members: Array<{ workspaceId: string; userId: string; name: string; email: string }>;
	}>;
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, credentials: "include" });
	const body = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? `mail_http_${response.status}`);
	return body;
}

export function useSharedDrafts(enabled: boolean) {
	const [drafts, setDrafts] = useState<SharedDraft[]>([]);
	const [options, setOptions] = useState<SharedDraftOptions>({ workspaces: [] });
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async (foreground = false) => {
		if (foreground) setLoading(true);
		try {
			const [draftResult, optionResult] = await Promise.all([
				readJson<{ drafts: SharedDraft[] }>(`${API_URL}/api/mail/shared-drafts`),
				readJson<SharedDraftOptions>(`${API_URL}/api/mail/shared-drafts/options`),
			]);
			setDrafts(draftResult.drafts);
			setOptions(optionResult);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_shared_drafts_unavailable");
		} finally {
			if (foreground) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		void refresh(true);
		const timer = window.setInterval(() => void refresh(), 15_000);
		return () => window.clearInterval(timer);
	}, [enabled, refresh]);

	const run = useCallback(async (operation: () => Promise<SharedDraft>) => {
		setBusy(true);
		setError(null);
		try {
			const draft = await operation();
			setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
			return draft;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_shared_draft_operation_failed");
			throw cause;
		} finally {
			setBusy(false);
		}
	}, []);

	const create = useCallback((input: {
		id: string; workspaceId: string; accountId: string; content: SharedDraftContent;
		editors: string[]; approvers: string[]; requiredApprovals: number;
	}) => run(async () => (await readJson<{ draft: SharedDraft }>(`${API_URL}/api/mail/shared-drafts`, {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
	})).draft), [run]);

	const update = useCallback((draft: SharedDraft, content: SharedDraftContent) => run(async () => (
		await readJson<{ draft: SharedDraft }>(`${API_URL}/api/mail/shared-drafts/${draft.id}`, {
			method: "PUT", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content, expectedVersion: draft.version }),
		})
	).draft), [run]);

	const submit = useCallback((draft: SharedDraft) => run(async () => (
		await readJson<{ draft: SharedDraft }>(`${API_URL}/api/mail/shared-drafts/${draft.id}/submit`, {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedVersion: draft.version }),
		})
	).draft), [run]);

	const decide = useCallback((draft: SharedDraft, decision: "approved" | "rejected") => run(async () => (
		await readJson<{ draft: SharedDraft }>(`${API_URL}/api/mail/shared-drafts/${draft.id}/decision`, {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ decision, expectedVersion: draft.version }),
		})
	).draft), [run]);

	const cancel = useCallback((draft: SharedDraft) => run(async () => (
		await readJson<{ draft: SharedDraft }>(`${API_URL}/api/mail/shared-drafts/${draft.id}/cancel`, {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedVersion: draft.version }),
		})
	).draft), [run]);

	const send = useCallback((draft: SharedDraft) => run(async () => (
		await readJson<{ draft: SharedDraft }>(`${API_URL}/api/mail/shared-drafts/${draft.id}/send`, {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedVersion: draft.version, outboundId: crypto.randomUUID(), operationId: crypto.randomUUID() }),
		})
	).draft), [run]);

	return { drafts, options, loading, busy, error, refresh, create, update, submit, decide, cancel, send };
}
