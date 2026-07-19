/** F7e — zaměstnanecké znalosti a SOP: verzované Draft → Publish, bez wiki builderu. */
import { createHash } from "node:crypto";
import {
	and,
	auditEvents,
	desc,
	eq,
	getDb,
	knowledgeAcknowledgements,
	knowledgeArticleVersions,
	knowledgeArticles,
	knowledgeCommandReceipts,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const knowledgeRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const articleType = z.enum(["guide", "sop", "policy"]);
const audience = z.enum(["team", "all_workspace_members"]);
const section = z
	.object({
		id: uuid,
		title: z.string().trim().min(1).max(160),
		body: z.string().min(1).max(10_000),
	})
	.strict();
const sections = z
	.array(section)
	.min(1)
	.max(50)
	.superRefine((value, context) => {
		if (value.reduce((sum, item) => sum + item.body.length, 0) > 100_000) {
			context.addIssue({ code: "custom", message: "content_too_large" });
		}
		if (new Set(value.map((item) => item.id)).size !== value.length) {
			context.addIssue({ code: "custom", message: "duplicate_section_id" });
		}
	});
const tags = z
	.array(z.string().trim().min(1).max(30))
	.max(12)
	.default([])
	.superRefine((value, context) => {
		if (new Set(value.map((tag) => tag.toLocaleLowerCase("en-US"))).size !== value.length) {
			context.addIssue({ code: "custom", message: "duplicate_tag" });
		}
	});
const editableFields = {
	articleType,
	title: z.string().trim().min(1).max(200),
	summary: z.string().trim().max(1_000).nullable().default(null),
	tags,
	sections,
	audience: audience.default("team"),
	acknowledgementRequired: z.boolean().default(false),
	ownerUserId: uuid.nullable().default(null),
};
const createSchema = z
	.object({
		id: uuid,
		operationId: uuid,
		workspaceId: uuid,
		...editableFields,
	})
	.strict();
const updateSchema = z
	.object({
		operationId: uuid,
		expectedDraftRevision: z.number().int().positive(),
		articleType: editableFields.articleType.optional(),
		title: editableFields.title.optional(),
		summary: z.string().trim().max(1_000).nullable().optional(),
		tags: tags.optional(),
		sections: sections.optional(),
		audience: audience.optional(),
		acknowledgementRequired: z.boolean().optional(),
		ownerUserId: uuid.nullable().optional(),
	})
	.strict()
	.refine(
		(value) =>
			value.articleType !== undefined ||
			value.title !== undefined ||
			value.summary !== undefined ||
			value.tags !== undefined ||
			value.sections !== undefined ||
			value.audience !== undefined ||
			value.acknowledgementRequired !== undefined ||
			value.ownerUserId !== undefined,
		"nothing_to_update",
	);
const publishSchema = z
	.object({
		operationId: uuid,
		expectedDraftRevision: z.number().int().positive(),
		changeNote: z.string().trim().max(500).nullable().default(null),
	})
	.strict();
const archiveSchema = z
	.object({
		operationId: uuid,
		expectedPublishedVersion: z.number().int().positive(),
	})
	.strict();
const acknowledgeSchema = z
	.object({ operationId: uuid, articleVersion: z.number().int().positive() })
	.strict();
const listSchema = z.object({
	workspaceId: uuid,
	q: z.string().trim().max(200).optional(),
	type: articleType.optional(),
	view: z.enum(["published", "manage"]).default("published"),
	state: z.enum(["all", "draft", "published", "archived"]).default("all"),
	limit: z.coerce.number().int().min(1).max(100).default(100),
});
const detailSchema = z.object({ workspaceId: uuid });

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Access = { role: string | null; ownerId: string | null; canManage: boolean; isGuest: boolean };

class KnowledgeError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422 | 503,
	) {
		super(code);
	}
}

function requestHash(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slugify(title: string, id: string) {
	const value = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 148)
		.replace(/-$/g, "");
	return `${value || "clanek"}-${id.slice(0, 8)}`;
}

function accessFromRow(row: { ownerId: string | null; role: string | null } | undefined, userId: string): Access | null {
	if (!row || (row.ownerId !== userId && !row.role)) return null;
	return {
		ownerId: row.ownerId,
		role: row.role,
		canManage: row.ownerId === userId || row.role === "admin" || row.role === "manager",
		isGuest: row.ownerId !== userId && row.role === "guest",
	};
}

async function readAccess(workspaceId: string, userId: string) {
	const row = (
		await getDb()
			.select({ ownerId: workspaces.ownerId, role: memberships.role })
			.from(workspaces)
			.leftJoin(
				memberships,
				and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, userId)),
			)
			.where(eq(workspaces.id, workspaceId))
			.limit(1)
	)[0];
	return accessFromRow(row, userId);
}

async function transactionAccess(tx: Tx, workspaceId: string, userId: string) {
	const row = (
		await tx
			.select({ ownerId: workspaces.ownerId, role: memberships.role })
			.from(workspaces)
			.leftJoin(
				memberships,
				and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, userId)),
			)
			.where(eq(workspaces.id, workspaceId))
			.limit(1)
	)[0];
	return accessFromRow(row, userId);
}

async function validateOwner(tx: Tx, workspaceId: string, ownerUserId: string | null | undefined) {
	if (!ownerUserId) return;
	const row = (
		await tx
			.select({ ownerId: workspaces.ownerId, memberId: memberships.id })
			.from(workspaces)
			.leftJoin(
				memberships,
				and(
					eq(memberships.workspaceId, workspaces.id),
					eq(memberships.userId, ownerUserId),
				),
			)
			.where(eq(workspaces.id, workspaceId))
			.limit(1)
	)[0];
	if (!row || (row.ownerId !== ownerUserId && !row.memberId)) {
		throw new KnowledgeError("knowledge_owner_not_member", 422);
	}
}

function canReadPublished(access: Access, articleAudience: string | null) {
	return !access.isGuest || articleAudience === "all_workspace_members";
}

async function commandReplay(tx: Tx, actorUserId: string, operationId: string, hash: string, action: string) {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actorUserId}:${operationId}`}, 0))`,
	);
	const receipt = (
		await tx
			.select()
			.from(knowledgeCommandReceipts)
			.where(
				and(
					eq(knowledgeCommandReceipts.actorUserId, actorUserId),
					eq(knowledgeCommandReceipts.operationId, operationId),
				),
			)
			.limit(1)
	)[0];
	if (!receipt) return null;
	if (receipt.requestHash !== hash || receipt.action !== action) {
		throw new KnowledgeError("operation_id_reused", 409);
	}
	return receipt.response;
}

function commandResponse(article: typeof knowledgeArticles.$inferSelect) {
	return {
		articleId: article.id,
		state: article.state,
		draftRevision: article.draftRevision,
		publishedVersion: article.publishedVersion,
	};
}

function databaseError(error: unknown) {
	if (error instanceof KnowledgeError) return error;
	const code =
		(error as { code?: string; cause?: { code?: string } })?.code ??
		(error as { cause?: { code?: string } })?.cause?.code;
	if (code === "23505") return new KnowledgeError("knowledge_conflict", 409);
	if (code === "23514") return new KnowledgeError("knowledge_invariant_failed", 422);
	return new KnowledgeError("knowledge_unavailable", 503);
}

knowledgeRoutes.get("/api/knowledge", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = listSchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "invalid_knowledge_query" }, 422);
	const query = parsed.data;
	const access = await readAccess(query.workspaceId, session.user.id);
	if (!access) return c.json({ error: "forbidden" }, 403);
	const manage = query.view === "manage" && access.canManage;
	const filters = [eq(knowledgeArticles.workspaceId, query.workspaceId)];
	if (query.type) {
		filters.push(
			manage
				? eq(knowledgeArticles.articleType, query.type)
				: eq(knowledgeArticleVersions.articleType, query.type),
		);
	}
	if (manage) {
		if (query.state !== "all") filters.push(eq(knowledgeArticles.state, query.state));
	} else {
		filters.push(eq(knowledgeArticles.state, "published"));
		if (access.isGuest) {
			filters.push(eq(knowledgeArticleVersions.audience, "all_workspace_members"));
		}
	}
	if (query.q) {
		const pattern = `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		filters.push(
			manage
				? sql`(${knowledgeArticles.draftTitle} ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(${knowledgeArticles.draftSummary}, '') ILIKE ${pattern} ESCAPE '\\'
					OR ${knowledgeArticles.draftTags}::text ILIKE ${pattern} ESCAPE '\\'
					OR ${knowledgeArticles.draftSections}::text ILIKE ${pattern} ESCAPE '\\')`
				: sql`(${knowledgeArticleVersions.title} ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(${knowledgeArticleVersions.summary}, '') ILIKE ${pattern} ESCAPE '\\'
					OR ${knowledgeArticleVersions.tags}::text ILIKE ${pattern} ESCAPE '\\'
					OR ${knowledgeArticleVersions.sections}::text ILIKE ${pattern} ESCAPE '\\')`,
		);
	}
	const rows = await getDb()
		.select({
			article: knowledgeArticles,
			publishedDraftRevision: knowledgeArticleVersions.draftRevision,
			publishedType: knowledgeArticleVersions.articleType,
			publishedTitle: knowledgeArticleVersions.title,
			publishedSummary: knowledgeArticleVersions.summary,
			publishedTags: knowledgeArticleVersions.tags,
			publishedAudience: knowledgeArticleVersions.audience,
			publishedAcknowledgementRequired: knowledgeArticleVersions.acknowledgementRequired,
			publishedOwnerUserId: knowledgeArticleVersions.ownerUserId,
			ownerName: sql<string | null>`(
				SELECT u.name FROM users u
				WHERE u.id = CASE WHEN ${manage} THEN ${knowledgeArticles.ownerUserId}
					ELSE ${knowledgeArticleVersions.ownerUserId} END
			)`,
			acknowledgedByMe: sql<boolean>`EXISTS (
				SELECT 1 FROM knowledge_acknowledgements ack
				WHERE ack.article_id = ${knowledgeArticles.id}
					AND ack.article_version = ${knowledgeArticles.publishedVersion}
					AND ack.user_id = ${session.user.id}
			)`,
		})
		.from(knowledgeArticles)
		.leftJoin(
			knowledgeArticleVersions,
			and(
				eq(knowledgeArticleVersions.articleId, knowledgeArticles.id),
				eq(knowledgeArticleVersions.version, knowledgeArticles.publishedVersion),
			),
		)
		.where(and(...filters))
		.orderBy(
			manage ? desc(knowledgeArticles.updatedAt) : desc(knowledgeArticleVersions.publishedAt),
			desc(knowledgeArticles.id),
		)
		.limit(query.limit);
	return c.json({
		canManage: access.canManage,
		mode: manage ? "manage" : "published",
		articles: rows.map((row) => ({
			id: row.article.id,
			slug: row.article.slug,
			state: row.article.state,
			articleType: manage ? row.article.articleType : row.publishedType,
			title: manage ? row.article.draftTitle : row.publishedTitle,
			summary: manage ? row.article.draftSummary : row.publishedSummary,
			tags: manage ? row.article.draftTags : row.publishedTags,
			audience: manage ? row.article.draftAudience : row.publishedAudience,
			acknowledgementRequired: manage
				? row.article.draftAcknowledgementRequired
				: row.publishedAcknowledgementRequired,
			ownerUserId: manage ? row.article.ownerUserId : row.publishedOwnerUserId,
			ownerName: row.ownerName,
			draftRevision: manage ? row.article.draftRevision : undefined,
			publishedVersion: row.article.publishedVersion,
			publishedAt: row.article.publishedAt?.toISOString() ?? null,
			updatedAt: manage
				? row.article.updatedAt.toISOString()
				: row.article.publishedAt?.toISOString() ?? row.article.updatedAt.toISOString(),
			hasUnpublishedChanges:
				manage && row.article.publishedVersion > 0
					? row.publishedDraftRevision !== row.article.draftRevision
					: false,
			acknowledgedByMe: row.acknowledgedByMe,
		})),
	});
});

knowledgeRoutes.get("/api/knowledge/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const query = detailSchema.safeParse(c.req.query());
	if (!id.success || !query.success) return c.json({ error: "invalid_knowledge_detail" }, 422);
	const access = await readAccess(query.data.workspaceId, session.user.id);
	if (!access) return c.json({ error: "knowledge_not_found" }, 404);
	const row = (
		await getDb()
			.select({ article: knowledgeArticles, published: knowledgeArticleVersions })
			.from(knowledgeArticles)
			.leftJoin(
				knowledgeArticleVersions,
				and(
					eq(knowledgeArticleVersions.articleId, knowledgeArticles.id),
					eq(knowledgeArticleVersions.version, knowledgeArticles.publishedVersion),
				),
			)
			.where(
				and(
					eq(knowledgeArticles.id, id.data),
					eq(knowledgeArticles.workspaceId, query.data.workspaceId),
				),
			)
			.limit(1)
	)[0];
	if (
		!row ||
		(!access.canManage &&
			(row.article.state !== "published" ||
				!row.published ||
				!canReadPublished(access, row.published.audience)))
	) {
		return c.json({ error: "knowledge_not_found" }, 404);
	}
	const published = row.published;
	const currentOwnerId = access.canManage ? row.article.ownerUserId : published?.ownerUserId;
	const owner = currentOwnerId
		? (
				await getDb()
					.select({ id: users.id, name: users.name })
					.from(users)
					.where(eq(users.id, currentOwnerId))
					.limit(1)
			)[0] ?? null
		: null;
	const acknowledgedByMe = published
		? Boolean(
				(
					await getDb()
						.select({ id: knowledgeAcknowledgements.id })
						.from(knowledgeAcknowledgements)
						.where(
							and(
								eq(knowledgeAcknowledgements.articleId, row.article.id),
								eq(knowledgeAcknowledgements.articleVersion, published.version),
								eq(knowledgeAcknowledgements.userId, session.user.id),
							),
						)
						.limit(1)
				)[0],
			)
		: false;
	const versionRows = access.canManage
		? await getDb()
				.select({
					version: knowledgeArticleVersions.version,
					draftRevision: knowledgeArticleVersions.draftRevision,
					title: knowledgeArticleVersions.title,
					changeNote: knowledgeArticleVersions.changeNote,
					publishedAt: knowledgeArticleVersions.publishedAt,
					publishedByName: users.name,
					acknowledgementRequired: knowledgeArticleVersions.acknowledgementRequired,
					acknowledgedCount: sql<number>`(
						SELECT count(*)::int FROM knowledge_acknowledgements ack
						WHERE ack.article_id = ${knowledgeArticleVersions.articleId}
							AND ack.article_version = ${knowledgeArticleVersions.version}
					)`,
				})
				.from(knowledgeArticleVersions)
				.innerJoin(users, eq(users.id, knowledgeArticleVersions.publishedBy))
				.where(eq(knowledgeArticleVersions.articleId, row.article.id))
				.orderBy(desc(knowledgeArticleVersions.version))
		: [];
	const eligibleCount =
		access.canManage && published?.acknowledgementRequired
			? Number(
					(
						await getDb().execute(sql`
							SELECT count(DISTINCT eligible.user_id)::int AS count
							FROM (
								SELECT m.user_id FROM memberships m
								WHERE m.workspace_id = ${row.article.workspaceId}
									AND (${published.audience} = 'all_workspace_members' OR m.role <> 'guest')
								UNION
								SELECT w.owner_id FROM workspaces w
								WHERE w.id = ${row.article.workspaceId} AND w.owner_id IS NOT NULL
							) eligible
						`)
					)[0]?.count ?? 0,
				)
			: null;
	return c.json({
		canManage: access.canManage,
		article: {
			id: row.article.id,
			workspaceId: row.article.workspaceId,
			slug: row.article.slug,
			state: row.article.state,
			draftRevision: access.canManage ? row.article.draftRevision : undefined,
			publishedVersion: row.article.publishedVersion,
			publishedAt: row.article.publishedAt?.toISOString() ?? null,
			updatedAt: access.canManage
				? row.article.updatedAt.toISOString()
				: published?.publishedAt.toISOString() ?? row.article.updatedAt.toISOString(),
			owner,
			draft: access.canManage
				? {
						articleType: row.article.articleType,
						title: row.article.draftTitle,
						summary: row.article.draftSummary,
						tags: row.article.draftTags,
						sections: row.article.draftSections,
						audience: row.article.draftAudience,
						acknowledgementRequired: row.article.draftAcknowledgementRequired,
						ownerUserId: row.article.ownerUserId,
					}
				: undefined,
			published: published
				? {
						version: published.version,
						draftRevision: published.draftRevision,
						articleType: published.articleType,
						title: published.title,
						summary: published.summary,
						tags: published.tags,
						sections: published.sections,
						audience: published.audience,
						acknowledgementRequired: published.acknowledgementRequired,
						ownerUserId: published.ownerUserId,
						publishedAt: published.publishedAt.toISOString(),
					}
				: null,
			acknowledgement: published
				? {
						required: published.acknowledgementRequired,
						acknowledgedByMe,
						eligibleCount,
						acknowledgedCount: access.canManage
							? (versionRows.find((version) => version.version === published.version)
									?.acknowledgedCount ?? 0)
							: undefined,
					}
				: null,
			versions: access.canManage
				? versionRows.map((version) => ({
						...version,
						publishedAt: version.publishedAt.toISOString(),
					}))
				: undefined,
		},
	});
});

knowledgeRoutes.post("/api/knowledge", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_knowledge_article" }, 422);
	const body = parsed.data;
	const hash = requestHash({ action: "create", ...body });
	try {
		const result = await getDb().transaction(async (tx) => {
			const replay = await commandReplay(tx, session.user.id, body.operationId, hash, "create");
			if (replay) return { ...replay, replayed: true };
			const access = await transactionAccess(tx, body.workspaceId, session.user.id);
			if (!access?.canManage) throw new KnowledgeError("forbidden", 403);
			await validateOwner(tx, body.workspaceId, body.ownerUserId);
			const inserted = (
				await tx
					.insert(knowledgeArticles)
					.values({
						id: body.id,
						workspaceId: body.workspaceId,
						articleType: body.articleType,
						slug: slugify(body.title, body.id),
						draftTitle: body.title,
						draftSummary: body.summary,
						draftTags: body.tags,
						draftSections: body.sections,
						draftAudience: body.audience,
						draftAcknowledgementRequired: body.acknowledgementRequired,
						ownerUserId: body.ownerUserId,
						createdBy: session.user.id,
						updatedBy: session.user.id,
					})
					.returning()
			)[0];
			if (!inserted) throw new KnowledgeError("knowledge_conflict", 409);
			const response = commandResponse(inserted);
			await tx.insert(knowledgeCommandReceipts).values({
				workspaceId: body.workspaceId,
				actorUserId: session.user.id,
				operationId: body.operationId,
				action: "create",
				requestHash: hash,
				response,
			});
			await tx.insert(auditEvents).values({
				workspaceId: body.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "knowledge_articles",
				entityId: inserted.id,
				action: "create_draft",
				diff: { articleType: body.articleType, sectionCount: body.sections.length },
				requestId: c.get("requestId") ?? null,
			});
			return { ...response, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		const normalized = databaseError(error);
		return c.json({ error: normalized.code }, normalized.status);
	}
});

knowledgeRoutes.patch("/api/knowledge/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !parsed.success) return c.json({ error: "invalid_knowledge_update" }, 422);
	const body = parsed.data;
	const hash = requestHash({ action: "update", id: id.data, ...body });
	try {
		const result = await getDb().transaction(async (tx) => {
			const replay = await commandReplay(tx, session.user.id, body.operationId, hash, "update");
			if (replay) return { ...replay, replayed: true };
			const current = (
				await tx.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id.data)).limit(1)
			)[0];
			if (!current) throw new KnowledgeError("knowledge_not_found", 404);
			const access = await transactionAccess(tx, current.workspaceId, session.user.id);
			if (!access?.canManage) throw new KnowledgeError("knowledge_not_found", 404);
			if (current.draftRevision !== body.expectedDraftRevision) {
				throw new KnowledgeError("stale_draft", 409);
			}
			await validateOwner(tx, current.workspaceId, body.ownerUserId);
			const updated = (
				await tx
					.update(knowledgeArticles)
					.set({
						articleType: body.articleType,
						draftTitle: body.title,
						draftSummary: body.summary,
						draftTags: body.tags,
						draftSections: body.sections,
						draftAudience: body.audience,
						draftAcknowledgementRequired: body.acknowledgementRequired,
						ownerUserId: body.ownerUserId,
						updatedBy: session.user.id,
						draftRevision: sql`${knowledgeArticles.draftRevision} + 1`,
					})
					.where(
						and(
							eq(knowledgeArticles.id, id.data),
							eq(knowledgeArticles.draftRevision, body.expectedDraftRevision),
						),
					)
					.returning()
			)[0];
			if (!updated) throw new KnowledgeError("stale_draft", 409);
			const response = commandResponse(updated);
			await tx.insert(knowledgeCommandReceipts).values({
				workspaceId: current.workspaceId,
				actorUserId: session.user.id,
				operationId: body.operationId,
				action: "update",
				requestHash: hash,
				response,
			});
			await tx.insert(auditEvents).values({
				workspaceId: current.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "knowledge_articles",
				entityId: current.id,
				action: "update_draft",
				diff: {
					previousDraftRevision: current.draftRevision,
					nextDraftRevision: updated.draftRevision,
					changedFields: Object.keys(body).filter(
						(key) => key !== "operationId" && key !== "expectedDraftRevision",
					),
				},
				requestId: c.get("requestId") ?? null,
			});
			return { ...response, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		const normalized = databaseError(error);
		return c.json({ error: normalized.code }, normalized.status);
	}
});

knowledgeRoutes.post("/api/knowledge/:id/publish", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const parsed = publishSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !parsed.success) return c.json({ error: "invalid_knowledge_publish" }, 422);
	const body = parsed.data;
	const hash = requestHash({ action: "publish", id: id.data, ...body });
	try {
		const result = await getDb().transaction(async (tx) => {
			const replay = await commandReplay(tx, session.user.id, body.operationId, hash, "publish");
			if (replay) return { ...replay, replayed: true };
			await tx.execute(
				sql`SELECT id FROM knowledge_articles WHERE id = ${id.data} LIMIT 1 FOR UPDATE`,
			);
			const current = (
				await tx.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id.data)).limit(1)
			)[0];
			if (!current) throw new KnowledgeError("knowledge_not_found", 404);
			const access = await transactionAccess(tx, current.workspaceId, session.user.id);
			if (!access?.canManage) throw new KnowledgeError("knowledge_not_found", 404);
			if (current.draftRevision !== body.expectedDraftRevision) {
				throw new KnowledgeError("stale_draft", 409);
			}
			if (current.publishedVersion > 0) {
				const latest = (
					await tx
						.select({ draftRevision: knowledgeArticleVersions.draftRevision })
						.from(knowledgeArticleVersions)
						.where(
							and(
								eq(knowledgeArticleVersions.articleId, current.id),
								eq(knowledgeArticleVersions.version, current.publishedVersion),
							),
						)
						.limit(1)
				)[0];
				if (latest?.draftRevision === current.draftRevision) {
					throw new KnowledgeError("no_unpublished_changes", 409);
				}
			}
			await validateOwner(tx, current.workspaceId, current.ownerUserId);
			const nextVersion = current.publishedVersion + 1;
			await tx.insert(knowledgeArticleVersions).values({
				articleId: current.id,
				workspaceId: current.workspaceId,
				version: nextVersion,
				draftRevision: current.draftRevision,
				articleType: current.articleType,
				title: current.draftTitle,
				summary: current.draftSummary,
				tags: current.draftTags,
				sections: current.draftSections,
				audience: current.draftAudience,
				acknowledgementRequired: current.draftAcknowledgementRequired,
				ownerUserId: current.ownerUserId,
				changeNote: body.changeNote,
				publishedBy: session.user.id,
			});
			const updated = (
				await tx
					.update(knowledgeArticles)
					.set({
						state: "published",
						publishedVersion: nextVersion,
						publishedAt: new Date(),
						archivedAt: null,
						updatedBy: session.user.id,
					})
					.where(eq(knowledgeArticles.id, current.id))
					.returning()
			)[0];
			if (!updated) throw new KnowledgeError("knowledge_conflict", 409);
			const response = commandResponse(updated);
			await tx.insert(knowledgeCommandReceipts).values({
				workspaceId: current.workspaceId,
				actorUserId: session.user.id,
				operationId: body.operationId,
				action: "publish",
				requestHash: hash,
				response,
			});
			await tx.insert(auditEvents).values({
				workspaceId: current.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "knowledge_articles",
				entityId: current.id,
				action: "publish",
				diff: {
					version: nextVersion,
					draftRevision: current.draftRevision,
					acknowledgementRequired: current.draftAcknowledgementRequired,
				},
				requestId: c.get("requestId") ?? null,
			});
			return { ...response, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		const normalized = databaseError(error);
		return c.json({ error: normalized.code }, normalized.status);
	}
});

knowledgeRoutes.post("/api/knowledge/:id/archive", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const parsed = archiveSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !parsed.success) return c.json({ error: "invalid_knowledge_archive" }, 422);
	const body = parsed.data;
	const hash = requestHash({ action: "archive", id: id.data, ...body });
	try {
		const result = await getDb().transaction(async (tx) => {
			const replay = await commandReplay(tx, session.user.id, body.operationId, hash, "archive");
			if (replay) return { ...replay, replayed: true };
			const current = (
				await tx.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id.data)).limit(1)
			)[0];
			if (!current) throw new KnowledgeError("knowledge_not_found", 404);
			const access = await transactionAccess(tx, current.workspaceId, session.user.id);
			if (!access?.canManage) throw new KnowledgeError("knowledge_not_found", 404);
			if (
				current.state !== "published" ||
				current.publishedVersion !== body.expectedPublishedVersion
			) {
				throw new KnowledgeError("stale_published_version", 409);
			}
			const updated = (
				await tx
					.update(knowledgeArticles)
					.set({ state: "archived", archivedAt: new Date(), updatedBy: session.user.id })
					.where(
						and(
							eq(knowledgeArticles.id, current.id),
							eq(knowledgeArticles.state, "published"),
							eq(knowledgeArticles.publishedVersion, body.expectedPublishedVersion),
						),
					)
					.returning()
			)[0];
			if (!updated) throw new KnowledgeError("stale_published_version", 409);
			const response = commandResponse(updated);
			await tx.insert(knowledgeCommandReceipts).values({
				workspaceId: current.workspaceId,
				actorUserId: session.user.id,
				operationId: body.operationId,
				action: "archive",
				requestHash: hash,
				response,
			});
			await tx.insert(auditEvents).values({
				workspaceId: current.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "knowledge_articles",
				entityId: current.id,
				action: "archive",
				diff: { publishedVersion: current.publishedVersion },
				requestId: c.get("requestId") ?? null,
			});
			return { ...response, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		const normalized = databaseError(error);
		return c.json({ error: normalized.code }, normalized.status);
	}
});

knowledgeRoutes.post("/api/knowledge/:id/acknowledge", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const parsed = acknowledgeSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !parsed.success) return c.json({ error: "invalid_knowledge_ack" }, 422);
	const body = parsed.data;
	const hash = requestHash({ action: "acknowledge", id: id.data, ...body });
	try {
		const result = await getDb().transaction(async (tx) => {
			const replay = await commandReplay(
				tx,
				session.user.id,
				body.operationId,
				hash,
				"acknowledge",
			);
			if (replay) return { ...replay, acknowledged: true, replayed: true };
			const current = (
				await tx
					.select({ article: knowledgeArticles, version: knowledgeArticleVersions })
					.from(knowledgeArticles)
					.innerJoin(
						knowledgeArticleVersions,
						and(
							eq(knowledgeArticleVersions.articleId, knowledgeArticles.id),
							eq(knowledgeArticleVersions.version, knowledgeArticles.publishedVersion),
						),
					)
					.where(eq(knowledgeArticles.id, id.data))
					.limit(1)
			)[0];
			if (!current) throw new KnowledgeError("knowledge_not_found", 404);
			const access = await transactionAccess(tx, current.article.workspaceId, session.user.id);
			if (
				!access ||
				current.article.state !== "published" ||
				current.version.version !== body.articleVersion ||
				!current.version.acknowledgementRequired ||
				!canReadPublished(access, current.version.audience)
			) {
				throw new KnowledgeError("knowledge_ack_not_allowed", 409);
			}
			await tx
				.insert(knowledgeAcknowledgements)
				.values({
					articleId: current.article.id,
					workspaceId: current.article.workspaceId,
					articleVersion: body.articleVersion,
					userId: session.user.id,
				})
				.onConflictDoNothing();
			const response = commandResponse(current.article);
			await tx.insert(knowledgeCommandReceipts).values({
				workspaceId: current.article.workspaceId,
				actorUserId: session.user.id,
				operationId: body.operationId,
				action: "acknowledge",
				requestHash: hash,
				response,
			});
			await tx.insert(auditEvents).values({
				workspaceId: current.article.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "knowledge_articles",
				entityId: current.article.id,
				action: "acknowledge",
				diff: { publishedVersion: body.articleVersion },
				requestId: c.get("requestId") ?? null,
			});
			return { ...response, acknowledged: true, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		const normalized = databaseError(error);
		return c.json({ error: normalized.code }, normalized.status);
	}
});
