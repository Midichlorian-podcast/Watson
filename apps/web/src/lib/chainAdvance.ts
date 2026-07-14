/**
 * Postupy (štafeta) — jádro advance/rewind (R-postupy). Produkční port `_advance`/`rewindStep`
 * z prototypu (ř. 2483/2555): dokončení aktivního kroku → další dormant krok se aktivuje
 * (gate after_previous; with_previous se aktivuje spolu s předchozím; manual čeká na ruční
 * aktivaci). Odškrtnutí zpět → rewind (pozdější kroky dormant + jejich úkoly se od-dokončí).
 *
 * Rozhodnutí: advance běží KLIENTSKY při toggle úkolu (PowerSync UPDATE, LWW) — server-authored
 * advance až při řešení konfliktů více klientů (viz RECONCILIACE §23).
 */
import i18n from "@watson/i18n";
import { API_URL } from "./api";
import { reflowChain } from "./chainReflow";
import { powerSync } from "./powersync/db";
import { showToast } from "./toast";
import { pushUndo } from "./undo";

export interface ChainStepLite {
	id: string;
	chain_id: string | null;
	task_id: string | null;
	position: number | null;
	gate: string | null;
	step_state: string | null;
}

const isClosed = (s: ChainStepLite) => s.step_state === "done" || s.step_state === "skipped";

async function loadChainSteps(chainId: string): Promise<ChainStepLite[]> {
	return await powerSync.getAll<ChainStepLite>(
		"SELECT id, chain_id, task_id, position, gate, step_state FROM chain_steps WHERE chain_id = ? ORDER BY position",
		[chainId],
	);
}

async function setStepState(id: string, state: string): Promise<void> {
	await powerSync.execute("UPDATE chain_steps SET step_state = ?, activated_at = ? WHERE id = ?", [
		state,
		state === "active" ? new Date().toISOString() : null,
		id,
	]);
}

/**
 * Snímek celého postupu pro undo — advance/rewind/cascade mění nejen `tasks.completed_at`
 * (to řeší toggle), ale i step_state, cizí `tasks.due_date` (reflow) a per-osoba
 * `assignments.completed_at` (rewind shared_all). Bez snímku by ⌘Z (který drží jen sloupce
 * zdrojového úkolu z toggle) tyto vedlejší změny NEvrátil → trvale posunuté termíny řetězce
 * a rozjetý odvozený stav. ORDER BY kvůli stabilnímu porovnání snímků.
 */
interface ChainSnapshot {
	chainId: string;
	steps: { id: string; step_state: string | null; activated_at: string | null }[];
	tasks: { id: string; completed_at: string | null; due_date: string | null }[];
	assignments: { id: string; completed_at: string | null }[];
}

async function snapshotChain(chainId: string): Promise<ChainSnapshot> {
	const steps = await powerSync.getAll<{
		id: string;
		step_state: string | null;
		activated_at: string | null;
		task_id: string | null;
	}>(
		"SELECT id, step_state, activated_at, task_id FROM chain_steps WHERE chain_id = ? ORDER BY position, id",
		[chainId],
	);
	const taskIds = steps.map((s) => s.task_id).filter((x): x is string => !!x);
	const ph = taskIds.map(() => "?").join(", ");
	const tasks = taskIds.length
		? await powerSync.getAll<{
				id: string;
				completed_at: string | null;
				due_date: string | null;
			}>(`SELECT id, completed_at, due_date FROM tasks WHERE id IN (${ph}) ORDER BY id`, taskIds)
		: [];
	const assignments = taskIds.length
		? await powerSync.getAll<{ id: string; completed_at: string | null }>(
				`SELECT id, completed_at FROM assignments WHERE task_id IN (${ph}) ORDER BY id`,
				taskIds,
			)
		: [];
	return {
		chainId,
		steps: steps.map((s) => ({
			id: s.id,
			step_state: s.step_state,
			activated_at: s.activated_at,
		})),
		tasks,
		assignments,
	};
}

async function restoreChain(snap: ChainSnapshot): Promise<void> {
	await powerSync.writeTransaction(async (tx) => {
		for (const s of snap.steps)
			await tx.execute("UPDATE chain_steps SET step_state = ?, activated_at = ? WHERE id = ?", [
				s.step_state,
				s.activated_at,
				s.id,
			]);
		for (const t of snap.tasks)
			await tx.execute("UPDATE tasks SET completed_at = ?, due_date = ? WHERE id = ?", [
				t.completed_at,
				t.due_date,
				t.id,
			]);
		for (const a of snap.assignments)
			await tx.execute("UPDATE assignments SET completed_at = ? WHERE id = ?", [
				a.completed_at,
				a.id,
			]);
	});
	// Stav postupu je odvozený od kroků → po obnově dopočítat (ne verbatim ze snímku).
	await syncChainState(snap.chainId);
}

/** Zaregistruje kompenzační undo, jen když advance/rewind reálně něco změnil. */
function pushChainUndo(before: ChainSnapshot, after: ChainSnapshot): void {
	if (JSON.stringify(before) === JSON.stringify(after)) return;
	pushUndo({
		undo: () => restoreChain(before),
		redo: () => restoreChain(after),
	});
}

/**
 * Aktivuje krok na indexu `i` + souvislý běh následujících kroků s gate=with_previous
 * (souběh — aktivují se spolu s předchozím).
 */
async function activateRun(steps: ChainStepLite[], i: number): Promise<void> {
	const first = steps[i];
	if (!first) return;
	await setStepState(first.id, "active");
	for (let j = i + 1; j < steps.length; j++) {
		const st = steps[j];
		if (!st || st.gate !== "with_previous" || isClosed(st)) break;
		await setStepState(st.id, "active");
	}
}

/** Jméno prvního přiřazeného kroku (pro toast „Předáno → X"); offline → „kdokoli z týmu". */
async function handoffName(taskId: string | null): Promise<string> {
	const fallback = i18n.t("flows.anyoneTeam");
	if (!taskId) return fallback;
	try {
		const asg = await powerSync.getAll<{ user_id: string | null }>(
			"SELECT user_id FROM assignments WHERE task_id = ? ORDER BY created_at LIMIT 1",
			[taskId],
		);
		const uid = asg[0]?.user_id;
		if (!uid) return fallback;
		const tk = await powerSync.getAll<{ project_id: string | null }>(
			"SELECT project_id FROM tasks WHERE id = ? LIMIT 1",
			[taskId],
		);
		const pid = tk[0]?.project_id;
		if (!pid) return fallback;
		const r = await fetch(`${API_URL}/api/projects/${pid}/members`, {
			credentials: "include",
		});
		if (!r.ok) return fallback;
		const members = (await r.json()).members as { id: string; name: string }[];
		return members.find((m) => m.id === uid)?.name ?? fallback;
	} catch {
		return fallback;
	}
}

/**
 * Kaskáda při předání (prototyp _advance závěr, ř. 2483): zpožděný aktivovaný krok
 * v režimu Řetězec se přitáhne na dnešek + navazující kroky se přepočítají (reflow).
 */
async function cascadePull(chainId: string, step: ChainStepLite): Promise<void> {
	if (!step.task_id) return;
	const chain = await powerSync.getAll<{ sched_mode: string | null }>(
		"SELECT sched_mode FROM chains WHERE id = ? LIMIT 1",
		[chainId],
	);
	if ((chain[0]?.sched_mode ?? "chain") !== "chain") return;
	const tk = await powerSync.getAll<{ due_date: string | null }>(
		"SELECT due_date FROM tasks WHERE id = ? LIMIT 1",
		[step.task_id],
	);
	const due = tk[0]?.due_date?.slice(0, 10);
	const today = new Date();
	const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	if (!due || due >= todayIso) return;
	const delta = Math.round(
		(new Date(`${todayIso}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) /
			86_400_000,
	);
	await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [todayIso, step.task_id]);
	await reflowChain(chainId, step.position ?? 0);
	const unit =
		delta === 1 ? i18n.t("flows.day1") : delta < 5 ? i18n.t("flows.day234") : i18n.t("flows.day5");
	setTimeout(() => showToast(`${i18n.t("flows.cascadeMoved")} ${delta} ${unit}`), 1200);
}

/** Po změně stavů: pokud jsou všechny kroky uzavřené → chain done; jinak active. */
async function syncChainState(chainId: string): Promise<void> {
	const steps = await loadChainSteps(chainId);
	const allDone = steps.length > 0 && steps.every(isClosed);
	await powerSync.execute("UPDATE chains SET state = ?, completed_at = ? WHERE id = ?", [
		allDone ? "done" : "active",
		allDone ? new Date().toISOString() : null,
		chainId,
	]);
}

/**
 * Volá se PO toggle `tasks.completed_at`. Pokud je úkol krokem postupu:
 * done → krok done + aktivace dalšího dle gate; un-done → rewind od tohoto kroku.
 */
export async function advanceChainForTask(taskId: string, nowDone: boolean): Promise<void> {
	const mine = await powerSync.getAll<ChainStepLite>(
		"SELECT id, chain_id, task_id, position, gate, step_state FROM chain_steps WHERE task_id = ? LIMIT 1",
		[taskId],
	);
	const me = mine[0];
	if (!me?.chain_id) return;

	// Snímek PŘED zásahem — kompenzační undo pro vedlejší změny (step_state, cizí due_date,
	// per-osoba assignments), které toggle do svého ⌘Z nezahrnuje.
	const before = await snapshotChain(me.chain_id);

	if (nowDone) {
		await setStepState(me.id, "done");
		const steps = await loadChainSteps(me.chain_id);
		// první neuzavřený krok, před nímž je vše uzavřené
		for (let i = 0; i < steps.length; i++) {
			const st = steps[i];
			if (!st || isClosed(st)) continue;
			const priorDone = steps.slice(0, i).every(isClosed);
			if (!priorDone) break;
			if (st.step_state === "dormant") {
				if (st.gate === "manual") {
					// P1-01: manual brána se NIKDY neaktivuje automaticky — krok čeká
					// na explicitní activateStepManually (tlačítko v Postupech).
					showToast(i18n.t("flows.waitingManual"));
				} else {
					await activateRun(steps, i);
					// „Předáno → X" + kaskádové přitažení zpožděného kroku (prototyp ř. 2482–2483)
					void handoffName(st.task_id).then((who) => showToast(`${i18n.t("flows.handedTo")} ${who}`));
					await cascadePull(me.chain_id, st);
				}
			}
			break;
		}
	} else {
		await rewindToStepImpl(me);
	}
	await syncChainState(me.chain_id);
	pushChainUndo(before, await snapshotChain(me.chain_id));
}

/**
 * Idempotentní OPRAVA stavu postupu z jediného zdroje pravdy = `tasks.completed_at`.
 * Volá se při otevření detailu postupu. Napravuje drift ze souběžných offline změn (dva aktivní
 * kroky, done úkol s active krokem, postup „zaseklý" bez aktivního kroku): krok je `done` právě
 * když je jeho úkol hotový; `skipped` se zachovává; první neuzavřený krok s uzavřenými předchozími
 * = `active` (+ souvislý with_previous běh), zbytek `dormant`. NEmodifikuje úkoly (jen step_state).
 * Deterministické → dva klienti dopočítají STEJNÝ stav (konvergence přes LWW).
 */
/**
 * Čistý výpočet cílových stavů kroků (testovatelné bez DB). Pravidla:
 * done ⇔ úkol hotový; skipped se drží; první neuzavřený krok s uzavřenými
 * předchozími = active (+ souvislý with_previous běh) — POKUD nemá gate
 * 'manual': ten čeká na explicitní ruční aktivaci a repair/advance ho nesmí
 * spustit (P1-01). Už ručně aktivovaný manual krok zůstává active.
 */
export function computeChainStates(
	steps: (ChainStepLite & { completed: number })[],
): Map<string, string> {
	const desired = new Map<string, string>();
	const closed = (s: ChainStepLite & { completed: number }) =>
		s.step_state === "skipped" || desired.get(s.id) === "done";
	for (const s of steps) {
		if (s.step_state === "skipped") desired.set(s.id, "skipped");
		else if (s.completed) desired.set(s.id, "done");
	}
	let activated = false;
	for (let i = 0; i < steps.length; i++) {
		const s = steps[i];
		if (!s || desired.get(s.id) === "done" || s.step_state === "skipped") continue;
		const priorClosed = steps.slice(0, i).every((p) => closed(p));
		if (priorClosed && !activated) {
			activated = true;
			// P1-01: manual brána — bez dřívější ruční aktivace zůstává dormant
			if (s.gate === "manual" && s.step_state !== "active") break;
			desired.set(s.id, "active");
			for (let j = i + 1; j < steps.length; j++) {
				const st = steps[j];
				if (!st || st.gate !== "with_previous" || closed(st)) break;
				desired.set(st.id, "active");
			}
		}
	}
	for (const s of steps) if (!desired.has(s.id)) desired.set(s.id, "dormant");
	return desired;
}

export async function repairChain(chainId: string): Promise<void> {
	const steps = await powerSync.getAll<ChainStepLite & { completed: number }>(
		`SELECT cs.id, cs.chain_id, cs.task_id, cs.position, cs.gate, cs.step_state,
            (t.completed_at IS NOT NULL) AS completed
     FROM chain_steps cs LEFT JOIN tasks t ON t.id = cs.task_id
     WHERE cs.chain_id = ? ORDER BY cs.position`,
		[chainId],
	);
	if (steps.length === 0) return;
	const desired = computeChainStates(steps);
	const changes = steps.filter((s) => desired.get(s.id) !== s.step_state);
	if (changes.length > 0) {
		await powerSync.writeTransaction(async (tx) => {
			for (const s of changes) {
				const ns = desired.get(s.id) ?? "dormant";
				await tx.execute("UPDATE chain_steps SET step_state = ?, activated_at = ? WHERE id = ?", [
					ns,
					ns === "active" ? new Date().toISOString() : null,
					s.id,
				]);
			}
		});
	}
	await syncChainState(chainId);
}

/** Ruční aktivace dormant kroku (gate manual) — jen když jsou předchozí uzavřené. */
export async function activateStepManually(step: ChainStepLite): Promise<void> {
	if (!step.chain_id) return;
	const steps = await loadChainSteps(step.chain_id);
	const i = steps.findIndex((s) => s.id === step.id);
	if (i < 0 || !steps.slice(0, i).every(isClosed)) return;
	await activateRun(steps, i);
	await syncChainState(step.chain_id);
}

/**
 * „Vrátit sem" jádro (bez undo) — cílový krok znovu active (jeho úkol od-dokončit), všechny
 * pozdější kroky dormant + úkoly od-dokončit. VERBATIM sémantika rewindStep (ř. 2555).
 */
async function rewindToStepImpl(target: ChainStepLite): Promise<void> {
	if (!target.chain_id) return;
	const steps = await loadChainSteps(target.chain_id);
	const idx = steps.findIndex((s) => s.id === target.id);
	if (idx < 0) return;
	for (let i = idx; i < steps.length; i++) {
		const st = steps[i];
		if (!st) continue;
		await setStepState(st.id, i === idx ? "active" : "dormant");
		if (st.task_id) {
			await powerSync.execute("UPDATE tasks SET completed_at = NULL WHERE id = ?", [st.task_id]);
			// R2 — od-dokončit i per-osoba účasti (shared_all), jinak by task vypadal
			// nedokončený, ale všichni přiřazení by měli completed_at (rozjetý invariant).
			await powerSync.execute("UPDATE assignments SET completed_at = NULL WHERE task_id = ?", [
				st.task_id,
			]);
		}
	}
	await syncChainState(target.chain_id);
}

/** „Vrátit sem" s kompenzačním undo (přímé volání z detailu postupu). */
export async function rewindToStep(target: ChainStepLite): Promise<void> {
	if (!target.chain_id) return;
	const before = await snapshotChain(target.chain_id);
	await rewindToStepImpl(target);
	pushChainUndo(before, await snapshotChain(target.chain_id));
}
