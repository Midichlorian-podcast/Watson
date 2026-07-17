/** End-to-end proof of the LuckyOS v1 employee self-service boundary. */
import "./src/env";
import { createHmac, randomUUID } from "node:crypto";
import {
	and,
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

async function provisionIdentity(userId: string, providerPersonId: string) {
	const eventId = randomUUID();
	const payload = {
		schema_version: 1,
		event_id: eventId,
		event_type: "employee.access.changed",
		organization_id: organizationId,
		aggregate: { type: "external_identity_link", id: randomUUID(), version: 1 },
		person_id: providerPersonId,
		occurred_at: new Date().toISOString(),
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
	const eventId = await provisionIdentity(user.id, `person-${suffix}`);

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
		await db.delete(luckyOsEventInbox).where(eq(luckyOsEventInbox.eventId, eventId));
		await db.delete(luckyOsIdentityBindings).where(eq(luckyOsIdentityBindings.ownerUserId, user.id));
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
