/**
 * F7e — zaměstnanecké znalosti a SOP.
 *
 * Článek drží měnitelný draft. Publikace vytváří neměnný snapshot, takže
 * rozpracovaná změna nikdy nepřepíše návod, který právě používá tým. Obsah je
 * schválně omezený na sekce; nejde o obecný databázový/Notion-like builder.
 */
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { workspaces } from "./workspace";

export type KnowledgeArticleType = "guide" | "sop" | "policy";
export type KnowledgeAudience = "team" | "all_workspace_members";
export type KnowledgeArticleState = "draft" | "published" | "archived";
export type KnowledgeSection = { id: string; title: string; body: string };

export const knowledgeArticles = pgTable(
	"knowledge_articles",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		articleType: varchar("article_type", { length: 16 })
			.$type<KnowledgeArticleType>()
			.notNull(),
		slug: varchar("slug", { length: 160 }).notNull(),
		draftTitle: varchar("draft_title", { length: 200 }).notNull(),
		draftSummary: text("draft_summary"),
		draftTags: jsonb("draft_tags").$type<string[]>().notNull().default([]),
		draftSections: jsonb("draft_sections").$type<KnowledgeSection[]>().notNull(),
		draftAudience: varchar("draft_audience", { length: 32 })
			.$type<KnowledgeAudience>()
			.notNull()
			.default("team"),
		draftAcknowledgementRequired: boolean("draft_acknowledgement_required")
			.notNull()
			.default(false),
		ownerUserId: uuid("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		state: varchar("state", { length: 16 })
			.$type<KnowledgeArticleState>()
			.notNull()
			.default("draft"),
		draftRevision: integer("draft_revision").notNull().default(1),
		publishedVersion: integer("published_version").notNull().default(0),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		updatedBy: uuid("updated_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("knowledge_articles_type_valid", sql`${t.articleType} in ('guide', 'sop', 'policy')`),
		check("knowledge_articles_slug_valid", sql`${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
		check("knowledge_articles_title_valid", sql`length(trim(${t.draftTitle})) between 1 and 200`),
		check(
			"knowledge_articles_summary_valid",
			sql`${t.draftSummary} is null or length(${t.draftSummary}) <= 1000`,
		),
		check("knowledge_articles_tags_array", sql`jsonb_typeof(${t.draftTags}) = 'array'`),
		check("knowledge_articles_sections_array", sql`jsonb_typeof(${t.draftSections}) = 'array'`),
		check(
			"knowledge_articles_audience_valid",
			sql`${t.draftAudience} in ('team', 'all_workspace_members')`,
		),
		check(
			"knowledge_articles_state_valid",
			sql`${t.state} in ('draft', 'published', 'archived')`,
		),
		check("knowledge_articles_draft_revision_positive", sql`${t.draftRevision} > 0`),
		check("knowledge_articles_published_version_nonnegative", sql`${t.publishedVersion} >= 0`),
		check(
			"knowledge_articles_publication_consistent",
			sql`(${t.publishedVersion} = 0 and ${t.publishedAt} is null and ${t.state} = 'draft')
				or (${t.publishedVersion} > 0 and ${t.publishedAt} is not null and ${t.state} in ('published', 'archived'))`,
		),
		check(
			"knowledge_articles_archive_consistent",
			sql`(${t.state} = 'archived') = (${t.archivedAt} is not null)`,
		),
		uniqueIndex("knowledge_articles_id_workspace_uq").on(t.id, t.workspaceId),
		uniqueIndex("knowledge_articles_workspace_slug_uq").on(t.workspaceId, sql`lower(${t.slug})`),
		index("knowledge_articles_workspace_state_idx").on(t.workspaceId, t.state, t.updatedAt),
	],
);

export const knowledgeArticleVersions = pgTable(
	"knowledge_article_versions",
	{
		id: pk(),
		articleId: uuid("article_id").notNull(),
		workspaceId: uuid("workspace_id").notNull(),
		version: integer("version").notNull(),
		draftRevision: integer("draft_revision").notNull(),
		articleType: varchar("article_type", { length: 16 })
			.$type<KnowledgeArticleType>()
			.notNull(),
		title: varchar("title", { length: 200 }).notNull(),
		summary: text("summary"),
		tags: jsonb("tags").$type<string[]>().notNull().default([]),
		sections: jsonb("sections").$type<KnowledgeSection[]>().notNull(),
		audience: varchar("audience", { length: 32 }).$type<KnowledgeAudience>().notNull(),
		acknowledgementRequired: boolean("acknowledgement_required").notNull(),
		ownerUserId: uuid("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		changeNote: varchar("change_note", { length: 500 }),
		publishedBy: uuid("published_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		check("knowledge_versions_version_positive", sql`${t.version} > 0`),
		check("knowledge_versions_draft_revision_positive", sql`${t.draftRevision} > 0`),
		check("knowledge_versions_type_valid", sql`${t.articleType} in ('guide', 'sop', 'policy')`),
		check("knowledge_versions_title_valid", sql`length(trim(${t.title})) between 1 and 200`),
		check(
			"knowledge_versions_summary_valid",
			sql`${t.summary} is null or length(${t.summary}) <= 1000`,
		),
		check("knowledge_versions_tags_array", sql`jsonb_typeof(${t.tags}) = 'array'`),
		check("knowledge_versions_sections_array", sql`jsonb_typeof(${t.sections}) = 'array'`),
		check(
			"knowledge_versions_audience_valid",
			sql`${t.audience} in ('team', 'all_workspace_members')`,
		),
		check(
			"knowledge_versions_change_note_valid",
			sql`${t.changeNote} is null or length(${t.changeNote}) <= 500`,
		),
		foreignKey({
			name: "knowledge_versions_article_scope_fk",
			columns: [t.articleId, t.workspaceId],
			foreignColumns: [knowledgeArticles.id, knowledgeArticles.workspaceId],
		}).onDelete("cascade"),
		uniqueIndex("knowledge_versions_article_version_uq").on(t.articleId, t.version),
		uniqueIndex("knowledge_versions_article_draft_uq").on(t.articleId, t.draftRevision),
		uniqueIndex("knowledge_versions_scope_version_uq").on(t.articleId, t.workspaceId, t.version),
		index("knowledge_versions_workspace_published_idx").on(t.workspaceId, t.publishedAt),
	],
);

export const knowledgeAcknowledgements = pgTable(
	"knowledge_acknowledgements",
	{
		id: pk(),
		articleId: uuid("article_id").notNull(),
		workspaceId: uuid("workspace_id").notNull(),
		articleVersion: integer("article_version").notNull(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		check("knowledge_acknowledgements_version_positive", sql`${t.articleVersion} > 0`),
		foreignKey({
			name: "knowledge_acknowledgements_version_scope_fk",
			columns: [t.articleId, t.workspaceId, t.articleVersion],
			foreignColumns: [
				knowledgeArticleVersions.articleId,
				knowledgeArticleVersions.workspaceId,
				knowledgeArticleVersions.version,
			],
		}).onDelete("cascade"),
		uniqueIndex("knowledge_acknowledgements_article_version_user_uq").on(
			t.articleId,
			t.articleVersion,
			t.userId,
		),
		index("knowledge_acknowledgements_user_idx").on(t.workspaceId, t.userId),
	],
);

export type KnowledgeCommandResponse = {
	articleId: string;
	state: KnowledgeArticleState;
	draftRevision: number;
	publishedVersion: number;
};

export const knowledgeCommandReceipts = pgTable(
	"knowledge_command_receipts",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		actorUserId: uuid("actor_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		operationId: uuid("operation_id").notNull(),
		action: varchar("action", { length: 24 }).notNull(),
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		response: jsonb("response").$type<KnowledgeCommandResponse>().notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		check(
			"knowledge_receipts_action_valid",
			sql`${t.action} in ('create', 'update', 'publish', 'archive', 'acknowledge')`,
		),
		check("knowledge_receipts_hash_valid", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
		check("knowledge_receipts_response_object", sql`jsonb_typeof(${t.response}) = 'object'`),
		uniqueIndex("knowledge_receipts_actor_operation_uq").on(t.actorUserId, t.operationId),
		index("knowledge_receipts_workspace_idx").on(t.workspaceId, t.createdAt),
	],
);

export type KnowledgeArticle = typeof knowledgeArticles.$inferSelect;
export type KnowledgeArticleVersion = typeof knowledgeArticleVersions.$inferSelect;
export type KnowledgeAcknowledgement = typeof knowledgeAcknowledgements.$inferSelect;
