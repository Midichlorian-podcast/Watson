/** Integrační důkaz uložených pohledů: tenant, role, idempotence, CAS a audit. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	filters,
	getDb,
	memberships,
	projects,
	sql,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.SAVED_VIEWS_API ?? "http://127.0.0.1:8790";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
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
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
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
	if (!cookie) throw new Error(`login ${email}: no cookie`);
	return cookie;
}

const config = (projectIds: string[] = []) => ({
	priorities: [1],
	statuses: ["probiha"],
	projects: projectIds,
	people: ["me"],
	due: ["next7"],
	sortBy: "due",
	asc: true,
	showDone: false,
	groupBy: "project",
	viewMode: "list",
	density: "vyvazene",
});
const request = (
	cookie: string,
	method: "POST" | "PATCH" | "DELETE",
	path: string,
	body?: Record<string, unknown>,
) =>
	fetch(`${API}${path}`, {
		method,
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", Cookie: cookie },
		body: body ? JSON.stringify(body) : undefined,
	});

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [manager, member] = await db
		.insert(users)
		.values([
			{ id: crypto.randomUUID(), name: "Views manager", email: `views-manager-${suffix}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Views member", email: `views-member-${suffix}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	if (!manager || !member) throw new Error("saved-view users missing");
	const [workspace, otherWorkspace] = await db
		.insert(workspaces)
		.values([
			{ name: `Views ${suffix}`, ownerId: manager.id, isPersonal: false },
			{ name: `Views other ${suffix}`, ownerId: manager.id, isPersonal: false },
		])
		.returning({ id: workspaces.id });
	if (!workspace || !otherWorkspace) throw new Error("saved-view workspaces missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: manager.id, role: "manager" },
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
		{ workspaceId: otherWorkspace.id, userId: manager.id, role: "manager" },
	]);
	const [teamProject, restrictedProject, otherProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: manager.id, name: "Team project", visibility: "team" },
			{ workspaceId: workspace.id, ownerId: manager.id, name: "Restricted project", visibility: "restricted" },
			{ workspaceId: otherWorkspace.id, ownerId: manager.id, name: "Other project", visibility: "team" },
		])
		.returning({ id: projects.id });
	if (!teamProject || !restrictedProject || !otherProject) throw new Error("saved-view projects missing");

	try {
		const managerCookie = await login(manager.email);
		const memberCookie = await login(member.email);
		const personalId = crypto.randomUUID();
		const personalBody = {
			id: personalId,
			workspaceId: workspace.id,
			name: "Moje P1",
			scope: "personal",
			config: config([teamProject.id]),
		};
		let response = await request(memberCookie, "POST", "/api/saved-views", personalBody);
		check("člen uloží osobní pohled", response.status === 201, response.status);
		let stored = (await db.select().from(filters).where(eq(filters.id, personalId)))[0];
		check(
			"server odvodil autora, tenant a strukturovanou verzi",
			stored?.userId === member.id && stored.workspaceId === workspace.id && stored.query === "tasks:v1" && stored.version === 1,
			stored,
		);
		response = await request(memberCookie, "POST", "/api/saved-views", personalBody);
		check("stejné create id je idempotentní replay", response.status === 200, response.status);
		check(
			"replay nevytvořil duplikát",
			(await db.select().from(filters).where(eq(filters.id, personalId))).length === 1,
		);

		response = await request(memberCookie, "POST", "/api/saved-views", {
			...personalBody,
			id: crypto.randomUUID(),
			name: "Tým bez práva",
			scope: "team",
		});
		check("běžný člen nevytvoří týmový pohled", response.status === 403, response.status);

		const teamId = crypto.randomUUID();
		response = await request(managerCookie, "POST", "/api/saved-views", {
			id: teamId,
			workspaceId: workspace.id,
			name: "Týmový týden",
			scope: "team",
			config: config([teamProject.id]),
		});
		check("vedení vytvoří týmový pohled", response.status === 201, response.status);
		response = await request(managerCookie, "POST", "/api/saved-views", {
			id: crypto.randomUUID(),
			workspaceId: workspace.id,
			name: "Únik projektu",
			scope: "team",
			config: config([restrictedProject.id]),
		});
		check("týmový pohled neprozradí restricted projekt", response.status === 422, response.status);
		response = await request(managerCookie, "POST", "/api/saved-views", {
			id: crypto.randomUUID(),
			workspaceId: workspace.id,
			name: "Cizí tenant",
			scope: "personal",
			config: config([otherProject.id]),
		});
		check("konfigurace nepřijme projekt z jiného prostoru", response.status === 422, response.status);

		response = await request(managerCookie, "PATCH", `/api/saved-views/${personalId}`, {
			name: "Cizí osobní",
			config: config(),
			expectedVersion: 1,
		});
		check("vedení nemění cizí osobní pohled", response.status === 403, response.status);
		response = await request(memberCookie, "PATCH", `/api/saved-views/${personalId}`, {
			name: "Moje P1 upravené",
			config: { ...config([teamProject.id]), groupBy: "priority" },
			expectedVersion: 1,
		});
		check("autor aktualizuje pohled přes CAS", response.status === 200, response.status);
		stored = (await db.select().from(filters).where(eq(filters.id, personalId)))[0];
		check("CAS zvýšil verzi", stored?.version === 2, stored?.version);
		response = await request(memberCookie, "PATCH", `/api/saved-views/${personalId}`, {
			name: "Stará změna",
			config: config(),
			expectedVersion: 1,
		});
		check("stará verze je odmítnuta", response.status === 409, response.status);

		response = await request(memberCookie, "DELETE", `/api/saved-views/${teamId}?version=1`);
		check("člen nesmaže týmový pohled", response.status === 403, response.status);
		response = await request(managerCookie, "DELETE", `/api/saved-views/${teamId}?version=1`);
		check("vedení smaže týmový pohled", response.status === 200, response.status);
		response = await request(memberCookie, "DELETE", `/api/saved-views/${personalId}?version=2`);
		check("autor smaže osobní pohled", response.status === 200, response.status);

		const audits = await db
			.select({ id: auditEvents.id })
			.from(auditEvents)
			.where(and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.entity, "filters")));
		check("create/update/delete jsou auditované bez replay duplikátu", audits.length === 5, audits.length);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, manager.id));
	}

	if (failed) throw new Error(`${failed} saved-view checks failed`);
	console.log("\nSaved view checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
