/** F6 — integrační kontrakt vysvětlitelného Radaru proti API a PostgreSQL. */
import "./src/env";
import {
	assignments,
	availabilityBlocks,
	decisionTaskLinks,
	decisions,
	eq,
	getDb,
	meetings,
	memberships,
	projectMembers,
	projects,
	sql,
	taskDependencies,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { buildRadarSnapshot, type RadarItem } from "./src/radar";

const API = process.env.RADAR_API ?? "http://127.0.0.1:8790";
const WEB_ORIGIN = process.env.RADAR_ORIGIN ?? "http://localhost:5173";
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
	const raw =
		verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error(`login ${email}: missing cookie`);
	return cookie;
}

async function request(cookie: string, path: string) {
	return fetch(`${API}${path}`, {
		headers: { Origin: WEB_ORIGIN, Cookie: cookie },
	});
}

function day(now: Date, offset: number) {
	const value = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
	return value;
}

function item(snapshot: { items: RadarItem[] }, type: RadarItem["entityType"], id: string) {
	return snapshot.items.find((candidate) => candidate.entityType === type && candidate.entityId === id);
}

async function main() {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const makeUser = async (slug: string) => {
		const [row] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `Radar ${slug}`,
				email: `radar-${slug}-${stamp}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		if (!row) throw new Error(`user ${slug} missing`);
		return row;
	};
	const leader = await makeUser("leader");
	const member = await makeUser("member");
	const assignee = await makeUser("assignee");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Radar ${stamp}`, ownerId: leader.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values([
		{ workspaceId: workspace.id, userId: leader.id, role: "manager" },
		{ workspaceId: workspace.id, userId: member.id, role: "member" },
		{ workspaceId: workspace.id, userId: assignee.id, role: "member" },
	]);
	const [project, hiddenProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: leader.id, name: "Radar delivery" },
			{ workspaceId: workspace.id, ownerId: member.id, name: "Restricted secret" },
		])
		.returning({ id: projects.id });
	if (!project || !hiddenProject) throw new Error("projects missing");
	await db.insert(projectMembers).values([
		{ projectId: project.id, userId: leader.id, role: "manager" },
		{ projectId: project.id, userId: member.id, role: "commenter" },
		{ projectId: project.id, userId: assignee.id, role: "editor" },
		{ projectId: hiddenProject.id, userId: member.id, role: "manager" },
	]);

	const now = new Date();
	const firstStart = new Date(now.getTime() + 2 * 60 * 60_000);
	const secondStart = new Date(now.getTime() + 2.5 * 60 * 60_000);
	const insertedTasks = await db
		.insert(tasks)
		.values([
			{
				projectId: project.id,
				name: "Kritické předání",
				deadline: day(now, -1),
				startDate: firstStart,
				startTimezone: "UTC",
				durationMin: 120,
				priority: 1,
				createdBy: leader.id,
			},
			{
				projectId: project.id,
				name: "Blokované zveřejnění",
				deadline: day(now, 0),
				priority: 1,
				createdBy: leader.id,
			},
			{
				projectId: project.id,
				name: "Podklady od dodavatele",
				deadline: day(now, 1),
				createdBy: leader.id,
			},
			{
				projectId: project.id,
				name: "Kolizní příprava",
				startDate: secondStart,
				startTimezone: "UTC",
				durationMin: 90,
				dueDate: day(now, 0),
				createdBy: leader.id,
			},
			{
				projectId: hiddenProject.id,
				name: "TAJNÉ AKVIZIČNÍ RIZIKO",
				deadline: day(now, -10),
				createdBy: member.id,
			},
		])
		.returning({ id: tasks.id, name: tasks.name });
	const byName = new Map(insertedTasks.map((task) => [task.name, task.id]));
	const criticalId = byName.get("Kritické předání");
	const blockedId = byName.get("Blokované zveřejnění");
	const blockerId = byName.get("Podklady od dodavatele");
	const collisionId = byName.get("Kolizní příprava");
	if (!criticalId || !blockedId || !blockerId || !collisionId) throw new Error("tasks missing");
	await db.insert(assignments).values([
		{ taskId: criticalId, projectId: project.id, userId: assignee.id },
		{ taskId: blockedId, projectId: project.id, userId: assignee.id },
		{ taskId: blockerId, projectId: project.id, userId: assignee.id },
		{ taskId: collisionId, projectId: project.id, userId: assignee.id },
	]);
	await db.insert(taskDependencies).values({
		projectId: project.id,
		blockingTaskId: blockerId,
		blockedTaskId: blockedId,
		createdBy: leader.id,
	});
	await db.insert(availabilityBlocks).values([
		{
			workspaceId: workspace.id,
			userId: assignee.id,
			kind: "absence",
			startsAt: new Date(now.getTime() + 90 * 60_000),
			endsAt: new Date(now.getTime() + 4 * 60 * 60_000),
			timezone: "UTC",
			visibility: "private",
			label: "TAJNÁ DIAGNÓZA",
			createdBy: assignee.id,
		},
		{
			workspaceId: workspace.id,
			userId: assignee.id,
			kind: "focus",
			startsAt: new Date(now.getTime() + 100 * 60_000),
			endsAt: new Date(now.getTime() + 3 * 60 * 60_000),
			timezone: "UTC",
			createdBy: assignee.id,
		},
	]);
	const meetingId = crypto.randomUUID();
	await db.insert(meetings).values({
		id: meetingId,
		workspaceId: workspace.id,
		title: "Radar meeting source",
		transcript: "Vložený přepis pro test zdroje rozhodnutí.",
		status: "committed",
		createdBy: leader.id,
	});
	const [decision] = await db
		.insert(decisions)
		.values({
			workspaceId: workspace.id,
			projectId: project.id,
			sourceType: "meeting",
			sourceObjectId: meetingId,
			sourceKey: "0",
			title: "Ověřit variantu před zveřejněním",
			reviewAt: new Date(now.getTime() - 60 * 60_000),
			createdBy: leader.id,
		})
		.returning({ id: decisions.id });
	if (!decision) throw new Error("decision missing");
	await db.insert(decisionTaskLinks).values({
		decisionId: decision.id,
		taskId: blockedId,
		projectId: project.id,
	});

	try {
		const snapshot = await buildRadarSnapshot({
			userId: leader.id,
			workspaceId: workspace.id,
			timezone: "UTC",
			limit: 100,
			now,
		});
		const critical = item(snapshot, "task", criticalId);
		check(
			"deadline, absence a Focus Time se skládají do jednoho vysvětlitelného rizika",
			critical?.severity === "critical" &&
				critical.evidence.some((fact) => fact.code === "deadline_overdue") &&
				critical.evidence.some((fact) => fact.code === "assignee_unavailable") &&
				critical.evidence.some((fact) => fact.code === "focus_conflict"),
			critical,
		);
		check(
			"soukromý popisek nedostupnosti se do Radaru nepropíše",
			!JSON.stringify(snapshot).includes("TAJNÁ DIAGNÓZA"),
		);
		const blocked = item(snapshot, "task", blockedId);
		check(
			"blokace a nemožné pořadí termínů jsou explicitní zdroje",
			blocked?.evidence.some((fact) => fact.code === "incomplete_blocker") === true &&
				blocked.evidence.some((fact) => fact.code === "sequence_impossible") &&
				blocked.evidence.some((fact) => fact.code === "decision_review_overdue"),
			blocked,
		);
		const collision = item(snapshot, "task", collisionId);
		check(
			"skutečný časový překryv je signál bez kapacitního skóre člověka",
			collision?.evidence.some((fact) => fact.code === "schedule_collision") === true &&
				!JSON.stringify(snapshot).includes("employeeScore"),
			collision,
		);
		const decisionRisk = item(snapshot, "decision", decision.id);
		check(
			"prošlá revize meeting decision je samostatně dohledatelná",
			decisionRisk?.evidence[0]?.code === "decision_review_overdue" &&
				decisionRisk.projectId === project.id,
			decisionRisk,
		);
		check(
			"skóre je přesný součet zveřejněných vah, nejvýše 100",
			snapshot.items.every(
				(risk) =>
					risk.score ===
					Math.min(100, risk.evidence.reduce((sum, evidence) => sum + evidence.weight, 0)),
			),
		);
		check(
			"restricted projekt se workspace managerovi bez project membership neprozradí",
			!JSON.stringify(snapshot).includes("TAJNÉ AKVIZIČNÍ RIZIKO") &&
				snapshot.scope.projectCount === 1,
			snapshot.scope,
		);
		check(
			"řazení je deterministicky score-first",
			snapshot.items.every((risk, index) => {
				const previous = snapshot.items[index - 1];
				return !previous || previous.score >= risk.score;
			}),
			snapshot.items.map((risk) => risk.score),
		);
		const criticalOnly = await buildRadarSnapshot({
			userId: leader.id,
			workspaceId: workspace.id,
			timezone: "UTC",
			severity: "critical",
			limit: 100,
			now,
		});
		check(
			"serverový severity filtr nevrací jiné stupně",
			criticalOnly.items.length > 0 &&
				criticalOnly.items.every((risk) => risk.severity === "critical"),
			criticalOnly.items,
		);

		const leaderCookie = await login(leader.email);
		const memberCookie = await login(member.email);
		let response = await request(
			leaderCookie,
			`/api/radar?workspaceId=${workspace.id}&timezone=UTC&limit=100`,
		);
		const apiSnapshot = (await response.json().catch(() => ({}))) as { items?: RadarItem[] };
		check(
			"leadership endpoint vrací aktuální Radar a zakazuje cache",
			response.status === 200 &&
				response.headers.get("cache-control")?.includes("no-store") === true &&
				(apiSnapshot.items?.length ?? 0) > 0,
			{ status: response.status, headers: response.headers.get("cache-control") },
		);
		response = await request(memberCookie, `/api/radar?workspaceId=${workspace.id}&timezone=UTC`);
		check("řadový člen neotevře leadership Radar", response.status === 404, response.status);
		response = await request(
			leaderCookie,
			`/api/radar?workspaceId=${crypto.randomUUID()}&timezone=UTC`,
		);
		check("cizí workspace se neprozradí", response.status === 404, response.status);
		response = await request(
			leaderCookie,
			`/api/radar?workspaceId=${workspace.id}&timezone=Not%2FAZone`,
		);
		check("neplatná časová zóna je řízeně odmítnuta", response.status === 422, response.status);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, assignee.id));
		await db.delete(users).where(eq(users.id, member.id));
		await db.delete(users).where(eq(users.id, leader.id));
	}

	if (failed) throw new Error(`${failed} Radar checks failed`);
	console.log("\nExplainable Radar checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
