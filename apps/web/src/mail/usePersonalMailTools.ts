import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../lib/api";

export type PersonalMailSearchHit = {
	accountId: string;
	accountLabel: string;
	id: string;
	providerMessageId: string;
	threadId: string;
	internalDate: string;
	labelIds: string[];
	labelNames: string[];
	subject: string;
	from: string;
	to: string[];
	snippet: string;
	attachmentCount: number;
};

export type PersonalMailView = {
	id: string;
	name: string;
	query: string;
	sort: "newest" | "oldest" | "sender" | "subject";
	version: number;
};

export type PersonalMailLabel = {
	accountId: string;
	providerLabelId: string;
	name: string;
	kind: "system" | "user" | "folder";
	color: string | null;
};

export type PersonalMailFollowup = {
	id: string;
	accountId: string;
	outboundId: string;
	subject: string | null;
	dueAt: string;
	status: "waiting" | "replied" | "done" | "cancelled";
	completedAt: string | null;
	version: number;
};

export type PersonalMailAnalytics = {
	rangeDays: number;
	total: number;
	unread: number;
	inbox: number;
	waitingOver24h: number;
	overdueFollowups: number;
	outboundAccepted: number;
	byAccount: Array<{
		accountId: string;
		accountLabel: string;
		emailAddress: string;
		total: number;
		unread: number;
		inbox: number;
		waitingOver24h: number;
	}>;
	note?: string;
};

export type PersonalMailPerson = {
	address: string;
	name: string;
	organization: string | null;
	role: string | null;
	areas: string | null;
	note: string | null;
	domain: string;
	messages: number;
	lastContactAt: string | null;
	contactId: string | null;
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, credentials: "include" });
	const body = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? `mail_http_${response.status}`);
	return body;
}

function sortHits(hits: PersonalMailSearchHit[], sort: PersonalMailView["sort"]) {
	return [...hits].sort((a, b) => {
		if (sort === "oldest") return Date.parse(a.internalDate) - Date.parse(b.internalDate);
		if (sort === "sender") return a.from.localeCompare(b.from, "cs");
		if (sort === "subject") return a.subject.localeCompare(b.subject, "cs");
		return Date.parse(b.internalDate) - Date.parse(a.internalDate);
	});
}

export function usePersonalMailTools(enabled: boolean) {
	const [views, setViews] = useState<PersonalMailView[]>([]);
	const [labels, setLabels] = useState<PersonalMailLabel[]>([]);
	const [followups, setFollowups] = useState<PersonalMailFollowup[]>([]);
	const [analytics, setAnalytics] = useState<PersonalMailAnalytics | null>(null);
	const [searchHits, setSearchHits] = useState<PersonalMailSearchHit[]>([]);
	const [searching, setSearching] = useState(false);
	const [searchMeta, setSearchMeta] = useState({ searchedCount: 0, truncated: false, skippedCorrupt: 0 });
	const [error, setError] = useState<string | null>(null);

	const refreshTools = useCallback(async () => {
		const results = await Promise.allSettled([
			readJson<{ views: PersonalMailView[] }>(`${API_URL}/api/mail/views`),
			readJson<{ labels: PersonalMailLabel[] }>(`${API_URL}/api/mail/labels`),
			readJson<{ followups: PersonalMailFollowup[] }>(`${API_URL}/api/mail/followups`),
			readJson<PersonalMailAnalytics>(`${API_URL}/api/mail/analytics?days=30`),
		]);
		if (results[0]?.status === "fulfilled") setViews(results[0].value.views);
		if (results[1]?.status === "fulfilled") setLabels(results[1].value.labels);
		if (results[2]?.status === "fulfilled") setFollowups(results[2].value.followups);
		if (results[3]?.status === "fulfilled") setAnalytics(results[3].value);
		const failed = results.find((result) => result.status === "rejected");
		setError(failed?.status === "rejected" && failed.reason instanceof Error ? failed.reason.message : null);
	}, []);

	useEffect(() => {
		if (!enabled) return;
		void refreshTools();
	}, [enabled, refreshTools]);

	const search = useCallback(async (query: string, sort: PersonalMailView["sort"] = "newest") => {
		if (!query.trim()) {
			setSearchHits([]);
			setSearchMeta({ searchedCount: 0, truncated: false, skippedCorrupt: 0 });
			return;
		}
		setSearching(true);
		setError(null);
		try {
			const result = await readJson<{
				messages: PersonalMailSearchHit[];
				searchedCount: number;
				truncated: boolean;
				skippedCorrupt: number;
			}>(`${API_URL}/api/mail/search?q=${encodeURIComponent(query)}&limit=50`);
			setSearchHits(sortHits(result.messages, sort));
			setSearchMeta({
				searchedCount: result.searchedCount,
				truncated: result.truncated,
				skippedCorrupt: result.skippedCorrupt,
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_search_unavailable");
		} finally {
			setSearching(false);
		}
	}, []);

	const createView = useCallback(async (name: string, query: string, sort: PersonalMailView["sort"]) => {
		const result = await readJson<{ view: PersonalMailView }>(`${API_URL}/api/mail/views`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: crypto.randomUUID(), name, query, sort }),
		});
		setViews((current) => [result.view, ...current.filter((view) => view.id !== result.view.id)]);
		return result.view;
	}, []);

	const deleteView = useCallback(async (view: PersonalMailView) => {
		await readJson(`${API_URL}/api/mail/views/${view.id}?expectedVersion=${view.version}`, { method: "DELETE" });
		setViews((current) => current.filter((item) => item.id !== view.id));
	}, []);

	const scheduleFollowup = useCallback(async (accountId: string, outboundId: string, dueAt: string) => {
		const result = await readJson<{ followup: PersonalMailFollowup }>(
			`${API_URL}/api/mail/accounts/${accountId}/outbound/${outboundId}/followup`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ dueAt }),
			},
		);
		setFollowups((current) => [result.followup, ...current.filter((item) => item.id !== result.followup.id)]);
		return result.followup;
	}, []);

	const completeFollowup = useCallback(async (followup: PersonalMailFollowup, status: "done" | "cancelled") => {
		const result = await readJson<{ followup: PersonalMailFollowup }>(`${API_URL}/api/mail/followups/${followup.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status, expectedVersion: followup.version }),
		});
		setFollowups((current) => current.map((item) => item.id === followup.id ? result.followup : item));
	}, []);

	const lookupPerson = useCallback(async (address: string) => {
		const result = await readJson<{ person: PersonalMailPerson }>(
			`${API_URL}/api/mail/people/lookup?address=${encodeURIComponent(address)}`,
		);
		return result.person;
	}, []);

	return {
		views,
		labels,
		followups,
		analytics,
		searchHits,
		searching,
		searchMeta,
		error,
		search,
		createView,
		deleteView,
		scheduleFollowup,
		completeFollowup,
		lookupPerson,
		refreshTools,
	};
}
