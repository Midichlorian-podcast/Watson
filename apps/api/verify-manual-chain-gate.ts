import "./src/env";
import { getDb, sql } from "@watson/db";

const API = process.env.CHAIN_API ?? "http://127.0.0.1:8787";
const ORIGIN = "http://localhost:5173";
const db = getDb();
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`✓ ${label}`);
	else {
		failed++;
		console.error(`✗ ${label}: ${JSON.stringify(detail)}`);
	}
}

async function login(email: string) {
	await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN },
		body: JSON.stringify({ email, callbackURL: `${ORIGIN}/` }),
	});
	const token = (
		(await db.execute(sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`)) as {
			identifier: string;
		}[]
	)[0]?.identifier;
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const cookie = (verified.headers.getSetCookie?.() ?? [])
		.map((value) => value.split(";")[0])
		.join("; ");
	if (!cookie) throw new Error("login_failed");
	return cookie;
}

async function activate(cookie: string, id: string) {
	const response = await fetch(`${API}/api/chains/steps/${id}/activate`, {
		method: "POST",
		headers: { Origin: ORIGIN, Cookie: cookie },
	});
	return { response, body: (await response.json()) as Record<string, unknown> };
}

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const owner = { id: crypto.randomUUID(), email: `chain-owner-${suffix}@watson.test` };
	const commenter = { id: crypto.randomUUID(), email: `chain-commenter-${suffix}@watson.test` };
	const workspaceId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const chainId = crypto.randomUUID();
	const taskIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
	const stepIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
	const [task0, task1, task2, task3] = taskIds;
	const [step0, step1, step2, step3] = stepIds;
	if (!task0 || !task1 || !task2 || !task3 || !step0 || !step1 || !step2 || !step3)
		throw new Error("fixture_id_generation_failed");
	await db.execute(sql`
		INSERT INTO users (id, name, email, email_verified) VALUES
		(${owner.id}, 'Chain owner', ${owner.email}, true),
		(${commenter.id}, 'Chain commenter', ${commenter.email}, true)
	`);
	await db.execute(sql`INSERT INTO workspaces (id, name, owner_id) VALUES (${workspaceId}, 'Chain gate test', ${owner.id})`);
	await db.execute(sql`
		INSERT INTO memberships (user_id, workspace_id, role) VALUES
		(${owner.id}, ${workspaceId}, 'admin'), (${commenter.id}, ${workspaceId}, 'member')
	`);
	await db.execute(sql`INSERT INTO projects (id, workspace_id, name, owner_id) VALUES (${projectId}, ${workspaceId}, 'Chain gate project', ${owner.id})`);
	await db.execute(sql`
		INSERT INTO project_members (project_id, user_id, role) VALUES
		(${projectId}, ${owner.id}, 'manager'), (${projectId}, ${commenter.id}, 'commenter')
	`);
	for (const [index, taskId] of taskIds.entries()) {
		await db.execute(sql`INSERT INTO tasks (id, project_id, name, created_by) VALUES (${taskId}, ${projectId}, ${`Step ${index}`}, ${owner.id})`);
	}
	await db.execute(sql`INSERT INTO chains (id, project_id, workspace_id, name, created_by) VALUES (${chainId}, ${projectId}, ${workspaceId}, 'Manual chain', ${owner.id})`);
	await db.execute(sql`
		INSERT INTO chain_steps (id, chain_id, task_id, project_id, position, gate, step_state) VALUES
		(${step0}, ${chainId}, ${task0}, ${projectId}, 0, 'after_previous', 'active'),
		(${step1}, ${chainId}, ${task1}, ${projectId}, 1, 'manual', 'dormant'),
		(${step2}, ${chainId}, ${task2}, ${projectId}, 2, 'with_previous', 'dormant'),
		(${step3}, ${chainId}, ${task3}, ${projectId}, 3, 'after_previous', 'dormant')
	`);
	try {
		let triggerRejected = false;
		try {
			await db.execute(sql`UPDATE chain_steps SET step_state = 'active' WHERE id = ${step1}`);
		} catch (error) {
			const code = (error as { code?: string; cause?: { code?: string } }).code ??
				(error as { cause?: { code?: string } }).cause?.code;
			triggerRejected = code === "23514";
		}
		check("přímý/generický zápis manual dormant→active odmítne DB", triggerRejected);

		const ownerCookie = await login(owner.email);
		const commenterCookie = await login(commenter.email);
		let result = await activate(ownerCookie, step1);
		check("manual command čeká na dokončení předchozího tasku", result.response.status === 409 && result.body.error === "previous_steps_not_closed", result.body);

		await db.execute(sql`UPDATE tasks SET completed_at = now() WHERE id = ${task0}`);
		await db.execute(sql`UPDATE chain_steps SET step_state = 'done' WHERE id = ${step0}`);
		result = await activate(commenterCookie, step1);
		check("commenter manual krok aktivovat nesmí", result.response.status === 403, result.body);

		result = await activate(ownerCookie, step1);
		check("autorizovaný command aktivuje manual gate", result.response.status === 200 && result.body.replay === false, result.body);
		check(
			"command aktivuje i souvislý with_previous běh",
			JSON.stringify(result.body.activatedStepIds) === JSON.stringify([step1, step2]),
			result.body,
		);
		const states = (await db.execute(sql`SELECT id, step_state FROM chain_steps WHERE chain_id = ${chainId} ORDER BY position`)) as { id: string; step_state: string }[];
		check("následující after_previous zůstává dormant", states[3]?.step_state === "dormant", states);
		result = await activate(ownerCookie, step1);
		check("opakovaný command je idempotentní replay", result.response.status === 200 && result.body.replay === true, result.body);
		const audits = Number(
			((await db.execute(sql`SELECT count(*)::int AS n FROM audit_events WHERE entity_id = ${step1} AND action = 'manual_activate'`)) as { n: number }[])[0]?.n,
		);
		check("aktivace je auditovaná právě jednou", audits === 1, audits);
	} finally {
		await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
		await db.execute(sql`DELETE FROM users WHERE id IN (${owner.id}, ${commenter.id})`);
	}
	if (failed) {
		console.error(`Manual chain gate verification: ${failed} failed`);
		process.exit(1);
	}
	console.log("Manual chain gate verification passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
