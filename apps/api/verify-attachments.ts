/** Skutečné přílohy: staging, ACL, bezpečný obsah, idempotence, delete a audit. */
import "./src/env";
import {
	and,
	attachmentBlobs,
	attachments,
	auditEvents,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.ATTACHMENTS_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
	const tokenRows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${tokenRows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error(`login ${email}: no cookie`);
	return cookie;
}

async function stage(
	cookie: string,
	projectId: string,
	taskId: string,
	file: File,
): Promise<Response> {
	const form = new FormData();
	form.set("projectId", projectId);
	form.set("taskId", taskId);
	form.set("file", file);
	return fetch(`${API}/api/attachments/stage`, {
		method: "POST",
		headers: { Origin: "http://localhost:5173", Cookie: cookie },
		body: form,
	});
}

async function post(cookie: string, path: string): Promise<Response> {
	return fetch(`${API}${path}`, {
		method: "POST",
		headers: { Origin: "http://localhost:5173", Cookie: cookie },
	});
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createdUsers = await db
		.insert(users)
		.values(
			["owner", "uploader", "peer", "outsider"].map((role) => ({
				id: crypto.randomUUID(),
				name: `Attachment ${role}`,
				email: `attachment-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})),
		)
		.returning({ id: users.id, email: users.email });
	const [owner, uploader, peer, outsider] = createdUsers;
	if (!owner || !uploader || !peer || !outsider) throw new Error("users missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Attachment ${stamp}`, ownerId: owner.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values(
		createdUsers.map((user) => ({
			workspaceId: workspace.id,
			userId: user.id,
			role: user.id === owner.id ? ("manager" as const) : ("member" as const),
		})),
	);
	const [project, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Files ${stamp}` },
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Restricted ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!project || !otherProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: owner.id, role: "manager" },
		{ projectId: project.id, userId: uploader.id, role: "commenter" },
		{ projectId: project.id, userId: peer.id, role: "commenter" },
		{ projectId: otherProject.id, userId: outsider.id, role: "commenter" },
	]);
	const taskId = crypto.randomUUID();
	try {
		// Magic-link helper čte právě vytvořený verification token; přihlášení proto
		// běží sekvenčně, aby si paralelní testovací identity tokeny nevyměnily.
		const ownerCookie = await login(owner.email);
		const uploaderCookie = await login(uploader.email);
		const peerCookie = await login(peer.email);
		const outsiderCookie = await login(outsider.email);

		let response = await stage(
			outsiderCookie,
			project.id,
			taskId,
			new File(["secret"], "outside.txt", { type: "text/plain" }),
		);
		check("uživatel mimo projekt nesmí ani stageovat", response.status === 403, response.status);
		response = await stage(
			uploaderCookie,
			project.id,
			taskId,
			new File([], "empty.txt", { type: "text/plain" }),
		);
		check("prázdný soubor je odmítnut", response.status === 422, response.status);
		response = await stage(
			uploaderCookie,
			project.id,
			taskId,
			new File([new Uint8Array([0, 1, 2, 3])], "fake.png", { type: "image/png" }),
		);
		const fakeImageReceipt = (await response.json().catch(() => ({}))) as {
			stageId?: string;
			mime?: string;
		};
		check(
			"deklarovaný typ bez platné signatury se nesmí otevřít inline",
			response.status === 200 && fakeImageReceipt.mime === "application/octet-stream",
			fakeImageReceipt,
		);
		response = await fetch(`${API}/api/attachment-stages/${fakeImageReceipt.stageId}`, {
			method: "DELETE",
			headers: { Origin: "http://localhost:5173", Cookie: uploaderCookie },
		});
		check("nepotřebný staging lze bezpečně zrušit", response.status === 200, response.status);

		const content = new TextEncoder().encode("Watson attachment content");
		response = await stage(
			uploaderCookie,
			project.id,
			taskId,
			new File([content], "../smlouva.txt", { type: "text/html" }),
		);
		const receipt = (await response.json().catch(() => ({}))) as {
			stageId?: string;
			fileName?: string;
			mime?: string;
			sha256?: string;
		};
		check(
			"commenter může vytvořit bezpečný staging s detekovaným typem a checksumem",
			response.status === 200 &&
				Boolean(receipt.stageId) &&
				receipt.fileName === ".. smlouva.txt" &&
				receipt.mime === "text/plain" &&
				receipt.sha256?.length === 64,
			receipt,
		);
		response = await post(uploaderCookie, `/api/attachment-stages/${receipt.stageId}/finalize`);
		check("finalizace čeká na autoritativní task", response.status === 409, response.status);

		await db.insert(tasks).values({
			id: taskId,
			projectId: project.id,
			name: "Task with real files",
			createdBy: uploader.id,
		});
		response = await post(uploaderCookie, `/api/attachment-stages/${receipt.stageId}/finalize`);
		const finalized = (await response.json().catch(() => ({}))) as {
			attachmentId?: string;
			replay?: boolean;
		};
		check("po syncu se staging atomicky finalizuje", response.status === 200 && Boolean(finalized.attachmentId), finalized);
		response = await post(uploaderCookie, `/api/attachment-stages/${receipt.stageId}/finalize`);
		const replay = (await response.json().catch(() => ({}))) as { attachmentId?: string; replay?: boolean };
		check(
			"finalizace je idempotentní",
			response.status === 200 && replay.replay === true && replay.attachmentId === finalized.attachmentId,
			replay,
		);
		const metadata = await db.select().from(attachments).where(eq(attachments.id, finalized.attachmentId ?? ""));
		const blob = await db
			.select()
			.from(attachmentBlobs)
			.where(eq(attachmentBlobs.attachmentId, finalized.attachmentId ?? ""));
		check(
			"metadata a binární obsah existují přesně jednou",
			metadata.length === 1 && blob.length === 1 && new TextDecoder().decode(blob[0]?.data) === "Watson attachment content",
			{ metadata: metadata.length, blobs: blob.length },
		);

		response = await fetch(`${API}/api/attachments/${finalized.attachmentId}/content`, {
			headers: { Origin: "http://localhost:5173", Cookie: peerCookie },
		});
		check(
			"člen projektu může číst přesný obsah s bezpečnými hlavičkami",
			response.status === 200 &&
				(await response.text()) === "Watson attachment content" &&
				response.headers.get("content-type")?.startsWith("text/plain") === true &&
				response.headers.get("x-content-type-options") === "nosniff" &&
				response.headers.get("cross-origin-resource-policy") === "same-site" &&
				response.headers.get("etag")?.length === 66,
			Object.fromEntries(response.headers),
		);
		response = await fetch(`${API}/api/attachments/${finalized.attachmentId}/content`, {
			headers: {
				Origin: "http://localhost:5173",
				Cookie: peerCookie,
				Range: "bytes=7-16",
			},
		});
		check(
			"range request vrací přesný výřez",
			response.status === 206 && (await response.text()) === "attachment",
			response.status,
		);

		response = await stage(
			uploaderCookie,
			project.id,
			taskId,
			new File(["<script>alert(1)</script>"], "attack.html", { type: "text/html" }),
		);
		const activeReceipt = (await response.json().catch(() => ({}))) as { stageId?: string };
		response = await post(
			uploaderCookie,
			`/api/attachment-stages/${activeReceipt.stageId}/finalize`,
		);
		const activeFinalized = (await response.json().catch(() => ({}))) as {
			attachmentId?: string;
		};
		response = await fetch(`${API}/api/attachments/${activeFinalized.attachmentId}/content`, {
			headers: { Origin: "http://localhost:5173", Cookie: peerCookie },
		});
		check(
			"aktivní HTML se nikdy neotevře inline",
			response.status === 200 &&
				response.headers.get("content-type") === "application/octet-stream" &&
				response.headers.get("content-disposition")?.startsWith("attachment;") === true,
			Object.fromEntries(response.headers),
		);
		response = await fetch(`${API}/api/attachments/${activeFinalized.attachmentId}`, {
			method: "DELETE",
			headers: { Origin: "http://localhost:5173", Cookie: uploaderCookie },
		});
		check("autor může vlastní přílohu smazat", response.status === 200, response.status);
		response = await fetch(`${API}/api/attachments/${finalized.attachmentId}/content`, {
			headers: { Origin: "http://localhost:5173", Cookie: outsiderCookie },
		});
		check("restricted projekt se neprozradí uživateli mimo něj", response.status === 404, response.status);

		response = await fetch(`${API}/api/attachments/${finalized.attachmentId}`, {
			method: "DELETE",
			headers: { Origin: "http://localhost:5173", Cookie: peerCookie },
		});
		check("jiný commenter nesmí přílohu smazat", response.status === 403, response.status);
		response = await fetch(`${API}/api/attachments/${finalized.attachmentId}`, {
			method: "DELETE",
			headers: { Origin: "http://localhost:5173", Cookie: ownerCookie },
		});
		check("manager může přílohu smazat", response.status === 200, response.status);
		check(
			"delete kaskádou odstraní i blob",
			(await db.select().from(attachmentBlobs).where(eq(attachmentBlobs.attachmentId, finalized.attachmentId ?? ""))).length === 0,
		);
		const events = await db
			.select({ action: auditEvents.action })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, workspace.id),
					eq(auditEvents.entity, "attachments"),
				),
			);
		check(
			"create i delete jsou v autoritativním auditu",
			events.filter((event) => event.action === "create").length === 2 &&
				events.filter((event) => event.action === "delete").length === 2,
			events,
		);
		response = await fetch(`${API}/api/tasks/${taskId}/timeline`, {
			headers: { Origin: "http://localhost:5173", Cookie: uploaderCookie },
		});
		const timeline = (await response.json().catch(() => ({}))) as {
			events?: { kind: string; excerpt?: string }[];
		};
		check(
			"jednotná časová osa obsahuje přidání i odebrání příloh",
			response.status === 200 &&
				timeline.events?.filter((event) => event.kind === "attachment_added").length === 2 &&
				timeline.events?.filter((event) => event.kind === "attachment_removed").length === 2 &&
				timeline.events?.some((event) => event.excerpt === ".. smlouva.txt") === true,
			timeline,
		);

		let crossProjectRejected = false;
		try {
			await db.insert(attachments).values({
				taskId,
				projectId: otherProject.id,
				url: "/invalid",
				fileName: "invalid.txt",
				sha256: "0".repeat(64),
				mime: "text/plain",
				sizeBytes: 1,
			});
		} catch {
			crossProjectRejected = true;
		}
		check("DB odmítne cross-project metadata", crossProjectRejected);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		for (const user of createdUsers) await db.delete(users).where(eq(users.id, user.id));
	}
	if (failed) throw new Error(`${failed} attachment checks failed`);
	console.log("\nAttachment checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
