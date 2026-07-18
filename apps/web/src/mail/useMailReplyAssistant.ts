import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../lib/api";

export type MailReplyAiPolicy = {
	enabled: boolean;
	dailyLimit: number;
	available: boolean;
	provider: string | null;
	mock: boolean;
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, credentials: "include" });
	const body = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? `mail_ai_http_${response.status}`);
	return body;
}

export function useMailReplyAssistant(accountId: string, messageId: string | null) {
	const [policy, setPolicy] = useState<MailReplyAiPolicy | null>(null);
	const [suggestion, setSuggestion] = useState<string | null>(null);
	const [loadingPolicy, setLoadingPolicy] = useState(false);
	const [updatingPolicy, setUpdatingPolicy] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refreshPolicy = useCallback(async () => {
		if (!accountId || !messageId) return;
		setLoadingPolicy(true);
		setError(null);
		try {
			const result = await readJson<{ policy: MailReplyAiPolicy }>(
				`${API_URL}/api/mail/accounts/${accountId}/reply-ai-policy`,
			);
			setPolicy(result.policy);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_ai_policy_unavailable");
		} finally {
			setLoadingPolicy(false);
		}
	}, [accountId, messageId]);

	useEffect(() => {
		setPolicy(null);
		setSuggestion(null);
		if (accountId && messageId) void refreshPolicy();
	}, [accountId, messageId, refreshPolicy]);

	const setEnabled = useCallback(async (enabled: boolean) => {
		if (!accountId || !messageId) throw new Error("mail_ai_reply_unavailable");
		setUpdatingPolicy(true);
		setError(null);
		try {
			const result = await readJson<{ policy: MailReplyAiPolicy }>(
				`${API_URL}/api/mail/accounts/${accountId}/reply-ai-policy`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ enabled, dailyLimit: 20 }),
				},
			);
			setPolicy(result.policy);
			if (!enabled) setSuggestion(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_ai_policy_unavailable");
			throw cause;
		} finally {
			setUpdatingPolicy(false);
		}
	}, [accountId, messageId]);

	const generate = useCallback(async (instruction: string) => {
		if (!accountId || !messageId) throw new Error("mail_ai_reply_unavailable");
		setGenerating(true);
		setError(null);
		try {
			const result = await readJson<{ suggestion: string; mock: boolean; provider: string | null }>(
				`${API_URL}/api/mail/accounts/${accountId}/messages/${messageId}/reply-suggestion`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ vendorConsent: true, instruction: instruction.trim() || null }),
				},
			);
			setSuggestion(result.suggestion);
			return result.suggestion;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_ai_provider_unavailable");
			throw cause;
		} finally {
			setGenerating(false);
		}
	}, [accountId, messageId]);

	return {
		policy,
		suggestion,
		loadingPolicy,
		updatingPolicy,
		generating,
		error,
		refreshPolicy,
		setEnabled,
		generate,
		discardSuggestion: () => setSuggestion(null),
	};
}
