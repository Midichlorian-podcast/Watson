import { attachmentBlobs, attachments, auditEvents, eq, getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const attachmentRoutes = new Hono<{ Variables: { requestId: string } }>();

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TASK = 50;
const MAX_PENDING_STAGES_PER_USER = 20;
const uuid = z.string().uuid();
const PROJECT_ROLE_RANK: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };

type StageRow = {
	id: string;
	desired_task_id: string;
	project_id: string;
	created_by: string;
	finalized_attachment_id: string | null;
	file_name: string;
	sha256: string;
	mime: string;
	size_bytes: number | string;
	data: Uint8Array | null;
	expires_at: Date | string;
};

class AttachmentError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 413 | 415 | 422 = 422,
	) {
		super(code);
	}
}

function cleanFileName(raw: string): string {
	const normalized = raw
		.normalize("NFKC")
		.split("")
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 || character === "/" || character === "\\"
				? " "
				: character;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	return (normalized || "attachment").slice(0, 255);
}

function extension(name: string): string {
	const match = name.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
	return match?.[1] ?? "";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
	return signature.every((value, index) => bytes[index] === value);
}

function isUtf8Text(bytes: Uint8Array): boolean {
	if (bytes.slice(0, 4096).includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 4096));
		return true;
	} catch {
		return false;
	}
}

/** Browser MIME ignorujeme; bezpečně inline zobrazujeme jen zde rozpoznané formáty. */
function detectMime(bytes: Uint8Array, fileName: string): string {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
	)
		return "image/webp";
	if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
	const ext = extension(fileName);
	// Aktivní dokumentové formáty nikdy neotvíráme inline, ani když jsou validní UTF-8.
	if (["html", "htm", "xhtml", "svg", "xml"].includes(ext)) return "application/octet-stream";
	if (isUtf8Text(bytes)) {
		if (ext === "csv") return "text/csv";
		if (ext === "md" || ext === "markdown") return "text/markdown";
		return "text/plain";
	}
	return "application/octet-stream";
}

function isInlinePreview(mime: string): boolean {
	return (
		["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mime) ||
		mime === "text/plain" ||
		mime === "text/csv" ||
		mime === "text/markdown"
	);
}

async function digest(bytes: Uint8Array): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
	return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

function contentDisposition(fileName: string, inline: boolean): string {
	const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

attachmentRoutes.post("/api/attachments/stage", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const form = await c.req.formData().catch(() => null);
	const projectId = form?.get("projectId");
	const taskId = form?.get("taskId");
	const file = form?.get("file");
	if (
		typeof projectId !== "string" ||
		!uuid.safeParse(projectId).success ||
		typeof taskId !== "string" ||
		!uuid.safeParse(taskId).success ||
		!(file instanceof File)
	)
		return c.json({ error: "invalid_attachment_upload" }, 422);
	if (file.size <= 0) return c.json({ error: "attachment_empty" }, 422);
	if (file.size > ATTACHMENT_MAX_BYTES)
		return c.json({ error: "attachment_too_large", maxBytes: ATTACHMENT_MAX_BYTES }, 413);
	const fileName = cleanFileName(file.name);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const mime = detectMime(bytes, fileName);
	const sha256 = await digest(bytes);
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`DELETE FROM attachment_upload_stages WHERE expires_at < now()`);
			const accessRows = (await tx.execute(sql`
				SELECT p.id AS project_id, p.workspace_id, pm.role::text AS role
				FROM projects p
				JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${session.user.id}
				WHERE p.id = ${projectId}
				LIMIT 1
			`)) as unknown as { project_id: string; workspace_id: string; role: string }[];
			const access = accessRows[0];
			if (!access || (PROJECT_ROLE_RANK[access.role] ?? 0) < 1)
				throw new AttachmentError("forbidden", 403);
			// Sériově vyhodnotíme uživatelský limit, aby dva souběžné uploady
			// nemohly oba projít přes stejnou hodnotu count(*).
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attachment-stage:${session.user.id}`}, 0))`,
			);
			const pendingRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM attachment_upload_stages
				WHERE created_by = ${session.user.id} AND finalized_attachment_id IS NULL AND expires_at > now()
			`)) as unknown as { count: number }[];
			if ((pendingRows[0]?.count ?? 0) >= MAX_PENDING_STAGES_PER_USER)
				throw new AttachmentError("too_many_pending_attachments", 409);
			const rows = (await tx.execute(sql`
				INSERT INTO attachment_upload_stages
					(id, desired_task_id, project_id, created_by, file_name, sha256, mime,
					 size_bytes, data, expires_at, created_at)
				VALUES
					(${crypto.randomUUID()}, ${taskId}, ${projectId}, ${session.user.id}, ${fileName},
					 ${sha256}, ${mime}, ${bytes.byteLength}, ${bytes}, now() + interval '24 hours', now())
				RETURNING id, expires_at
			`)) as unknown as { id: string; expires_at: Date | string }[];
			if (!rows[0]) throw new Error("attachment_stage_missing");
			return rows[0];
		});
		return c.json({
			stageId: result.id,
			expiresAt: new Date(result.expires_at).toISOString(),
			fileName,
			mime,
			sizeBytes: bytes.byteLength,
			sha256,
		});
	} catch (error) {
		if (error instanceof AttachmentError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

attachmentRoutes.post("/api/attachment-stages/:id/finalize", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const stageId = c.req.param("id");
	if (!uuid.safeParse(stageId).success) return c.json({ error: "invalid_attachment_stage" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`DELETE FROM attachment_upload_stages WHERE expires_at < now()`);
			const rows = (await tx.execute(sql`
				SELECT * FROM attachment_upload_stages WHERE id = ${stageId} FOR UPDATE
			`)) as unknown as StageRow[];
			const stage = rows[0];
			if (!stage) throw new AttachmentError("attachment_stage_not_found", 404);
			if (stage.created_by !== session.user.id) throw new AttachmentError("forbidden", 403);
			if (stage.finalized_attachment_id)
				return { attachmentId: stage.finalized_attachment_id, replay: true };
			if (!stage.data) throw new AttachmentError("attachment_stage_invalid", 409);
			const accessRows = (await tx.execute(sql`
				SELECT t.id, p.workspace_id, pm.role::text AS role
				FROM tasks t
				JOIN projects p ON p.id = t.project_id
				JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${session.user.id}
				WHERE t.id = ${stage.desired_task_id} AND t.project_id = ${stage.project_id}
				LIMIT 1
			`)) as unknown as { id: string; workspace_id: string; role: string }[];
			const access = accessRows[0];
			if (!access) throw new AttachmentError("attachment_task_not_synced", 409);
			if ((PROJECT_ROLE_RANK[access.role] ?? 0) < 1) throw new AttachmentError("forbidden", 403);
			// Stejný zámek pro všechny finalizace jednoho úkolu chrání pevný limit
			// příloh i při souběžných požadavcích z více karet.
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attachment-task:${stage.desired_task_id}`}, 0))`,
			);
			const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM attachments WHERE task_id = ${stage.desired_task_id}
			`)) as unknown as { count: number }[];
			if ((countRows[0]?.count ?? 0) >= MAX_ATTACHMENTS_PER_TASK)
				throw new AttachmentError("attachment_task_limit", 409);
			const attachmentId = crypto.randomUUID();
			await tx.insert(attachments).values({
				id: attachmentId,
				taskId: stage.desired_task_id,
				projectId: stage.project_id,
				url: `/api/attachments/${attachmentId}/content`,
				fileName: stage.file_name,
				sha256: stage.sha256,
				mime: stage.mime,
				sizeBytes: Number(stage.size_bytes),
				uploadedBy: session.user.id,
			});
			await tx.insert(attachmentBlobs).values({ attachmentId, data: stage.data });
			await tx.execute(sql`
				UPDATE attachment_upload_stages
				SET finalized_attachment_id = ${attachmentId}, data = NULL
				WHERE id = ${stage.id}
			`);
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "attachments",
				entityId: attachmentId,
				action: "create",
				diff: {
					task_id: stage.desired_task_id,
					project_id: stage.project_id,
					file_name: stage.file_name,
					mime: stage.mime,
					size_bytes: Number(stage.size_bytes),
				},
				requestId: c.get("requestId") ?? null,
			});
			return { attachmentId, replay: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof AttachmentError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

attachmentRoutes.delete("/api/attachment-stages/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const stageId = c.req.param("id");
	if (!uuid.safeParse(stageId).success) return c.json({ error: "invalid_attachment_stage" }, 422);
	const rows = (await getDb().execute(sql`
		DELETE FROM attachment_upload_stages
		WHERE id = ${stageId} AND created_by = ${session.user.id}
		RETURNING id
	`)) as unknown as { id: string }[];
	if (!rows[0]) return c.json({ error: "attachment_stage_not_found" }, 404);
	return c.json({ ok: true });
});

attachmentRoutes.get("/api/attachments/:id/content", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const attachmentId = c.req.param("id");
	if (!uuid.safeParse(attachmentId).success) return c.json({ error: "invalid_attachment_id" }, 422);
	const rows = (await getDb().execute(sql`
		SELECT a.file_name, a.mime, a.size_bytes, a.sha256, b.data
		FROM attachments a
		JOIN attachment_blobs b ON b.attachment_id = a.id
		JOIN project_members pm ON pm.project_id = a.project_id AND pm.user_id = ${session.user.id}
		WHERE a.id = ${attachmentId}
		LIMIT 1
	`)) as unknown as {
		file_name: string;
		mime: string;
		size_bytes: number | string;
		sha256: string;
		data: Uint8Array;
	}[];
	const row = rows[0];
	if (!row) return c.json({ error: "attachment_not_found" }, 404);
	const bytes = new Uint8Array(row.data);
	const inline = c.req.query("download") !== "1" && isInlinePreview(row.mime);
	const headers = new Headers({
		"Accept-Ranges": "bytes",
		"Content-Disposition": contentDisposition(row.file_name, inline),
		"Content-Type": inline && row.mime.startsWith("text/") ? `${row.mime}; charset=utf-8` : row.mime,
		// Web a API běží na oddělených subdoménách/portech stejného Watson webu.
		// Default secureHeaders same-origin by jinak zablokoval <img> náhled.
		"Cross-Origin-Resource-Policy": "same-site",
		ETag: `"${row.sha256}"`,
		"X-Content-Type-Options": "nosniff",
	});
	const range = c.req.header("range")?.match(/^bytes=(\d+)-(\d*)$/);
	if (range) {
		const start = Number(range[1]);
		const requestedEnd = range[2] ? Number(range[2]) : bytes.byteLength - 1;
		const end = Math.min(requestedEnd, bytes.byteLength - 1);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
			headers.set("Content-Range", `bytes */${bytes.byteLength}`);
			return new Response(null, { status: 416, headers });
		}
		const part = bytes.slice(start, end + 1);
		headers.set("Content-Length", String(part.byteLength));
		headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);
		return new Response(part, { status: 206, headers });
	}
	headers.set("Content-Length", String(bytes.byteLength));
	return new Response(bytes, { status: 200, headers });
});

attachmentRoutes.delete("/api/attachments/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const attachmentId = c.req.param("id");
	if (!uuid.safeParse(attachmentId).success) return c.json({ error: "invalid_attachment_id" }, 422);
	try {
		await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT a.id, a.task_id, a.project_id, a.uploaded_by, a.file_name,
				       p.workspace_id, pm.role::text AS role
				FROM attachments a
				JOIN projects p ON p.id = a.project_id
				JOIN project_members pm ON pm.project_id = a.project_id AND pm.user_id = ${session.user.id}
				WHERE a.id = ${attachmentId}
				LIMIT 1 FOR UPDATE OF a
			`)) as unknown as {
				id: string;
				task_id: string;
				project_id: string;
				uploaded_by: string | null;
				file_name: string;
				workspace_id: string;
				role: string;
			}[];
			const row = rows[0];
			if (!row) throw new AttachmentError("attachment_not_found", 404);
			const canDelete = row.uploaded_by === session.user.id || (PROJECT_ROLE_RANK[row.role] ?? 0) >= 2;
			if (!canDelete) throw new AttachmentError("forbidden", 403);
			await tx.delete(attachments).where(eq(attachments.id, attachmentId));
			await tx.insert(auditEvents).values({
				workspaceId: row.workspace_id,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "attachments",
				entityId: attachmentId,
				action: "delete",
				before: {
					task_id: row.task_id,
					project_id: row.project_id,
					file_name: row.file_name,
				},
				requestId: c.get("requestId") ?? null,
			});
		});
		return c.json({ ok: true });
	} catch (error) {
		if (error instanceof AttachmentError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});
