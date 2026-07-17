import { useQuery } from "@tanstack/react-query";
import { API_URL } from "../lib/api";

export type KnowledgeArticleType = "guide" | "sop" | "policy";
export type KnowledgeAudience = "team" | "all_workspace_members";
export type KnowledgeState = "draft" | "published" | "archived";
export type KnowledgeSection = { id: string; title: string; body: string };
export type KnowledgeMember = { id: string; name: string; role: string; isOwner: boolean };

export type KnowledgeSummary = {
	id: string;
	slug: string;
	state: KnowledgeState;
	articleType: KnowledgeArticleType;
	title: string;
	summary: string | null;
	tags: string[];
	audience: KnowledgeAudience;
	acknowledgementRequired: boolean;
	ownerUserId: string | null;
	ownerName: string | null;
	draftRevision?: number;
	publishedVersion: number;
	publishedAt: string | null;
	updatedAt: string;
	hasUnpublishedChanges: boolean;
	acknowledgedByMe: boolean;
};

export type KnowledgeContent = {
	articleType: KnowledgeArticleType;
	title: string;
	summary: string | null;
	tags: string[];
	sections: KnowledgeSection[];
	audience: KnowledgeAudience;
	acknowledgementRequired: boolean;
	ownerUserId: string | null;
};

export type KnowledgeDetail = {
	canManage: boolean;
	article: {
		id: string;
		workspaceId: string;
		slug: string;
		state: KnowledgeState;
		draftRevision?: number;
		publishedVersion: number;
		publishedAt: string | null;
		updatedAt: string;
		owner: { id: string; name: string } | null;
		draft?: KnowledgeContent;
		published: (KnowledgeContent & {
			version: number;
			draftRevision: number;
			publishedAt: string;
		}) | null;
		acknowledgement: {
			required: boolean;
			acknowledgedByMe: boolean;
			eligibleCount?: number | null;
			acknowledgedCount?: number;
		} | null;
		versions?: Array<{
			version: number;
			draftRevision: number;
			title: string;
			changeNote: string | null;
			publishedAt: string;
			publishedByName: string;
			acknowledgementRequired: boolean;
			acknowledgedCount: number;
		}>;
	};
};

export async function knowledgeJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
	const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok) {
		const error = new Error(String(payload.error ?? `HTTP ${response.status}`));
		(error as Error & { code?: string }).code = String(payload.error ?? "knowledge_unavailable");
		throw error;
	}
	return payload as T;
}

export function useKnowledgeList(input: {
	workspaceId: string | null;
	mode: "published" | "manage";
	query: string;
	type: KnowledgeArticleType | "all";
}) {
	return useQuery({
		queryKey: ["knowledge", "list", input.workspaceId, input.mode, input.query, input.type],
		enabled: Boolean(input.workspaceId),
		queryFn: async () => {
			const params = new URLSearchParams({
				workspaceId: input.workspaceId ?? "",
				view: input.mode,
			});
			if (input.query) params.set("q", input.query);
			if (input.type !== "all") params.set("type", input.type);
			return knowledgeJson<{
				canManage: boolean;
				mode: "published" | "manage";
				articles: KnowledgeSummary[];
			}>(`/api/knowledge?${params}`);
		},
	});
}

export function useKnowledgeDetail(workspaceId: string | null, articleId: string | null) {
	return useQuery({
		queryKey: ["knowledge", "detail", workspaceId, articleId],
		enabled: Boolean(workspaceId && articleId),
		queryFn: () =>
			knowledgeJson<KnowledgeDetail>(
				`/api/knowledge/${articleId}?workspaceId=${encodeURIComponent(workspaceId ?? "")}`,
			),
	});
}

export function useKnowledgeMembers(workspaceId: string | null, enabled: boolean) {
	return useQuery({
		queryKey: ["workspace-members", workspaceId],
		enabled: Boolean(workspaceId && enabled),
		queryFn: async () => {
			const response = await knowledgeJson<{ members: KnowledgeMember[] }>(
				`/api/workspaces/${workspaceId}/members`,
			);
			return response.members;
		},
	});
}
