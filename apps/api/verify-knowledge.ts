/** F7e — end-to-end důkaz zaměstnaneckých znalostí a SOP. */
import "./src/env";
import {
	auditEvents,
	eq,
	getDb,
	knowledgeAcknowledgements,
	knowledgeArticleVersions,
	knowledgeArticles,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.KNOWLEDGE_API ?? "http://127.0.0.1:8790";
const WEB_ORIGIN = process.env.KNOWLEDGE_ORIGIN ?? "http://localhost:5173";
const db = getDb();
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
}

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
		body: JSON.stringify({ email, callbackURL: `${WEB_ORIGIN}/` }),
	});
	if (!requested.ok) throw new Error(`magic-link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=${encodeURIComponent(`${WEB_ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error(`login ${email}: missing cookie`);
	return cookie;
}

async function request(cookie: string, path: string, method = "GET", body?: unknown) {
	return fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: WEB_ORIGIN,
			Cookie: cookie,
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const makeUser = async (slug: string) => {
		const [row] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `Knowledge ${slug}`,
				email: `knowledge-${slug}-${stamp}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		if (!row) throw new Error(`user ${slug} missing`);
		return row;
	};
	const manager = await makeUser("manager");
	const member = await makeUser("member");
	const guest = await makeUser("guest");
	const outsider = await makeUser("outsider");
	const [workspace, otherWorkspace] = await db
		.insert(workspaces)
		.values([
			{ name: `Knowledge ${stamp}`, ownerId: manager.id },
			{ name: `Knowledge other ${stamp}`, ownerId: outsider.id },
		])
		.returning({ id: workspaces.id });
	if (!workspace || !otherWorkspace) throw new Error("workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
		{ workspaceId: workspace.id, userId: guest.id, role: "guest" },
		{ workspaceId: otherWorkspace.id, userId: outsider.id, role: "admin" },
	]);

	const managerCookie = await login(manager.email);
	const memberCookie = await login(member.email);
	const guestCookie = await login(guest.email);
	const articleId = crypto.randomUUID();
	const secretDraftText = `TAJNY-DRAFT-${stamp}`;
	const sectionId = crypto.randomUUID();
	const createOperation = crypto.randomUUID();
	const createBody = {
		id: articleId,
		operationId: createOperation,
		workspaceId: workspace.id,
		articleType: "sop",
		title: "Předání klientského projektu",
		summary: "Ověřený postup pro bezpečné předání.",
		tags: ["Klient", "Předání"],
		sections: [{ id: sectionId, title: "Připrav podklady", body: "Zkontroluj úplnost." }],
		audience: "team",
		acknowledgementRequired: false,
		ownerUserId: manager.id,
	};

	try {
		const created = await request(managerCookie, "/api/knowledge", "POST", createBody);
		const createdJson = (await created.json()) as { draftRevision?: number; replayed?: boolean };
		check(
			"manager vytvoří pouze draft",
			created.status === 201 && createdJson.draftRevision === 1 && createdJson.replayed === false,
			createdJson,
		);
		const replay = await request(managerCookie, "/api/knowledge", "POST", createBody);
		check(
			"create retry je idempotentní",
			replay.status === 200 && ((await replay.json()) as { replayed?: boolean }).replayed === true,
		);
		const reused = await request(managerCookie, "/api/knowledge", "POST", {
			...createBody,
			title: "Jiný payload",
		});
		check("operation ID nelze použít pro jiný payload", reused.status === 409);
		const denied = await request(memberCookie, "/api/knowledge", "POST", {
			...createBody,
			id: crypto.randomUUID(),
			operationId: crypto.randomUUID(),
		});
		check("běžný člen nemůže vytvářet řízený obsah", denied.status === 403);

		const memberDraftList = await request(
			memberCookie,
			`/api/knowledge?workspaceId=${workspace.id}`,
		);
		const memberDraftJson = (await memberDraftList.json()) as { articles?: unknown[] };
		const memberDraftDetail = await request(
			memberCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		check(
			"draft není viditelný zaměstnanci",
			memberDraftList.status === 200 &&
				memberDraftJson.articles?.length === 0 &&
				memberDraftDetail.status === 404,
		);

		const publishOneOperation = crypto.randomUUID();
		const publishedOne = await request(
			managerCookie,
			`/api/knowledge/${articleId}/publish`,
			"POST",
			{
				operationId: publishOneOperation,
				expectedDraftRevision: 1,
				changeNote: "První schválená verze",
			},
		);
		const publishedOneJson = (await publishedOne.json()) as {
			publishedVersion?: number;
			replayed?: boolean;
		};
		check(
			"Draft → Publish vytvoří neměnnou verzi 1",
			publishedOne.status === 200 &&
				publishedOneJson.publishedVersion === 1 &&
				publishedOneJson.replayed === false,
			publishedOneJson,
		);
		const publishReplay = await request(
			managerCookie,
			`/api/knowledge/${articleId}/publish`,
			"POST",
			{
				operationId: publishOneOperation,
				expectedDraftRevision: 1,
				changeNote: "První schválená verze",
			},
		);
		check(
			"publish retry nevytvoří další verzi",
			publishReplay.status === 200 &&
				((await publishReplay.json()) as { replayed?: boolean }).replayed === true,
		);

		const memberPublished = await request(
			memberCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		const memberPublishedJson = (await memberPublished.json()) as {
			article?: { published?: { title?: string; sections?: Array<{ body?: string }> }; draft?: unknown };
		};
		const guestHidden = await request(
			guestCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		check(
			"publikovaný interní SOP vidí člen, ale ne host",
			memberPublished.status === 200 &&
				memberPublishedJson.article?.published?.title === "Předání klientského projektu" &&
				memberPublishedJson.article?.draft === undefined &&
				guestHidden.status === 404,
			memberPublishedJson,
		);

		const update = await request(managerCookie, `/api/knowledge/${articleId}`, "PATCH", {
			operationId: crypto.randomUUID(),
			expectedDraftRevision: 1,
			title: "Předání klientského projektu — aktualizace",
			sections: [
				{ id: sectionId, title: "Připrav podklady", body: secretDraftText },
				{ id: crypto.randomUUID(), title: "Potvrď převzetí", body: "Získej výslovné potvrzení." },
			],
			audience: "all_workspace_members",
			acknowledgementRequired: true,
		});
		check("editace po publikaci mění pouze draft revizi 2", update.status === 200);
		const memberStillV1 = await request(
			memberCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		const memberStillV1Text = await memberStillV1.text();
		check(
			"rozpracovaná verze neprosákne do publikovaného read modelu",
			memberStillV1.status === 200 &&
				memberStillV1Text.includes("Zkontroluj úplnost.") &&
				!memberStillV1Text.includes(secretDraftText),
		);

		const stalePublish = await request(
			managerCookie,
			`/api/knowledge/${articleId}/publish`,
			"POST",
			{ operationId: crypto.randomUUID(), expectedDraftRevision: 1 },
		);
		check("zastaralý publish je odmítnut", stalePublish.status === 409);
		const publishedTwo = await request(
			managerCookie,
			`/api/knowledge/${articleId}/publish`,
			"POST",
			{
				operationId: crypto.randomUUID(),
				expectedDraftRevision: 2,
				changeNote: "Rozšířeno pro externí spolupracovníky",
			},
		);
		check(
			"verze 2 bezpečně zpřístupní explicitní publikum a vyžádá potvrzení",
			publishedTwo.status === 200 &&
				((await publishedTwo.json()) as { publishedVersion?: number }).publishedVersion === 2,
		);

		const guestVisible = await request(
			guestCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		const guestVisibleJson = (await guestVisible.json()) as {
			article?: { acknowledgement?: { required?: boolean; acknowledgedByMe?: boolean } };
		};
		check(
			"host vidí pouze výslovně publikovanou verzi",
			guestVisible.status === 200 &&
				guestVisibleJson.article?.acknowledgement?.required === true &&
				guestVisibleJson.article.acknowledgement.acknowledgedByMe === false,
			guestVisibleJson,
		);
		const staleAck = await request(
			memberCookie,
			`/api/knowledge/${articleId}/acknowledge`,
			"POST",
			{ operationId: crypto.randomUUID(), articleVersion: 1 },
		);
		check("potvrzení staré verze není možné", staleAck.status === 409);
		const ackOperation = crypto.randomUUID();
		const ack = await request(
			memberCookie,
			`/api/knowledge/${articleId}/acknowledge`,
			"POST",
			{ operationId: ackOperation, articleVersion: 2 },
		);
		const ackReplay = await request(
			memberCookie,
			`/api/knowledge/${articleId}/acknowledge`,
			"POST",
			{ operationId: ackOperation, articleVersion: 2 },
		);
		check(
			"potvrzení verze je idempotentní",
			ack.status === 200 &&
				ackReplay.status === 200 &&
				((await ackReplay.json()) as { replayed?: boolean }).replayed === true,
		);
		const guestAck = await request(
			guestCookie,
			`/api/knowledge/${articleId}/acknowledge`,
			"POST",
			{ operationId: crypto.randomUUID(), articleVersion: 2 },
		);
		check("oprávněný host může potvrdit svou publikovanou verzi", guestAck.status === 200);

		const managerDetail = await request(
			managerCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		const managerDetailJson = (await managerDetail.json()) as {
			article?: {
				versions?: Array<{ version?: number; acknowledgedCount?: number }>;
				acknowledgement?: { eligibleCount?: number; acknowledgedCount?: number };
			};
		};
		check(
			"správce vidí verze a agregovanou compliance bez skóre lidí",
			managerDetail.status === 200 &&
				managerDetailJson.article?.versions?.length === 2 &&
				managerDetailJson.article.acknowledgement?.eligibleCount === 3 &&
				managerDetailJson.article.acknowledgement.acknowledgedCount === 2 &&
				!JSON.stringify(managerDetailJson).includes("productivity"),
			managerDetailJson,
		);

		const searched = await request(
			memberCookie,
			`/api/knowledge?workspaceId=${workspace.id}&q=${encodeURIComponent("Potvrď převzetí")}`,
		);
		const searchedJson = (await searched.json()) as { articles?: Array<{ id?: string }> };
		check(
			"vyhledávání pokrývá i obsah publikovaných sekcí",
			searched.status === 200 && searchedJson.articles?.[0]?.id === articleId,
			searchedJson,
		);

		let immutable = false;
		try {
			await db.execute(
				sql`UPDATE knowledge_article_versions SET title = 'Podvrh' WHERE article_id = ${articleId}`,
			);
		} catch {
			immutable = true;
		}
		check("publikovaný snapshot odmítá měnit i databáze", immutable);
		let mismatchedSnapshot = false;
		try {
			await db.insert(knowledgeArticleVersions).values({
				articleId,
				workspaceId: workspace.id,
				version: 3,
				draftRevision: 2,
				articleType: "sop",
				title: "Podvržený snapshot",
				tags: [],
				sections: [{ id: crypto.randomUUID(), title: "X", body: "Y" }],
				audience: "team",
				acknowledgementRequired: false,
				publishedBy: manager.id,
			});
		} catch {
			mismatchedSnapshot = true;
		}
		check("DB odmítá snapshot, který neodpovídá draftu", mismatchedSnapshot);

		const badOwner = await request(managerCookie, `/api/knowledge/${articleId}`, "PATCH", {
			operationId: crypto.randomUUID(),
			expectedDraftRevision: 2,
			ownerUserId: outsider.id,
		});
		check("vlastník dokumentu musí patřit do stejného prostoru", badOwner.status === 422);

		const audit = await db
			.select({ diff: auditEvents.diff, before: auditEvents.before })
			.from(auditEvents)
			.where(eq(auditEvents.entityId, articleId));
		check(
			"audit obsahuje metadata, ne text znalosti",
			audit.length >= 5 && !JSON.stringify(audit).includes(secretDraftText),
			audit,
		);

		const archived = await request(
			managerCookie,
			`/api/knowledge/${articleId}/archive`,
			"POST",
			{ operationId: crypto.randomUUID(), expectedPublishedVersion: 2 },
		);
		const hiddenAfterArchive = await request(
			memberCookie,
			`/api/knowledge/${articleId}?workspaceId=${workspace.id}`,
		);
		check(
			"archivace skryje obsah čtenářům, ale zachová historii",
			archived.status === 200 && hiddenAfterArchive.status === 404,
		);

		const ackRows = await db
			.select()
			.from(knowledgeAcknowledgements)
			.where(eq(knowledgeAcknowledgements.articleId, articleId));
		const versions = await db
			.select()
			.from(knowledgeArticleVersions)
			.where(eq(knowledgeArticleVersions.articleId, articleId));
		check("datový model zachoval dvě potvrzení a dvě verze", ackRows.length === 2 && versions.length === 2);

		const exported = await request(managerCookie, "/api/export");
		const backup = (await exported.json()) as {
			manifest?: { counts?: Record<string, number> };
			tables?: Record<string, Array<Record<string, unknown>>>;
		};
		check(
			"podepsaný export obsahuje článek, obě verze a potvrzení",
			exported.status === 200 &&
				backup.tables?.knowledge_articles?.some((row) => row.id === articleId) === true &&
				backup.tables?.knowledge_article_versions?.filter((row) => row.article_id === articleId)
					.length === 2 &&
				backup.tables?.knowledge_acknowledgements?.filter((row) => row.article_id === articleId)
					.length === 2 &&
				backup.tables?.knowledge_command_receipts === undefined,
			backup.manifest?.counts,
		);
		await db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, articleId));
		const restored = await request(managerCookie, "/api/restore", "POST", {
			mode: "apply",
			conflictMode: "skip",
			backup,
		});
		const restoredJson = (await restored.json()) as {
			report?: { inserted?: Record<string, number> };
			error?: string;
			code?: string;
		};
		const restoredVersions = await db
			.select()
			.from(knowledgeArticleVersions)
			.where(eq(knowledgeArticleVersions.articleId, articleId));
		const restoredAcknowledgements = await db
			.select()
			.from(knowledgeAcknowledgements)
			.where(eq(knowledgeAcknowledgements.articleId, articleId));
		check(
			"restore obnoví finální stav i historické snapshoty v bezpečném pořadí",
			restored.status === 200 &&
				restoredJson.report?.inserted?.knowledge_articles === 1 &&
				restoredJson.report.inserted.knowledge_article_versions === 2 &&
				restoredJson.report.inserted.knowledge_acknowledgements === 2 &&
				restoredVersions.length === 2 &&
				restoredAcknowledgements.length === 2,
			restoredJson,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
		await db.delete(users).where(eq(users.id, guest.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, manager.id));
		await db.delete(users).where(eq(users.id, outsider.id));
	}

	if (failed) throw new Error(`${failed} knowledge checks failed`);
	console.log("\nEmployee Knowledge & SOP: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
