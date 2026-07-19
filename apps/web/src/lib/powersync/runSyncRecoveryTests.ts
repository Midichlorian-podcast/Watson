import type { RejectedOpRow } from "./AppSchema";
import { WatsonConnector } from "./connector";
import { retryRejectedOperation } from "./syncRecovery";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

const envelope = {
	op: "PATCH",
	table: "tasks",
	id: "d7ecdc8f-784d-4b19-875c-3e7cb4fc6911",
	data: { name: "Zachráněný text" },
	previous: { name: "Původní text" },
	clientId: "device-a",
	operationId: "42",
};

const row = {
	id: "device-a:42",
	payload: JSON.stringify(envelope),
} as RejectedOpRow;

function mockDb() {
	const calls: { sql: string; params?: unknown[] }[] = [];
	return {
		calls,
		db: {
			execute: async (sql: string, params?: unknown[]) => {
				calls.push({ sql, params });
				return { rowsAffected: 1 };
			},
		},
	};
}

console.log("(a) úspěšné obnovení");
{
	const { db, calls } = mockDb();
	let sent: unknown;
	const result = await retryRejectedOperation(db as never, row, async (_url, init) => {
		sent = JSON.parse(String(init?.body));
		return new Response(JSON.stringify({ ok: true, requestId: "req-1" }), { status: 200 });
	});
	check(
		"server dostal původní envelope včetně idempotency klíče",
		JSON.stringify(sent) === JSON.stringify(envelope),
		sent,
	);
	check("výsledek je úspěch", result.ok && result.httpCode === 200, result);
	check(
		"stav prošel retrying → resolved",
		calls.length === 2 &&
			Boolean(calls[0]?.sql.includes("retrying")) &&
			Boolean(calls[1]?.sql.includes("resolved")),
		calls,
	);
}

console.log("(b) opakované trvalé odmítnutí");
{
	const { db, calls } = mockDb();
	const result = await retryRejectedOperation(
		db as never,
		row,
		async () =>
			new Response(
				JSON.stringify({ error: "write_conflict", code: "create_conflict", requestId: "req-2" }),
				{
					status: 409,
				},
			),
	);
	check(
		"409 zůstane otevřená k ruční opravě",
		!result.ok && result.code === "create_conflict",
		result,
	);
	check("poslední stav je open", calls.at(-1)?.sql.includes("status = 'open'") === true, calls);
}

console.log("(c) výpadek sítě");
{
	const { db, calls } = mockDb();
	const result = await retryRejectedOperation(db as never, row, async () => {
		throw new Error("offline");
	});
	check("síťová chyba je rozlišitelná", !result.ok && result.code === "network_error", result);
	check("záznam se neztratí", calls.at(-1)?.sql.includes("status = 'open'") === true, calls);
}

console.log("(d) starý/nečitelný payload");
{
	const { db, calls } = mockDb();
	const result = await retryRejectedOperation(db as never, { ...row, payload: "{}" }, async () => {
		throw new Error("fetch se nesmí volat");
	});
	check(
		"legacy payload se bezpečně odmítne",
		!result.ok && result.code === "legacy_payload",
		result,
	);
	check("bez DB mutace", calls.length === 0, calls);
}

console.log("(e) selhání dead-letter persistence nesmí potvrdit upload frontu");
{
	const originalFetch = globalThis.fetch;
	let completed = false;
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ error: "forbidden", requestId: "req-3" }), { status: 403 });
	const database = {
		getClientId: async () => "device-b",
		getNextCrudTransaction: async () => ({
			crud: [
				{
					op: "PATCH",
					table: "tasks",
					id: envelope.id,
					opData: envelope.data,
					clientId: 7,
				},
			],
			complete: async () => {
				completed = true;
			},
		}),
		execute: async () => {
			throw new Error("sqlite full");
		},
	};
	let threw = false;
	try {
		await new WatsonConnector().uploadData(database as never);
	} catch {
		threw = true;
	} finally {
		globalThis.fetch = originalFetch;
	}
	check("connector chybu propaguje pro další retry", threw);
	check("tx.complete nebylo zavoláno", !completed);
}

if (failed) {
	console.error(`\nSync recovery testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nSync recovery testy: vše prošlo");
