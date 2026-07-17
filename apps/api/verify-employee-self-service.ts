/** End-to-end proof of the LuckyOS v1 employee self-service boundary. */
import "./src/env";
import { createHmac, randomUUID } from "node:crypto";
import {
	and,
	availabilityBlocks,
	eq,
	getDb,
	integrationConnections,
	luckyOsEventInbox,
	luckyOsIdentityBindings,
	memberships,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { readTaskAvailabilityConflicts } from "./src/taskAvailability";

const API = process.env.EMPLOYEE_SELF_SERVICE_API ?? "http://127.0.0.1:8790";
const organizationId = process.env.LUCKYOS_ORGANIZATION_ID ?? "";
const webhookSecret = process.env.LUCKYOS_WEBHOOK_SIGNING_SECRET ?? "";
const db = getDb();
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
}

async function login(email: string) {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`employee_self_service_magic_link:${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as unknown as Array<{ identifier: string }>;
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error("employee_self_service_login_cookie_missing");
	return cookie;
}

async function request(
	cookie: string | null,
	path: string,
	options: { method?: string; body?: unknown } = {},
) {
	const method = options.method ?? "GET";
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: "http://localhost:5173",
			...(cookie ? { Cookie: cookie } : {}),
			...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	return {
		status: response.status,
		text,
		body: JSON.parse(text || "{}") as Record<string, unknown>,
		cacheControl: response.headers.get("cache-control") ?? "",
	};
}

async function multipartRequest(
	cookie: string,
	path: string,
	fields: Record<string, string>,
	file: File,
) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	form.set("file", file, file.name);
	const response = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { Origin: "http://localhost:5173", Cookie: cookie },
		body: form,
	});
	const text = await response.text();
	return {
		status: response.status,
		text,
		body: JSON.parse(text || "{}") as Record<string, unknown>,
		cacheControl: response.headers.get("cache-control") ?? "",
	};
}

async function provisionIdentity(userId: string, providerPersonId: string) {
	const eventId = randomUUID();
	const payload = {
		schema_version: 1,
		event_id: eventId,
		event_type: "employee.access.changed",
		organization_id: organizationId,
		aggregate: { type: "external_identity_link", id: randomUUID(), version: 1 },
		person_id: providerPersonId,
		occurred_at: "2026-07-17T09:00:00.000Z",
		correlation_id: `self-service-${eventId}`,
		payload: { person_id: providerPersonId, watson_user_id: userId, status: "active", reason_code: null },
	};
	const body = JSON.stringify(payload);
	const timestamp = new Date().toISOString();
	const signature = `v1=${createHmac("sha256", webhookSecret)
		.update(`${timestamp}.${body}`, "utf8")
		.digest("hex")}`;
	const response = await fetch(`${API}/api/integrations/luckyos/v1/events`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": `self-service:${eventId}`,
			"x-lucky-event-id": eventId,
			"x-lucky-timestamp": timestamp,
			"x-lucky-signature": signature,
		},
		body,
	});
	if (response.status !== 202) {
		throw new Error(`employee_self_service_identity:${response.status}:${await response.text()}`);
	}
	return eventId;
}

async function sendAbsenceEvent(
	providerPersonId: string,
	caseId: string,
	version: number,
	eventId: string,
	payloadVersion = version,
) {
	const payload = {
		schema_version: 1,
		event_id: eventId,
		event_type: "employee.domain.assignments.closed",
		organization_id: organizationId,
		aggregate: { type: "employee_domain_case", id: caseId, version },
		person_id: providerPersonId,
		occurred_at: "2026-07-17T09:00:00.000Z",
		correlation_id: `absence-${eventId}`,
		payload: {
			agenda: "assignments",
			entity_type: "employee_domain_case",
			entity_id: caseId,
			version: payloadVersion,
			change_type: "closed",
			data: { status: "resolved", case_type: "absence" },
		},
	};
	const body = JSON.stringify(payload);
	const timestamp = new Date().toISOString();
	const signature = `v1=${createHmac("sha256", webhookSecret)
		.update(`${timestamp}.${body}`, "utf8")
		.digest("hex")}`;
	const response = await fetch(`${API}/api/integrations/luckyos/v1/events`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": `absence:${eventId}`,
			"x-lucky-event-id": eventId,
			"x-lucky-timestamp": timestamp,
			"x-lucky-signature": signature,
		},
		body,
	});
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function main() {
	if (process.env.LUCKYOS_PROTOCOL !== "v1" || !organizationId || !webhookSecret) {
		throw new Error("employee self-service verifier requires the LuckyOS v1 environment");
	}
	if (!process.env.LUCKYOS_BASE_URL?.startsWith("http://127.0.0.1:")) {
		throw new Error("employee self-service verifier requires the local LuckyOS stub");
	}
	const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
	const [user] = await db
		.insert(users)
		.values({
			name: "Employee self-service verifier",
			email: `employee-self-service-${suffix}@watson.test`,
			emailVerified: true,
		})
		.returning({ id: users.id, email: users.email });
	if (!user) throw new Error("employee_self_service_user_missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Employee self-service ${suffix}`, ownerId: user.id, isPersonal: true })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("employee_self_service_workspace_missing");
	await db.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
	const [teamWorkspace] = await db
		.insert(workspaces)
		.values({ name: `Employee team ${suffix}`, ownerId: user.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!teamWorkspace) throw new Error("employee_self_service_team_workspace_missing");
	await db.insert(memberships).values({ workspaceId: teamWorkspace.id, userId: user.id, role: "admin" });
	const providerPersonId = `person-${suffix}`;
	const eventId = await provisionIdentity(user.id, providerPersonId);
	let absenceEventId: string | null = null;

	try {
		const unauthorized = await request(null, "/api/employee/self-service/profile");
		check(
			"self-service vyžaduje session a odpověď nelze cachovat",
			unauthorized.status === 401 && unauthorized.cacheControl.includes("no-store"),
			unauthorized,
		);
		const cookie = await login(user.email);

		const hub = await request(cookie, "/api/employee/status");
		const hubStatus = hub.body.status as Record<string, unknown> | undefined;
		const notifications = hubStatus?.notifications as Array<Record<string, unknown>> | undefined;
		check(
			"v1 Hub zapne self-service a bezpečně mapuje work item na akční Watson typ",
			hub.status === 200 &&
				hub.body.linked === true &&
				hub.body.selfService === true &&
				notifications?.[0]?.type === "attendance_reminder" &&
				notifications?.[0]?.href === "/zamestnanec#dochazka" &&
				!hub.text.includes("upstream_secret") &&
				!hub.text.includes("provider_person"),
			hub.body,
		);

		const profile = await request(cookie, "/api/employee/self-service/profile");
		const publicProfile = profile.body.profile as Record<string, unknown> | undefined;
		const profileRequests = profile.body.requests as Array<Record<string, unknown>> | undefined;
		check(
			"profil maskuje účet a změnové žádosti nevracejí zadané hodnoty",
			profile.status === 200 &&
				publicProfile?.name === "CI Employee v1" &&
				publicProfile?.bankAccountMasked === "•••• 0100" &&
				profileRequests?.[0]?.status === "pending" &&
				Array.isArray(profileRequests?.[0]?.fields) &&
				!profile.text.includes("123456789") &&
				!profile.text.includes("777 000") &&
				!profile.text.includes("must-not-leak"),
			profile.body,
		);

		const profileOperation = randomUUID();
		const profileChange = await request(cookie, "/api/employee/self-service/profile-change", {
			method: "POST",
			body: { operationId: profileOperation, patch: { phone: "+420 777 123 456" } },
		});
		const profileReplay = await request(cookie, "/api/employee/self-service/profile-change", {
			method: "POST",
			body: { operationId: profileOperation, patch: { phone: "+420 777 123 456" } },
		});
		const profileConflict = await request(cookie, "/api/employee/self-service/profile-change", {
			method: "POST",
			body: { operationId: profileOperation, patch: { phone: "+420 777 654 321" } },
		});
		check(
			"profilová změna je explicitní, idempotentní a upstream data zůstávají skrytá",
			profileChange.status === 201 &&
				profileReplay.status === 201 &&
				profileReplay.body.replayed === true &&
				!profileChange.text.includes("must-not-leak"),
			{ profileChange, profileReplay },
		);
		check(
			"stejný operationId s jiným obsahem skončí bezpečným konfliktem",
			profileConflict.status === 409 &&
				profileConflict.body.error === "domain_version_or_state_conflict" &&
				!profileConflict.text.includes("must-not-leak"),
			profileConflict,
		);

		const attendance = await request(cookie, "/api/employee/self-service/attendance?period=2026-07");
		const attendanceData = attendance.body.attendance as Record<string, unknown> | undefined;
		const attendanceRows = attendanceData?.records as Array<Record<string, unknown>> | undefined;
		check(
			"docházka vrací jen vybraný měsíc a veřejnou projekci",
			attendance.status === 200 &&
				attendanceData?.status === "draft" &&
				attendanceData?.expectedVersion === 1 &&
				attendanceRows?.[0]?.hours === 2.5 &&
				!attendance.text.includes("provider_only") &&
				!attendance.text.includes("must-not-leak"),
			attendance.body,
		);
		const invalidFuture = await request(cookie, "/api/employee/self-service/attendance", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				period: "2100-07",
				expectedVersion: 0,
				action: "save_draft",
				records: [{ id: "future", date: "2100-07-01", activityType: "other", hours: 1, note: "Budoucnost" }],
			},
		});
		check("budoucí docházku odmítne Watson před providerem", invalidFuture.status === 422, invalidFuture);

		const attendanceOperation = randomUUID();
		const attendanceBody = {
			operationId: attendanceOperation,
			period: "2026-07",
			expectedVersion: 1,
			action: "save_draft",
			records: [{ id: "training-2026-07-02", date: "2026-07-02", activityType: "training", hours: 2.5, note: "Trénink" }],
		};
		const attendanceSave = await request(cookie, "/api/employee/self-service/attendance", {
			method: "POST",
			body: attendanceBody,
		});
		const attendanceReplay = await request(cookie, "/api/employee/self-service/attendance", {
			method: "POST",
			body: attendanceBody,
		});
		const attendanceSubmit = await request(cookie, "/api/employee/self-service/attendance", {
			method: "POST",
			body: { ...attendanceBody, operationId: randomUUID(), action: "submit" },
		});
		check(
			"docházka rozlišuje koncept a explicitní odevzdání s idempotentním retry",
			attendanceSave.status === 200 &&
				attendanceReplay.body.replayed === true &&
				(attendanceSubmit.body.entity as Record<string, unknown> | undefined)?.status === "submitted" &&
				!attendanceSubmit.text.includes("must-not-leak"),
			{ attendanceSave, attendanceReplay, attendanceSubmit },
		);

		const smallNumbers = await request(cookie, "/api/employee/self-service/small-numbers?period=2026-07");
		const smallData = smallNumbers.body.smallNumbers as Record<string, unknown> | undefined;
		const choreographies = smallData?.choreographies as Array<Record<string, unknown>> | undefined;
		const entries = smallData?.entries as Array<Record<string, unknown>> | undefined;
		check(
			"malá čísla vracejí choreografie a měsíční koncept bez provider metadata",
			smallNumbers.status === 200 &&
				choreographies?.[0]?.name === "Sólová choreografie" &&
				entries?.[0]?.hoursMinutes === 90 &&
				!smallNumbers.text.includes("trainer_ids") &&
				!smallNumbers.text.includes("must-not-leak"),
			smallNumbers.body,
		);
		const invalidMinutes = await request(cookie, "/api/employee/self-service/small-numbers", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				period: "2026-07",
				expectedVersion: 2,
				choreographyId: "choreography-ci",
				hoursMinutes: 65,
				note: null,
				status: "draft",
			},
		});
		const smallSave = await request(cookie, "/api/employee/self-service/small-numbers", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				period: "2026-07",
				expectedVersion: 2,
				choreographyId: "choreography-ci",
				hoursMinutes: 105,
				note: "Doplněno",
				status: "submitted",
			},
		});
		check(
			"malá čísla hlídají povolené minuty a umějí explicitní odevzdání",
			invalidMinutes.status === 422 &&
				smallSave.status === 200 &&
				(smallSave.body.entity as Record<string, unknown> | undefined)?.status === "submitted" &&
				!smallSave.text.includes("must-not-leak"),
			{ invalidMinutes, smallSave },
		);

		const absencesBefore = await request(cookie, "/api/employee/self-service/absences");
		check(
			"absence se čtou online z LuckyOS a prázdný stav neobsahuje HR payload",
			absencesBefore.status === 200 &&
				Array.isArray(absencesBefore.body.cases) &&
				(absencesBefore.body.cases as unknown[]).length === 0 &&
				!absencesBefore.text.includes("employee_message") &&
				!absencesBefore.text.includes("internal_payload"),
			absencesBefore.body,
		);
		const invalidAbsence = await request(cookie, "/api/employee/self-service/absences", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				kind: "vacation",
				startDate: "2026-08-12",
				endDate: "2026-08-10",
				timezone: "Europe/Prague",
				visibility: "team",
				note: null,
			},
		});
		check(
			"neplatné nebo obrácené období skončí před provider commandem",
			invalidAbsence.status === 422 && invalidAbsence.body.error === "invalid_absence_request",
			invalidAbsence,
		);
		const absenceOperation = randomUUID();
		const sensitiveAbsenceNote = "Citlivá poznámka pouze pro oprávněnou osobu";
		const absenceBody = {
			operationId: absenceOperation,
			kind: "vacation",
			startDate: "2026-08-10",
			endDate: "2026-08-12",
			timezone: "Europe/Prague",
			visibility: "team",
			note: sensitiveAbsenceNote,
		};
		const absenceCreate = await request(cookie, "/api/employee/self-service/absences", {
			method: "POST",
			body: absenceBody,
		});
		const absenceReplay = await request(cookie, "/api/employee/self-service/absences", {
			method: "POST",
			body: absenceBody,
		});
		const overlappingAbsence = await request(cookie, "/api/employee/self-service/absences", {
			method: "POST",
			body: { ...absenceBody, operationId: randomUUID(), startDate: "2026-08-11" },
		});
		const pendingBlocks = await db
			.select()
			.from(availabilityBlocks)
			.where(
				and(
					eq(availabilityBlocks.userId, user.id),
					eq(availabilityBlocks.source, "luckyos"),
					eq(availabilityBlocks.externalId, absenceOperation),
				),
			);
		const pendingScheduling = await readTaskAvailabilityConflicts(db, {
			workspaceId: teamWorkspace.id,
			policy: "strict",
			actorUserId: user.id,
			taskId: null,
			startsAt: new Date("2026-08-11T08:00:00.000Z"),
			durationMin: 60,
			assigneeIds: [user.id],
		});
		check(
			"žádost je idempotentní, hlídá překryv a čekající projekce ještě neblokuje plánování",
			absenceCreate.status === 201 &&
				absenceReplay.status === 200 &&
				absenceReplay.body.replayed === true &&
				overlappingAbsence.status === 409 &&
				overlappingAbsence.body.error === "absence_overlap" &&
				pendingBlocks.length === 2 &&
				pendingBlocks.every(
					(block) => block.approvalStatus === "pending" && block.cancelledAt === null,
				) &&
				pendingScheduling.canSchedule === true &&
				pendingScheduling.conflicts.length === 0 &&
				!absenceCreate.text.includes(sensitiveAbsenceNote),
			{ absenceCreate, absenceReplay, overlappingAbsence, pendingBlocks, pendingScheduling },
		);
		const invalidAbsenceEvent = await sendAbsenceEvent(
			providerPersonId,
			absenceOperation,
			2,
			randomUUID(),
			1,
		);
		check(
			"event s nesouhlasnou payload verzí je odmítnut před trvalým inboxem",
			invalidAbsenceEvent.status === 422 &&
				invalidAbsenceEvent.body.error === "invalid_absence_event",
			invalidAbsenceEvent,
		);
		absenceEventId = randomUUID();
		const absenceEventBeforeProvider = await sendAbsenceEvent(
			providerPersonId,
			absenceOperation,
			2,
			absenceEventId,
		);
		const stubBase = process.env.LUCKYOS_BASE_URL ?? "";
		const providerResolve = await fetch(
			`${stubBase}/__test__/absence/${encodeURIComponent(absenceOperation)}/status`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status: "resolved", resolution_public: "Schváleno vedoucím" }),
			},
		);
		const absenceEvent = await sendAbsenceEvent(
			providerPersonId,
			absenceOperation,
			2,
			absenceEventId,
		);
		const absenceEventReplay = await sendAbsenceEvent(
			providerPersonId,
			absenceOperation,
			2,
			absenceEventId,
		);
		const approvedBlocks = await db
			.select()
			.from(availabilityBlocks)
			.where(
				and(
					eq(availabilityBlocks.userId, user.id),
					eq(availabilityBlocks.source, "luckyos"),
					eq(availabilityBlocks.externalId, absenceOperation),
				),
			);
		const approvedScheduling = await readTaskAvailabilityConflicts(db, {
			workspaceId: teamWorkspace.id,
			policy: "strict",
			actorUserId: user.id,
			taskId: null,
			startsAt: new Date("2026-08-11T08:00:00.000Z"),
			durationMin: 60,
			assigneeIds: [user.id],
		});
		const absencesAfter = await request(cookie, "/api/employee/self-service/absences");
		const approvedCases = absencesAfter.body.cases as Array<Record<string, unknown>> | undefined;
		const auditLeak = (await db.execute(sql`
			SELECT 1 FROM audit_events
			WHERE workspace_id IN (${workspace.id}::uuid, ${teamWorkspace.id}::uuid)
			  AND (coalesce(diff, '{}'::jsonb)::text || coalesce(before, '{}'::jsonb)::text)
			      LIKE ${`%${sensitiveAbsenceNote}%`}
			LIMIT 1
		`)) as unknown[];
		check(
			"podepsaná změna počká na autoritativní read model a pak schválí projekci bez úniku poznámky",
			absenceEventBeforeProvider.status === 503 &&
				absenceEventBeforeProvider.body.error === "absence_projection_unavailable" &&
				providerResolve.status === 200 &&
				absenceEvent.status === 200 &&
				absenceEvent.body.disposition === "absence_projected" &&
				absenceEventReplay.status === 200 &&
				approvedBlocks.length === 2 &&
				approvedBlocks.every(
					(block) => block.approvalStatus === "approved" && block.version === 2,
				) &&
				approvedScheduling.canSchedule === false &&
				approvedScheduling.conflicts.length === 1 &&
				approvedCases?.[0]?.status === "resolved" &&
				approvedCases?.[0]?.resolutionPublic === "Schváleno vedoucím" &&
				auditLeak.length === 0 &&
				!absencesAfter.text.includes(sensitiveAbsenceNote) &&
				!absencesAfter.text.includes('"priority"') &&
				!absencesAfter.text.includes("internal_payload"),
			{
					absenceEventBeforeProvider,
					providerResolve: providerResolve.status,
					absenceEvent,
					absenceEventReplay,
					approvedBlocks,
					approvedScheduling,
					absencesAfter: absencesAfter.body,
					auditLeak,
				},
		);

		const documents = await request(cookie, "/api/employee/self-service/documents");
		const ownDocuments = documents.body.documents as Array<Record<string, unknown>> | undefined;
		const publishedDocuments = documents.body.publishedDocuments as
			| Array<Record<string, unknown>>
			| undefined;
		check(
			"dokumenty slučují vlastní review stav a publikované soubory bez storage identifikátorů",
			documents.status === 200 &&
				ownDocuments?.[0]?.reviewStatus === "pending" &&
				publishedDocuments?.[0]?.title === "Výplatnice červen 2026" &&
				!documents.text.includes("storage_file_id") &&
				!documents.text.includes("sha256") &&
				!documents.text.includes("fileSha256") &&
				!documents.text.includes("must-not-leak"),
			documents.body,
		);
		const publishedContent = await fetch(
			`${API}/api/employee/self-service/published-documents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/content`,
			{ headers: { Origin: "http://localhost:5173", Cookie: cookie } },
		);
		const publishedBytes = Buffer.from(await publishedContent.arrayBuffer());
		check(
			"publikovaný dokument se streamuje přes person-scoped facade a nesmí se cachovat",
			publishedContent.status === 200 &&
				publishedContent.headers.get("content-type") === "application/pdf" &&
				publishedContent.headers.get("cache-control")?.includes("no-store") === true &&
				publishedBytes.subarray(0, 4).toString("ascii") === "%PDF",
			{
				status: publishedContent.status,
				headers: Object.fromEntries(publishedContent.headers),
			},
		);

		const invalidFile = await multipartRequest(
			cookie,
			"/api/employee/self-service/documents",
			{ operationId: randomUUID(), type: "other" },
			new File([Buffer.from([0, 1, 2, 3])], "payload.exe", {
				type: "application/octet-stream",
			}),
		);
		check(
			"nepodporovaný obsah je odmítnut před upload intentem",
			invalidFile.status === 415 && invalidFile.body.error === "employee_file_type_not_allowed",
			invalidFile,
		);
		const mismatchedFile = await multipartRequest(
			cookie,
			"/api/employee/self-service/documents",
			{ operationId: randomUUID(), type: "other" },
			new File([Buffer.from("%PDF-1.4\n%%EOF\n", "utf8")], "falesny-obrazek.png", {
				type: "image/png",
			}),
		);
		check(
			"přípona, deklarovaný typ a magic bytes se nesmí rozcházet",
			mismatchedFile.status === 415 &&
				mismatchedFile.body.error === "employee_file_type_not_allowed",
			mismatchedFile,
		);
		const pdf = new File(
			[Buffer.from("%PDF-1.4\nWatson employee document\n%%EOF\n", "utf8")],
			"potvrzeni.pdf",
			{ type: "application/pdf", lastModified: 1_752_739_200_000 },
		);
		const documentOperation = randomUUID();
		const documentFields = {
			operationId: documentOperation,
			type: "bank_account_confirmation",
			note: "Potvrzení účtu",
			validFrom: "2026-07-01",
			validUntil: "2026-12-31",
		};
		const documentUpload = await multipartRequest(
			cookie,
			"/api/employee/self-service/documents",
			documentFields,
			pdf,
		);
		const documentReplay = await multipartRequest(
			cookie,
			"/api/employee/self-service/documents",
			documentFields,
			pdf,
		);
		check(
			"dokument používá hashovaný intent, ověřené bytes, atomický finalize a stabilní retry",
			documentUpload.status === 201 &&
				documentReplay.status === 201 &&
				documentReplay.body.replayed === true &&
				(documentUpload.body.document as Record<string, unknown> | undefined)?.reviewStatus ===
					"pending" &&
				!documentUpload.text.includes("storage_file_id") &&
				!documentUpload.text.includes("must-not-leak"),
			{ documentUpload, documentReplay },
		);

		const expenses = await request(cookie, "/api/employee/self-service/expenses");
		const claims = expenses.body.claims as Array<Record<string, unknown>> | undefined;
		const trainerProjects = expenses.body.trainerProjects as
			| Array<Record<string, unknown>>
			| undefined;
		check(
			"výdaje vracejí bezpečný stav i vlastní trenérské projekty bez receipt storage detailů",
			expenses.status === 200 &&
				claims?.[0]?.status === "submitted" &&
				trainerProjects?.[0]?.name === "Letní soustředění" &&
				!expenses.text.includes("owner_trainer_ids") &&
				!expenses.text.includes("storage_file_id") &&
				!expenses.text.includes("sha256") &&
				!expenses.text.includes("must-not-leak"),
			expenses.body,
		);
		const expenseOperation = randomUUID();
		const expenseFields = {
			operationId: expenseOperation,
			title: "Jízdenka Brno",
			amount: "240",
			currency: "CZK",
			date: "2026-07-16",
			paymentSource: "personal_card",
			category: "transport",
			reimbursementSource: "accounting",
		};
		const expenseUpload = await multipartRequest(
			cookie,
			"/api/employee/self-service/expenses",
			expenseFields,
			pdf,
		);
		const expenseReplay = await multipartRequest(
			cookie,
			"/api/employee/self-service/expenses",
			expenseFields,
			pdf,
		);
		check(
			"účtenka a claim mají oddělený účel, serverový CZK přepočet a idempotentní finalize",
			expenseUpload.status === 201 &&
				expenseReplay.body.replayed === true &&
				(expenseUpload.body.claim as Record<string, unknown> | undefined)?.amountCzk === 240 &&
				!expenseUpload.text.includes("must-not-leak"),
			{ expenseUpload, expenseReplay },
		);

		const contracts = await request(cookie, "/api/employee/self-service/contracts");
		const contractRows = contracts.body.contracts as Array<Record<string, unknown>> | undefined;
		check(
			"smlouvy zveřejní jen bezpečnou verzi a odvodí signable stav",
			contracts.status === 200 &&
				contractRows?.[0]?.version === 4 &&
				contractRows?.[0]?.canSign === true &&
				!contracts.text.includes("employer_private_note") &&
				!contracts.text.includes("finalPdfSha256") &&
				!contracts.text.includes("must-not-leak"),
			contracts.body,
		);
		const signature = `data:image/png;base64,${"A".repeat(96)}`;
		const missingConsent = await request(cookie, "/api/employee/self-service/contracts/sign", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				contractId: "contract-ci",
				expectedVersion: 4,
				fullName: "CI Employee v1",
				birthDate: "1990-01-02",
				bankAccountSuffix: "6789",
				signatureDataUrl: signature,
			},
		});
		check(
			"podpisový command bez explicitního souhlasu skončí před providerem",
			missingConsent.status === 422 && missingConsent.body.error === "invalid_contract_signature",
			missingConsent,
		);
		const invalidBankSuffix = await request(cookie, "/api/employee/self-service/contracts/sign", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				contractId: "contract-ci",
				expectedVersion: 4,
				consent: true,
				fullName: "CI Employee v1",
				birthDate: "1990-01-02",
				bankAccountSuffix: "789",
				signatureDataUrl: signature,
			},
		});
		check(
			"bankovní challenge přijme jen přesně čtyři číslice nebo žádnou hodnotu",
			invalidBankSuffix.status === 422 &&
				invalidBankSuffix.body.error === "invalid_contract_signature",
			invalidBankSuffix,
		);
		const invalidSignature = await request(cookie, "/api/employee/self-service/contracts/sign", {
			method: "POST",
			body: {
				operationId: randomUUID(),
				contractId: "contract-ci",
				expectedVersion: 4,
				consent: true,
				fullName: "Nesprávné jméno",
				birthDate: "1990-01-02",
				bankAccountSuffix: "6789",
				signatureDataUrl: signature,
			},
		});
		check(
			"chybná podpisová challenge vrací pouze bezpečný kód",
			invalidSignature.status === 400 &&
				invalidSignature.body.error === "signature_challenge_failed" &&
				!invalidSignature.text.includes("must-not-leak"),
			invalidSignature,
		);
		const contractOperation = randomUUID();
		const signBody = {
			operationId: contractOperation,
			contractId: "contract-ci",
			expectedVersion: 4,
			consent: true,
			fullName: "CI Employee v1",
			birthDate: "1990-01-02",
			bankAccountSuffix: "6789",
			signatureDataUrl: signature,
		};
		const signed = await request(cookie, "/api/employee/self-service/contracts/sign", {
			method: "POST",
			body: signBody,
		});
		const signedReplay = await request(cookie, "/api/employee/self-service/contracts/sign", {
			method: "POST",
			body: signBody,
		});
		check(
			"podpis je verzovaný, potvrzený LuckyOS a retry nevrací podpisový obrázek ani storage metadata",
			signed.status === 200 &&
				signedReplay.body.replayed === true &&
				(signed.body.contract as Record<string, unknown> | undefined)?.signedDate ===
					"2026-07-17" &&
				!signed.text.includes("signature_image_data_url") &&
				!signed.text.includes("storage_file_id") &&
				!signed.text.includes("finalPdfSha256") &&
				!signed.text.includes("must-not-leak"),
			{ signed, signedReplay },
		);

		const sync = await request(cookie, "/api/employee/sync", { method: "POST", body: {} });
		const employeeProjects = await db
			.select({ id: projects.id })
			.from(projects)
			.where(and(eq(projects.workspaceId, workspace.id), eq(projects.name, "Zaměstnanec")));
		const syncedTasks = employeeProjects[0]
			? await db.select().from(tasks).where(eq(tasks.projectId, employeeProjects[0].id))
			: [];
		check(
			"v1 work item se synchronizuje do jednoho osobního úkolu",
			sync.status === 200 && sync.body.created === 1 && syncedTasks[0]?.name === "Odevzdej docházku za červenec",
			{ sync, syncedTasks },
		);

		await db
			.update(integrationConnections)
			.set({ status: "revoked", revokedAt: new Date() })
			.where(
				and(
					eq(integrationConnections.ownerUserId, user.id),
					eq(integrationConnections.provider, "luckyos"),
				),
			);
		const revoked = await request(cookie, "/api/employee/self-service/profile");
		check(
			"lokální revoke zastaví self-service ještě před vydáním provider tokenu",
			revoked.status === 423 && revoked.body.error === "luckyos_revoked",
			revoked,
		);
	} finally {
		if (absenceEventId) {
			await db.delete(luckyOsEventInbox).where(eq(luckyOsEventInbox.eventId, absenceEventId));
		}
		await db.delete(luckyOsEventInbox).where(eq(luckyOsEventInbox.eventId, eventId));
		await db.delete(luckyOsIdentityBindings).where(eq(luckyOsIdentityBindings.ownerUserId, user.id));
		await db.delete(workspaces).where(eq(workspaces.id, teamWorkspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, user.id));
	}

	if (failed > 0) {
		console.error(`\nEmployee self-service API: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nEmployee self-service API: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
