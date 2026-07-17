/**
 * CC-P0-14: autoritativní export + skutečný restore contract.
 * Ověřuje manifest, ACL redakci meeting obsahu, dry-run rollback, apply,
 * idempotentní replay a řízené odmítnutí poškozených/novějších/konfliktních dat.
 */
import "./src/env";
import { createHash } from "node:crypto";
import { getDb, sql } from "@watson/db";
import { checksumTables, manifestSignature } from "./src/export";

const API = process.env.EXPORT_API ?? "http://127.0.0.1:8787";
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
	const response = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!response.ok) throw new Error(`magic-link: ${response.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const cookie = (verified.headers.getSetCookie?.() ?? [])
		.map((value) => value.split(";")[0])
		.join("; ");
	if (!cookie) throw new Error("chybí session cookie");
	return cookie;
}

type Backup = {
	manifest: {
		format: string;
		version: number;
		exportedAt: string;
		schemaMigrations: number | null;
		scope: { workspaces: number; userId: string };
		counts: Record<string, number>;
		checksum: string;
		signature: string;
		limitations: Record<string, string>;
	};
	tables: Record<string, Record<string, unknown>[]>;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function resign(backup: Backup) {
	backup.manifest.checksum = checksumTables(backup.tables);
	backup.manifest.signature = manifestSignature({
		version: backup.manifest.version,
		schemaMigrations: backup.manifest.schemaMigrations,
		userId: backup.manifest.scope.userId,
		checksum: backup.manifest.checksum,
	});
}

async function restore(
	cookie: string,
	backup: Backup,
	mode: "dry-run" | "apply",
	conflictMode: "skip" | "fail" = "skip",
) {
	const response = await fetch(`${API}/api/restore`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:5173",
			Cookie: cookie,
		},
		body: JSON.stringify({ mode, conflictMode, backup }),
	});
	return { response, body: (await response.json()) as Record<string, unknown> };
}

async function main() {
	const cookie = await login("demo@watson.test");
	const user = (
		(await db.execute(sql`SELECT id FROM users WHERE email = 'demo@watson.test'`)) as {
			id: string;
		}[]
	)[0];
	if (!user) throw new Error("demo user missing");
	const workspace = (
		(await db.execute(sql`
			SELECT m.workspace_id FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.user_id = ${user.id} AND (m.role IN ('manager', 'admin') OR w.owner_id = ${user.id})
			ORDER BY m.created_at LIMIT 1
		`)) as { workspace_id: string }[]
	)[0];
	if (!workspace) throw new Error("demo workspace missing");
	const project = (
		(await db.execute(sql`
			SELECT id FROM projects WHERE workspace_id = ${workspace.workspace_id} ORDER BY created_at LIMIT 1
		`)) as { id: string }[]
	)[0];
	if (!project) throw new Error("demo project missing");

	const contactId = crypto.randomUUID();
	const recurrenceTaskId = crypto.randomUUID();
	const recurrencePrefixId = crypto.randomUUID();
	await db.execute(sql`
		INSERT INTO contacts (id, workspace_id, name, email, created_by)
		VALUES (${contactId}, ${workspace.workspace_id}, 'Restore drill contact', 'restore-drill@example.test', ${user.id})
	`);
	await db.execute(sql`
		INSERT INTO tasks (
			id, project_id, name, due_date, recurrence, recurrence_rule, mail_th, mail_label, created_by
		) VALUES (
			${recurrenceTaskId}, ${project.id}, 'Restore drill recurrence', DATE '2026-07-10',
			'Denně', '{"kind":"daily","showAll":true}',
			${`personal:${crypto.randomUUID()}:${crypto.randomUUID()}`}, 'Citlivý mailový locator', ${user.id}
		)
	`);
	await db.execute(sql`
		INSERT INTO task_recurrence_prefixes (
			id, task_id, project_id, anchor_date, end_date, recurrence_rule, created_by
		) VALUES (
			${recurrencePrefixId}, ${recurrenceTaskId}, ${project.id}, DATE '2026-07-01', DATE '2026-07-09',
			'{"kind":"daily","showAll":true}', ${user.id}
		)
	`);
	try {
		const response = await fetch(`${API}/api/export`, {
			headers: { Cookie: cookie, Origin: "http://localhost:5173" },
		});
		check("export endpoint 200", response.status === 200, response.status);
		const backup = (await response.json()) as Backup;

		const recomputed = createHash("sha256").update(JSON.stringify(backup.tables)).digest("hex");
		check("checksum sedí na přesný obsah", recomputed === backup.manifest.checksum);
		check(
			"manifest je version 3 a HMAC podepsaný",
			backup.manifest.version === 3 && /^[a-f0-9]{64}$/.test(backup.manifest.signature),
		);
		check(
			"manifest transparentně uvádí privacy/storage výluky",
			Object.keys(backup.manifest.limitations ?? {}).length === 4,
		);

		const directTasks = Number(
			(
				(await db.execute(sql`
					SELECT count(*)::int AS n FROM tasks t JOIN projects p ON p.id = t.project_id
					WHERE p.workspace_id IN (
						SELECT m.workspace_id FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
						WHERE m.user_id = ${user.id} AND (m.role IN ('manager', 'admin') OR w.owner_id = ${user.id})
					)
				`)) as { n: number }[]
			)[0]?.n,
		);
		check("tasks count sedí s ACL scope", backup.manifest.counts.tasks === directTasks);
		check(
			"konečný segment opakované řady je v exportu",
			backup.tables.task_recurrence_prefixes?.some(
				(row) => row.id === recurrencePrefixId && row.task_id === recurrenceTaskId,
			) === true,
		);
		const exportedRecurrenceTask = backup.tables.tasks?.find((row) => row.id === recurrenceTaskId);
		check(
			"osobní mailový locator je redigovaný a úkol zůstává přenositelný",
			exportedRecurrenceTask?.name === "Restore drill recurrence" &&
				exportedRecurrenceTask.mail_th === null &&
				exportedRecurrenceTask.mail_label === null &&
				backup.manifest.limitations.personalMail?.includes("source links") === true,
			exportedRecurrenceTask,
		);

		let meetingPrivacyOk = true;
		for (const meeting of backup.tables.meetings ?? []) {
			if (meeting.transcript == null && meeting.extraction == null) continue;
			const access = (
				(await db.execute(sql`
					SELECT (m.created_by = ${user.id} OR EXISTS (
						SELECT 1 FROM assignments a WHERE a.task_id = m.hub_task_id AND a.user_id = ${user.id}
					)) AS ok FROM meetings m WHERE m.id = ${meeting.id as string}::uuid
				`)) as { ok: boolean }[]
			)[0]?.ok;
			if (!access) meetingPrivacyOk = false;
		}
		check("meeting obsah je nenulový jen pro tvůrce/účastníka", meetingPrivacyOk);

		await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`);
		await db.execute(sql`DELETE FROM task_recurrence_prefixes WHERE id = ${recurrencePrefixId}`);
		let result = await restore(cookie, backup, "dry-run");
		check("dry-run projde", result.response.status === 200, result.body);
		check(
			"dry-run plánuje obnovit smazaný kontakt",
			result.body.report?.inserted?.contacts === 1,
			result.body,
		);
		check(
			"dry-run plánuje obnovit historii opakované řady",
			result.body.report?.inserted?.task_recurrence_prefixes === 1,
			result.body,
		);
		const afterDryRun = Number(
			(
				(await db.execute(
					sql`SELECT count(*)::int AS n FROM contacts WHERE id = ${contactId}`,
				)) as { n: number }[]
			)[0]?.n,
		);
		check("dry-run skutečně rollbackne všechny zápisy", afterDryRun === 0);

		result = await restore(cookie, backup, "apply");
		check("apply restore projde", result.response.status === 200, result.body);
		check("apply vloží smazaný kontakt", result.body.report?.inserted?.contacts === 1, result.body);
		check(
			"apply obnoví historii opakované řady",
			result.body.report?.inserted?.task_recurrence_prefixes === 1,
			result.body,
		);
		const afterApply = Number(
			(
				(await db.execute(
					sql`SELECT count(*)::int AS n FROM contacts WHERE id = ${contactId}`,
				)) as { n: number }[]
			)[0]?.n,
		);
		check("kontakt po restore existuje", afterApply === 1);
		const prefixAfterApply = Number(
			(
				(await db.execute(sql`
					SELECT count(*)::int AS n FROM task_recurrence_prefixes WHERE id = ${recurrencePrefixId}
				`)) as { n: number }[]
			)[0]?.n,
		);
		check("segment řady po restore existuje", prefixAfterApply === 1);

		result = await restore(cookie, backup, "apply");
		check(
			"opakovaný apply je bezpečný/idempotentní",
			result.response.status === 200 && result.body.report?.inserted?.contacts === 0,
			result.body,
		);
		check(
			"opakovaný apply neduplikuje segment řady",
			result.response.status === 200 &&
				result.body.report?.inserted?.task_recurrence_prefixes === 0,
			result.body,
		);

		result = await restore(cookie, backup, "dry-run", "fail");
		check("conflictMode=fail odmítne existující ID", result.response.status === 409, result.body);

		const corrupted = clone(backup);
		const firstContact = corrupted.tables.contacts[0];
		if (!firstContact) throw new Error("fixture_missing_contact");
		firstContact.name = "tampered without checksum";
		result = await restore(cookie, corrupted, "dry-run");
		check(
			"poškozený checksum je odmítnut",
			result.response.status === 400 && result.body.code === "checksum_mismatch",
			result.body,
		);

		const badSignature = clone(backup);
		badSignature.manifest.signature = "0".repeat(64);
		result = await restore(cookie, badSignature, "dry-run");
		check(
			"neplatný HMAC podpis je odmítnut",
			result.response.status === 400 && result.body.code === "signature_mismatch",
			result.body,
		);

		const missingTable = clone(backup);
		delete missingTable.tables.labels;
		result = await restore(cookie, missingTable, "dry-run");
		check(
			"chybějící tabulka je řízeně odmítnuta",
			result.response.status === 400 && result.body.code === "table_inventory_mismatch",
			result.body,
		);

		const duplicate = clone(backup);
		const duplicateContact = duplicate.tables.contacts[0];
		if (!duplicateContact) throw new Error("fixture_missing_contact");
		duplicate.tables.contacts.push(clone(duplicateContact));
		duplicate.manifest.counts.contacts += 1;
		resign(duplicate);
		result = await restore(cookie, duplicate, "dry-run");
		check(
			"duplicate ID v souboru je odmítnuto před SQL",
			result.response.status === 400 && result.body.code === "duplicate_id:contacts",
			result.body,
		);

		const legacyV2 = clone(backup);
		legacyV2.manifest.version = 2;
		delete legacyV2.tables.decisions;
		delete legacyV2.tables.decision_task_links;
		delete legacyV2.manifest.counts.decisions;
		delete legacyV2.manifest.counts.decision_task_links;
		resign(legacyV2);
		result = await restore(cookie, legacyV2, "dry-run");
		check(
			"version 2 bez Decision Logu se bezpečně normalizuje",
			result.response.status === 200,
			result.body,
		);

		const future = clone(backup);
		future.manifest.schemaMigrations = (future.manifest.schemaMigrations ?? 0) + 1000;
		resign(future);
		result = await restore(cookie, future, "dry-run");
		check(
			"novější schema je odmítnuto",
			result.response.status === 400 && result.body.code === "backup_schema_newer_than_server",
			result.body,
		);
	} finally {
		await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`);
		await db.execute(sql`DELETE FROM tasks WHERE id = ${recurrenceTaskId}`);
	}

	if (failed) {
		console.error(`\nExport/restore verify: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nExport/restore verify: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
