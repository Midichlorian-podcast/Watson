/** Integrační matice centrální workspace policy přes skutečný sync endpoint. */
import "./src/env";
import {
	eq,
	getDb,
	goals,
	listSections,
	lists,
	meetings,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.RBAC_API ?? "http://127.0.0.1:8790";
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

async function write(
	cookie: string,
	operationId: string,
	table: string,
	id: string,
	data: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${API}/api/sync/write`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:5173",
			Cookie: cookie,
		},
		body: JSON.stringify({
			op: "PUT",
			table,
			id,
			data,
			clientId: `workspace-policy-${table}`,
			operationId,
		}),
	});
}

async function main(): Promise<void> {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const createUser = async (role: string) => {
		const [user] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `Policy ${role}`,
				email: `policy-${role}-${stamp}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		if (!user) throw new Error("user insert failed");
		return user;
	};
	const manager = await createUser("manager");
	const member = await createUser("member");
	const guest = await createUser("guest");
	const [ws1] = await db
		.insert(workspaces)
		.values({ name: `Policy A ${stamp}`, ownerId: manager.id, isPersonal: false })
		.returning({ id: workspaces.id });
	const [ws2] = await db
		.insert(workspaces)
		.values({ name: `Policy B ${stamp}`, ownerId: manager.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!ws1 || !ws2) throw new Error("workspace insert failed");
	await db.insert(memberships).values([
		{ workspaceId: ws1.id, userId: manager.id, role: "manager" },
		{ workspaceId: ws1.id, userId: member.id, role: "member" },
		{ workspaceId: ws1.id, userId: guest.id, role: "guest" },
		{ workspaceId: ws2.id, userId: manager.id, role: "manager" },
		{ workspaceId: ws2.id, userId: member.id, role: "member" },
	]);

	try {
		const managerCookie = await login(manager.email);
		const memberCookie = await login(member.email);
		const guestCookie = await login(guest.email);
		const goalByMember = crypto.randomUUID();
		let response = await write(memberCookie, "member-goal", "goals", goalByMember, {
			workspace_id: ws1.id,
			name: "Member nesmí",
			scope: "team",
			metric: "count",
			target: 1,
			periodic: "none",
		});
		check("member nesmí vytvořit strategický cíl", response.status === 403, response.status);
		check(
			"odmítnutý cíl nezanechá DB řádek",
			(await db.select().from(goals).where(eq(goals.id, goalByMember))).length === 0,
		);

		const goalByManager = crypto.randomUUID();
		response = await write(managerCookie, "manager-goal", "goals", goalByManager, {
			workspace_id: ws1.id,
			name: "Manager může",
			scope: "team",
			metric: "count",
			target: 1,
			periodic: "none",
		});
		check("manager může vytvořit strategický cíl", response.status === 200, response.status);

		const listA = crypto.randomUUID();
		response = await write(memberCookie, "member-list-a", "lists", listA, {
			workspace_id: ws1.id,
			name: "Týmový checklist",
			archived: false,
		});
		check("member může vytvořit běžný týmový seznam", response.status === 200, response.status);
		const guestList = crypto.randomUUID();
		response = await write(guestCookie, "guest-list", "lists", guestList, {
			workspace_id: ws1.id,
			name: "Host nesmí",
			archived: false,
		});
		check("guest je read-only i pro seznam", response.status === 403, response.status);
		check(
			"guest list nevznikl",
			(await db.select().from(lists).where(eq(lists.id, guestList))).length === 0,
		);

		const listB = crypto.randomUUID();
		response = await write(memberCookie, "member-list-b", "lists", listB, {
			workspace_id: ws2.id,
			name: "Jiný workspace",
			archived: false,
		});
		check("setup seznamu ve druhém workspace uspěl", response.status === 200, response.status);
		const crossSection = crypto.randomUUID();
		response = await write(memberCookie, "cross-section", "list_sections", crossSection, {
			workspace_id: ws1.id,
			list_id: listB,
			name: "Cross tenant",
			position: 0,
		});
		check("cross-workspace list reference je odmítnuta", response.status === 403, response.status);
		check(
			"cross-workspace section nevznikla",
			(await db.select().from(listSections).where(eq(listSections.id, crossSection))).length === 0,
		);

		const directMeeting = crypto.randomUUID();
		response = await write(memberCookie, "direct-meeting", "meetings", directMeeting, {
			workspace_id: ws1.id,
			title: "Obejití commandu",
			status: "scheduled",
		});
		check("meeting metadata nelze vytvořit mimo server command", response.status === 400, response.status);
		check(
			"přímý meeting nevznikl",
			(await db.select().from(meetings).where(eq(meetings.id, directMeeting))).length === 0,
		);

		response = await fetch(`${API}/api/workspaces`, {
			headers: { Origin: "http://localhost:5173", Cookie: memberCookie },
		});
		const body = (await response.json()) as {
			workspaces?: { id: string; capabilities?: Record<string, boolean> }[];
		};
		const capability = body.workspaces?.find((workspace) => workspace.id === ws1.id)?.capabilities;
		check(
			"UI capability odpovídá policy (goals ne, lists ano)",
			capability?.manageGoals === false && capability.createLists === true,
			capability,
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, ws1.id));
		await db.delete(workspaces).where(eq(workspaces.id, ws2.id));
		for (const user of [manager, member, guest]) await db.delete(users).where(eq(users.id, user.id));
	}

	if (failed > 0) {
		console.error(`\nWorkspace policy: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nWorkspace policy: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
