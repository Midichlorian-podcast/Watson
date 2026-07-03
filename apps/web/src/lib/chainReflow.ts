/**
 * Reflow termínů postupu — port `_reflow`/`shiftFlow`/`setFlowSched`/`toggleFlowWeekend`
 * z prototypu (ř. 2485–2490) nad reálnými `tasks.due_date`:
 * - Kotva (anchor): due = anchor_date + anchor_offset (pevné termíny, zpoždění se nepřelévá).
 * - Řetězec (chain): due = předchozí krok + gap_days (zpoždění se přelévá dál);
 *   skip_weekend posouvá na nejbližší pracovní den.
 */
import { powerSync } from "./powersync/db";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) =>
	`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
export const isoPlusDays = (iso: string, n: number) => {
	const d = fromISO(iso);
	d.setDate(d.getDate() + n);
	return isoOf(d);
};
const isWeekend = (iso: string) => {
	const w = fromISO(iso).getDay();
	return w === 0 || w === 6;
};
const nextWork = (iso: string) => {
	let x = iso;
	let guard = 0;
	while (isWeekend(x) && guard < 6) {
		x = isoPlusDays(x, 1);
		guard++;
	}
	return x;
};

interface StepWithDue {
	id: string;
	task_id: string | null;
	position: number | null;
	step_state: string | null;
	anchor_offset: number | null;
	gap_days: number | null;
	due: string | null;
}

async function loadChain(chainId: string) {
	const rows = await powerSync.getAll<{
		sched_mode: string | null;
		skip_weekend: number | null;
		anchor_date: string | null;
	}>(
		"SELECT sched_mode, skip_weekend, anchor_date FROM chains WHERE id = ? LIMIT 1",
		[chainId],
	);
	return rows[0];
}

async function loadSteps(chainId: string): Promise<StepWithDue[]> {
	return await powerSync.getAll<StepWithDue>(
		`SELECT cs.id, cs.task_id, cs.position, cs.step_state, cs.anchor_offset, cs.gap_days,
            t.due_date AS due
     FROM chain_steps cs LEFT JOIN tasks t ON t.id = cs.task_id
     WHERE cs.chain_id = ? ORDER BY cs.position`,
		[chainId],
	);
}

/** Přepočet termínů od kroku `fromPos` dál (0 = celý řetězec). */
export async function reflowChain(chainId: string, fromPos = 0): Promise<void> {
	const chain = await loadChain(chainId);
	if (!chain) return;
	const steps = await loadSteps(chainId);
	if (!steps.length) return;
	const anchor = (
		chain.anchor_date ??
		steps[0]?.due ??
		isoOf(new Date())
	).slice(0, 10);
	const mode = chain.sched_mode === "anchor" ? "anchor" : "chain";
	const skip = !!chain.skip_weekend;
	const dayDiff = (a: string, b: string) =>
		Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000);
	// Starší kroky bez offsetů: odvodit z aktuálních termínů (prototyp _normFlows, ř. 2484).
	let prevDue: string | null = null;
	const norm = steps.map((st) => {
		const due = st.due?.slice(0, 10) ?? null;
		const anchorOffset = st.anchor_offset ?? (due ? dayDiff(due, anchor) : 0);
		const gapDays =
			st.gap_days ?? (due && prevDue ? Math.max(0, dayDiff(due, prevDue)) : 1);
		if (due) prevDue = due;
		return { ...st, anchorOffset, gapDays };
	});
	let prev: string | null = null;
	for (const st of norm) {
		const pos = st.position ?? 0;
		let d: string;
		if (mode === "anchor") {
			d = isoPlusDays(anchor, st.anchorOffset);
		} else if (pos <= fromPos || prev == null) {
			d = (st.due ?? isoPlusDays(anchor, st.anchorOffset)).slice(0, 10);
		} else {
			d = isoPlusDays(prev, st.gapDays);
		}
		// Víkendy se přeskakují jen v režimu Řetězec (prototyp _reflow — kotvené termíny jsou pevné).
		if (skip && mode === "chain" && pos > fromPos) d = nextWork(d);
		prev = d;
		if (st.task_id && d !== (st.due ?? "").slice(0, 10)) {
			await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
				d,
				st.task_id,
			]);
		}
	}
}

/** Posun celého řetězce o ±N dní (prototyp shiftFlow) — termíny všech kroků + kotva. */
export async function shiftChain(
	chainId: string,
	delta: number,
): Promise<void> {
	const chain = await loadChain(chainId);
	const steps = await loadSteps(chainId);
	for (const st of steps) {
		if (st.task_id && st.due) {
			await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
				isoPlusDays(st.due.slice(0, 10), delta),
				st.task_id,
			]);
		}
	}
	if (chain?.anchor_date) {
		await powerSync.execute("UPDATE chains SET anchor_date = ? WHERE id = ?", [
			isoPlusDays(chain.anchor_date.slice(0, 10), delta),
			chainId,
		]);
	}
}

/** Přepnutí režimu plánování Řetězec/Kotva (prototyp setFlowSched) + přepočet. */
export async function setChainSchedMode(
	chainId: string,
	mode: "chain" | "anchor",
): Promise<void> {
	await powerSync.execute("UPDATE chains SET sched_mode = ? WHERE id = ?", [
		mode,
		chainId,
	]);
	await reflowChain(chainId, 0);
}

/** Přepnutí „Bez víkendů" (prototyp toggleFlowWeekend) + přepočet. */
export async function toggleChainWeekend(chainId: string): Promise<void> {
	const chain = await loadChain(chainId);
	await powerSync.execute("UPDATE chains SET skip_weekend = ? WHERE id = ?", [
		chain?.skip_weekend ? 0 : 1,
		chainId,
	]);
	await reflowChain(chainId, 0);
}
