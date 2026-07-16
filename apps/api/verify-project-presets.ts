/** Integrační důkaz lehkých projektových přednastavení, atomiky, retry a oprávnění. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
	statuses,
	users,
	workspaces,
} from "@watson/db";
import {
	PROJECT_PRESET_DEFINITIONS,
	PROJECT_PRESETS,
	type ProjectPreset,
} from "@watson/shared";

const API = process.env.PROJECT_PRESETS_API ?? "http://127.0.0.1:8790";
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

const post = (cookie: string, body: Record<string, unknown>) =>
	fetch(`${API}/api/projects`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", Cookie: cookie },
		body: JSON.stringify(body),
	});

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [member, guest] = await db
		.insert(users)
		.values([
			{ id: crypto.randomUUID(), name: "Preset member", email: `preset-member-${suffix}@watson.test`, emailVerified: true },
			{ id: crypto.randomUUID(), name: "Preset guest", email: `preset-guest-${suffix}@watson.test`, emailVerified: true },
		])
		.returning({ id: users.id, email: users.email });
	if (!member || !guest) throw new Error("preset users missing");
	const [workspace, otherWorkspace] = await db
		.insert(workspaces)
		.values([
			{ name: `Presets ${suffix}`, ownerId: member.id, isPersonal: false },
			{ name: `Presets other ${suffix}`, ownerId: member.id, isPersonal: false },
		])
		.returning({ id: workspaces.id });
	if (!workspace || !otherWorkspace) throw new Error("preset workspaces missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
		{ workspaceId: workspace.id, userId: guest.id, role: "guest" },
		{ workspaceId: otherWorkspace.id, userId: member.id, role: "member" },
	]);

	try {
		const memberCookie = await login(member.email);
		const guestCookie = await login(guest.email);
		const createdIds: string[] = [];
		for (const preset of PROJECT_PRESETS) {
			const id = crypto.randomUUID();
			createdIds.push(id);
			const body = { id, workspaceId: workspace.id, name: `${preset} ${suffix}`, preset };
			const responses =
				preset === "team_pipeline"
					? await Promise.all([post(memberCookie, body), post(memberCookie, body)])
					: [await post(memberCookie, body)];
			check(
				`${preset}: create má správný status`,
				preset === "team_pipeline"
					? responses.map((response) => response.status).sort().join(",") === "200,201"
					: responses[0]?.status === 201,
				responses.map((response) => response.status),
			);
			const [project] = await db.select().from(projects).where(eq(projects.id, id));
			const definition = PROJECT_PRESET_DEFINITIONS[preset as ProjectPreset];
			check(
				`${preset}: typ a výchozí pohled odpovídají`,
				project?.kind === definition.kind && project.defaultLayout === definition.layout,
				project,
			);
			const projectStatuses = await db
				.select({ name: statuses.name, position: statuses.position, isDone: statuses.isDone })
				.from(statuses)
				.where(eq(statuses.projectId, id))
				.orderBy(statuses.position);
			check(
				`${preset}: stavy vznikly kompletní a seřazené`,
				projectStatuses.length === definition.statuses.length &&
					projectStatuses.every(
						(status, index) =>
							status.name === definition.statuses[index]?.name &&
							status.position === index &&
							status.isDone === definition.statuses[index]?.isDone,
					),
				projectStatuses,
			);
			const founder = await db
				.select({ role: projectMembers.role })
				.from(projectMembers)
				.where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, member.id)));
			check(`${preset}: zakladatel je manager`, founder[0]?.role === "manager", founder);
			const audits = await db
				.select({ id: auditEvents.id })
				.from(auditEvents)
				.where(and(eq(auditEvents.entity, "projects"), eq(auditEvents.entityId, id)));
			check(`${preset}: create má právě jeden audit`, audits.length === 1, audits.length);
		}

		const conflictId = createdIds[0];
		const conflict = await post(memberCookie, {
			id: conflictId,
			workspaceId: workspace.id,
			name: "Podvržený retry",
			preset: "blank",
		});
		check("stejné ID s jiným payloadem je konflikt", conflict.status === 409, conflict.status);

		const guestId = crypto.randomUUID();
		const denied = await post(guestCookie, {
			id: guestId,
			workspaceId: workspace.id,
			name: "Host nesmí",
			preset: "delivery",
		});
		check("host přednastavený projekt nevytvoří", denied.status === 403, denied.status);
		check(
			"odmítnutý projekt nezanechal řádek",
			(await db.select().from(projects).where(eq(projects.id, guestId))).length === 0,
		);

		const invalid = await post(memberCookie, {
			id: crypto.randomUUID(),
			workspaceId: workspace.id,
			name: "Neplatný preset",
			preset: "enterprise_everything",
		});
		check("neznámé přednastavení je řízeně odmítnuto", invalid.status === 422, invalid.status);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, guest.id));
	}

	if (failed > 0) throw new Error(`${failed} project preset checks failed`);
	console.log("\nProject preset checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
