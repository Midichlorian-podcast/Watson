/**
 * Postupy (štafeta) — jádro advance/rewind (R-postupy). Produkční port `_advance`/`rewindStep`
 * z prototypu (ř. 2483/2555): dokončení aktivního kroku → další dormant krok se aktivuje
 * (gate after_previous; with_previous se aktivuje spolu s předchozím; manual čeká na ruční
 * aktivaci). Odškrtnutí zpět → rewind (pozdější kroky dormant + jejich úkoly se od-dokončí).
 *
 * Rozhodnutí: advance běží KLIENTSKY při toggle úkolu (PowerSync UPDATE, LWW) — server-authored
 * advance až při řešení konfliktů více klientů (viz RECONCILIACE §23).
 */
import { powerSync } from "./powersync/db";

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
  await powerSync.execute(
    "UPDATE chain_steps SET step_state = ?, activated_at = ? WHERE id = ?",
    [state, state === "active" ? new Date().toISOString() : null, id],
  );
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
        if (st.gate === "manual") break; // čeká na ruční aktivaci
        await activateRun(steps, i);
      }
      break;
    }
  } else {
    await rewindToStep(me);
  }
  await syncChainState(me.chain_id);
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
 * „Vrátit sem" — cílový krok znovu active (jeho úkol od-dokončit), všechny pozdější
 * kroky dormant + úkoly od-dokončit. VERBATIM sémantika rewindStep (ř. 2555).
 */
export async function rewindToStep(target: ChainStepLite): Promise<void> {
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
    }
  }
  await syncChainState(target.chain_id);
}
