import i18n from "@watson/i18n";
import { logTaskActivity } from "./activity";
import { advanceChainForTask } from "./chainAdvance";
import {
	dependencyCompletionDecision,
	unresolvedDependencyState,
} from "./dependencies";
import { expandOccurrences, parseOccId, recurrenceKind } from "./occurrences";
import type { TaskRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";
import { showToast } from "./toast";
import {
	minutesInTimeZone,
	nextValidZonedDateTimeToIso,
	wallTimeFromInstant,
} from "./timeZone";
import { pushUndo } from "./undo";

const dependencyAcknowledgements = new Map<string, number>();

async function dependencyAllowsCompletion(taskId: string): Promise<boolean> {
	const state = await unresolvedDependencyState(taskId);
	const now = Date.now();
	const decision = dependencyCompletionDecision(state, dependencyAcknowledgements.get(taskId), now);
	if (decision === "allow") {
		dependencyAcknowledgements.delete(taskId);
		return true;
	}
	const names = state.blockers
		.slice(0, 2)
		.map((blocker) => blocker.name)
		.join(", ");
	if (decision === "deny") {
		showToast(i18n.t("dependencies.strictBlocked", { count: state.blockers.length, names }));
		return false;
	}
	dependencyAcknowledgements.set(taskId, now);
	showToast(i18n.t("dependencies.warningBlocked", { count: state.blockers.length, names }));
	return false;
}

/** UX preflight stejného invariantního pravidla, které autoritativně hlídá PostgreSQL trigger. */
async function acceptanceAllowsCompletion(taskId: string, onlyUserId?: string | null) {
	const rows = await powerSync.getAll<{ user_id: string; status: string | null }>(
		`SELECT assignment.user_id, acceptance.status
		 FROM tasks task
		 JOIN projects project ON project.id = task.project_id
		 JOIN assignments assignment ON assignment.task_id = task.id
		 LEFT JOIN task_acceptances acceptance
		   ON acceptance.task_id = task.id AND acceptance.assignee_id = assignment.user_id
		 WHERE task.id = ?
		   AND project.urgent_acceptance_enabled = 1
		   AND task.kind = 'task'
		   AND task.priority <= COALESCE(project.urgent_acceptance_priority, 1)
		   AND (task.created_by IS NULL OR task.created_by <> assignment.user_id)
		   AND (? = '' OR assignment.user_id = ?)`,
		[taskId, onlyUserId ?? "", onlyUserId ?? ""],
	);
	const unresolved = rows.filter((row) => row.status !== "accepted");
	if (unresolved.length === 0) return true;
	showToast(i18n.t("detail.acceptanceCompletionBlocked", { count: unresolved.length }));
	return false;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const todayISO = () => {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Den termínu úkolu (YYYY-MM-DD) nebo null. */
export const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);

/**
 * SQL fragment: vynech PORADY (kind='meeting') z pracovních seznamů, počtů a statistik.
 * Porady mají modul Meets; viditelné zůstávají jen v agendových pohledech (Dnes/Nadcházející/
 * kalendář/Watson/denní peek). SQLite `IS NOT` pouští i NULL (čerstvé lokální řádky bez kind).
 * JEDNO místo pravdy — nový dotaz nad tasks si sáhne sem, ne na ruční literál.
 */
export const NOT_MEETING = "kind IS NOT 'meeting'";

/**
 * Minuty od půlnoci ze start_date — JEDINÝ parser času úkolu (wall-clock ze STRINGU;
 * `new Date()` by po sync round-tripu timestamptz „+00" posunul čas o zónu — P1-06).
 * Konvence: 00:00 = bez času (kalendář kreslí all-day). Sdílí řádek, kalendář i měsíc.
 */
export const startMinOf = (
	t: Pick<TaskRow, "start_date"> & Partial<Pick<TaskRow, "start_timezone">>,
): number | null => {
	const s = t.start_date;
	if (!s || s.length < 16) return null;
	const zoned = minutesInTimeZone(s, t.start_timezone);
	if (zoned !== null) return zoned === 0 ? null : zoned;
	const h = +s.slice(11, 13);
	const m = +s.slice(14, 16);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	if (h === 0 && m === 0) return null;
	return h * 60 + m;
};

/**
 * Upsert per-výskyt výjimky (exceptions prototypu) — done/skip jednoho výskytu.
 * Zapisuje do undo zásobníku (⌘Z) — prototyp volá _pushHist před mutací exceptions
 * (skipOccurrence ř. 2477, setOccField ř. 2479).
 */
export async function setOccurrenceOverride(
	taskId: string,
	projectId: string | null,
	iso: string,
	patch: { done?: boolean; skipped?: boolean },
) {
	const rows = await powerSync.getAll<{
		id: string;
		done: number | null;
		skipped: number | null;
	}>(
		"SELECT id, done, skipped FROM task_occurrence_overrides WHERE task_id = ? AND occ_date = ? LIMIT 1",
		[taskId, iso],
	);
	const ex = rows[0];
	if (ex) {
		const prev = { done: ex.done ? 1 : 0, skipped: ex.skipped ? 1 : 0 };
		const next = {
			done: (patch.done ?? !!ex.done) ? 1 : 0,
			skipped: (patch.skipped ?? !!ex.skipped) ? 1 : 0,
		};
		const apply = async (v: { done: number; skipped: number }) => {
			await powerSync.execute(
				"UPDATE task_occurrence_overrides SET done = ?, skipped = ? WHERE id = ?",
				[v.done, v.skipped, ex.id],
			);
		};
		await apply(next);
		pushUndo({ undo: () => apply(prev), redo: () => apply(next) });
	} else {
		const nid = crypto.randomUUID();
		const insert = async () => {
			await powerSync.execute(
				`INSERT INTO task_occurrence_overrides (id, task_id, project_id, occ_date, done, skipped, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					nid,
					taskId,
					projectId,
					iso,
					patch.done ? 1 : 0,
					patch.skipped ? 1 : 0,
					new Date().toISOString(),
				],
			);
		};
		await insert();
		pushUndo({
			undo: async () => {
				await powerSync.execute("DELETE FROM task_occurrence_overrides WHERE id = ?", [nid]);
			},
			redo: insert,
		});
	}
}

/** Lidský label výskytu „čt 2. 7." (prototyp _occLabel). */
export const occLabel = (iso: string) => {
	const d = iso.slice(0, 10);
	return `${wdShort(d)} ${+d.slice(8, 10)}. ${+d.slice(5, 7)}.`;
};

/**
 * Provázané zaškrtnutí ↔ stav „Hotovo" (R9), offline-first zápis. Kroky postupů → advance.
 * Virtuální výskyt (`id@ISO`) → jen per-výskyt výjimka. Opakovaný base úkol → posun řady
 * na další výskyt (prototyp toggleDone, ř. 2482) s respektem ke konci opakování.
 */
/**
 * R9 — dopočet status_id při přepnutí done (Board sloupce). done=true → is_done status,
 * done=false z „Hotovo" → první ne-done status; jinak status nechat.
 */
async function resolveStatusForDone(
	taskId: string,
	done: boolean,
	currentStatusId: string | null,
): Promise<string | null> {
	const sts = await powerSync.getAll<{
		id: string;
		is_done: number | null;
		position: number | null;
	}>(
		`SELECT s.id, s.is_done, s.position FROM statuses s
     JOIN tasks t ON t.project_id = s.project_id WHERE t.id = ? ORDER BY s.position`,
		[taskId],
	);
	const doneStatus = sts.find((s) => s.is_done)?.id ?? null;
	const firstStatus = sts.find((s) => !s.is_done)?.id ?? sts[0]?.id ?? null;
	return done
		? (doneStatus ?? currentStatusId)
		: currentStatusId === doneStatus
			? firstStatus
			: currentStatusId;
}

/**
 * Přepnutí dokončení úkolu. `actorId` = přihlášený uživatel (nutné pro R2 shared_all, kde hlavní
 * checkbox přepíná JEN účast aktéra a `tasks.completed_at` je ODVOZENÉ až odškrtnou všichni).
 */
export async function toggleTask(task: TaskRow, actorId?: string) {
	// Výskyt řady → přepnout done výjimky, řadu nechat být.
	const occ = parseOccId(task.id);
	if (occ) {
		const nowDone = !task.completed_at;
		if (nowDone && !(await acceptanceAllowsCompletion(occ.taskId, actorId))) return;
		if (nowDone && !(await dependencyAllowsCompletion(occ.taskId))) return;
		await setOccurrenceOverride(occ.taskId, task.project_id, occ.iso, {
			done: nowDone,
		});
		return;
	}

	// R2 — shared_all: „každý zvlášť". Hlavní checkbox přepíná POUZE mou účast (assignments);
	// úkol je hotový, až když jsou hotoví VŠICHNI přiřazení. Jediný člen tak nedokončí úkol všem
	// a naopak — když odškrtnou všichni, úkol se odvozeně dokončí. (K1)
	if (task.assignment_mode === "shared_all" && actorId) {
		const asg = await powerSync.getAll<{
			id: string;
			user_id: string | null;
			completed_at: string | null;
		}>("SELECT id, user_id, completed_at FROM assignments WHERE task_id = ?", [task.id]);
		const mine = asg.find((a) => a.user_id === actorId);
		// S3 (R2) — aktér BEZ účasti (např. manažer přes hromadné „Hotovo" nebo detail
		// cizího úkolu) dřív propadl do obecné větve a nastavil tasks.completed_at
		// všem, čímž obešel odvozené dokončení. Správně: dokončení neúčastníkem =
		// dokončit VŠECHNY účasti (per-osoba completed_at) v jedné transakci
		// a tasks.completed_at nastavit jen ODVOZENĚ; un-toggle symetricky vše zruší.
		if (asg.length > 0 && !mine) {
			const nowDone = !task.completed_at;
			if (nowDone && !(await acceptanceAllowsCompletion(task.id))) return;
			if (nowDone && !(await dependencyAllowsCompletion(task.id))) return;
			// R4 — u opakovaného úkolu je dokončení posunem řady (+ reset per-osoba účastí),
			// ne trvalé nastavení completed_at všem.
			if (nowDone && (await advanceRecurrence(task, asg))) return;
			const ts = new Date().toISOString();
			const prevAsg = asg.map((a) => ({ id: a.id, val: a.completed_at }));
			// dokončení: už hotové účasti si nechají původní čas. ODškrtnutí neúčastníkem
			// (S2) NEmaže reálná dokončení kolegů — účasti necháme beze změny a zrušíme jen
			// odvozený task-level stav; jinak by manažerův un-toggle smazal cizí práci.
			const nextAsg = asg.map((a) => ({
				id: a.id,
				val: nowDone ? (a.completed_at ?? ts) : a.completed_at,
			}));
			const prevTaskDone = task.completed_at;
			const prevStatus = task.status_id;
			const newTaskDone = nowDone ? ts : null;
			const nextStatus = await resolveStatusForDone(task.id, nowDone, task.status_id);
			const apply = async (
				vals: { id: string; val: string | null }[],
				taskDone: string | null,
				st: string | null,
			) => {
				await powerSync.writeTransaction(async (tx) => {
					for (const v of vals)
						await tx.execute("UPDATE assignments SET completed_at = ? WHERE id = ?", [v.val, v.id]);
					await tx.execute("UPDATE tasks SET completed_at = ?, status_id = ? WHERE id = ?", [
						taskDone,
						st,
						task.id,
					]);
				});
			};
			await apply(nextAsg, newTaskDone, nextStatus);
			pushUndo({
				undo: () => apply(prevAsg, prevTaskDone, prevStatus),
				redo: () => apply(nextAsg, newTaskDone, nextStatus),
			});
			if (nowDone !== !!prevTaskDone) {
				void logTaskActivity(
					task.id,
					task.project_id,
					actorId,
					"completed",
					prevTaskDone ? "1" : null,
					newTaskDone ? "1" : null,
				);
				await advanceChainForTask(task.id, nowDone);
			}
			return;
		}
		// >= 1: i jediný zbylý účastník (=já) musí projít odvozeným modelem R2, jinak by
		// obecná větev nastavila jen tasks.completed_at a mou účast nechala null.
		if (asg.length >= 1 && mine) {
			const nowMineDone = !mine.completed_at;
			if (nowMineDone && !(await acceptanceAllowsCompletion(task.id, actorId))) return;
			if (nowMineDone && !(await dependencyAllowsCompletion(task.id))) return;
			const allDone = asg.every((a) => (a.id === mine.id ? nowMineDone : !!a.completed_at));
			// R4 — pokud mou účastí spadli všichni a úkol se opakuje, posuň řadu + reset účastí.
			if (nowMineDone && allDone && (await advanceRecurrence(task, asg))) return;
			const myTs = nowMineDone ? new Date().toISOString() : null;
			const prevTaskDone = task.completed_at;
			const prevStatus = task.status_id;
			const newTaskDone = allDone ? new Date().toISOString() : null;
			const nextStatus = await resolveStatusForDone(task.id, allDone, task.status_id);
			const apply = async (myVal: string | null, taskDone: string | null, st: string | null) => {
				await powerSync.execute("UPDATE assignments SET completed_at = ? WHERE id = ?", [
					myVal,
					mine.id,
				]);
				await powerSync.execute("UPDATE tasks SET completed_at = ?, status_id = ? WHERE id = ?", [
					taskDone,
					st,
					task.id,
				]);
			};
			await apply(myTs, newTaskDone, nextStatus);
			pushUndo({
				undo: () => apply(mine.completed_at, prevTaskDone, prevStatus),
				redo: () => apply(myTs, newTaskDone, nextStatus),
			});
			// Postup posune jen při skutečné změně hotovosti úkolu jako celku.
			if (allDone !== !!prevTaskDone) {
				void logTaskActivity(
					task.id,
					task.project_id,
					actorId,
					"completed",
					prevTaskDone ? "1" : null,
					newTaskDone ? "1" : null,
				);
				await advanceChainForTask(task.id, allDone);
			}
			return;
		}
	}

	const nowDone = !task.completed_at;
	if (nowDone && !(await acceptanceAllowsCompletion(task.id))) return;
	if (nowDone && !(await dependencyAllowsCompletion(task.id))) return;
	// R4 — dokončení opakovaného úkolu = posun řady na další výskyt (ne trvalé dokončení).
	if (nowDone && (await advanceRecurrence(task))) return;
	// R9: zaškrtnutí ⇄ stav „Hotovo" — synchronizovat i status sloupec (prototyp toggleDone).
	const nextStatus = await resolveStatusForDone(task.id, nowDone, task.status_id);
	const prevDone = task.completed_at;
	const prevStatus = task.status_id;
	const newDone = nowDone ? new Date().toISOString() : null;
	const writeDone = async (c: string | null, st: string | null) => {
		await powerSync.execute("UPDATE tasks SET completed_at = ?, status_id = ? WHERE id = ?", [
			c,
			st,
			task.id,
		]);
	};
	await writeDone(newDone, nextStatus);
	// historie: dokončení/obnovení i mimo detail (checkbox v seznamu, kartě…)
	void logTaskActivity(
		task.id,
		task.project_id,
		actorId,
		"completed",
		prevDone ? "1" : null,
		newDone ? "1" : null,
	);
	pushUndo({
		undo: () => writeDone(prevDone, prevStatus),
		redo: () => writeDone(newDone, nextStatus),
	});
	await advanceChainForTask(task.id, nowDone);
}

/**
 * R4 — posun opakovaného úkolu na DALŠÍ výskyt (respekt endKind/until/count + doneCount).
 * Vrací true, když se řada posunula. `asgReset` = účasti k vynulování pro nový výskyt
 * (shared_all: „při dalším výskytu reset všech per-osoba dokončení"). Zapisuje undo.
 */
async function advanceRecurrence(
	task: TaskRow,
	asgReset: { id: string; completed_at: string | null }[] = [],
): Promise<boolean> {
	const kind = recurrenceKind(task.recurrence_rule);
	const due = task.due_date?.slice(0, 10);
	if (!kind || !due) return false;
	// Konec opakování z rule JSON (endKind/until/count + doneCount).
	let rule: Record<string, unknown> = {};
	try {
		rule = JSON.parse(task.recurrence_rule ?? "{}") as Record<string, unknown>;
	} catch {
		/* ponech prázdné */
	}
	const doneCount = (typeof rule.doneCount === "number" ? rule.doneCount : 0) + 1;
	const endKind = typeof rule.endKind === "string" ? rule.endKind : "never";
	const reachedCount =
		endKind === "count" && typeof rule.count === "number" && doneCount >= rule.count;
	const [next] = expandOccurrences({
		baseISO: due,
		kind,
		weekday: typeof rule.weekday === "number" ? rule.weekday : undefined,
		nth: typeof rule.nth === "number" ? rule.nth : undefined,
		day: typeof rule.day === "number" ? rule.day : undefined,
		parity: rule.parity === "even" || rule.parity === "odd" ? rule.parity : undefined,
		fromISO: isoPlus(due, 1),
		toISO: isoPlus(due, 800),
		cap: 1,
	});
	const pastUntil =
		endKind === "until" && typeof rule.until === "string" && next && next > rule.until;
	if (!next || reachedCount || pastUntil) return false;
	const wallTime =
		task.start_date && task.start_timezone
			? wallTimeFromInstant(task.start_date, task.start_timezone)
			: null;
	const nextStart =
		task.start_date && task.start_timezone && wallTime
			? nextValidZonedDateTimeToIso(next, wallTime, task.start_timezone)
			: task.start_date
				? `${next}T${task.start_date.slice(11)}`
				: null;
	if (task.start_date && !nextStart) {
		showToast(i18n.t("addmodal.invalidLocalTime"));
		return false;
	}
	const prev = {
		due_date: task.due_date,
		start_date: task.start_date,
		recurrence_rule: task.recurrence_rule,
	};
	const nextRule = JSON.stringify({ ...rule, doneCount });
	const write = async (
		d: string | null,
		sd: string | null,
		rr: string | null,
		asg: { id: string; val: string | null }[],
	) => {
		await powerSync.writeTransaction(async (tx) => {
			await tx.execute(
				"UPDATE tasks SET due_date = ?, start_date = ?, recurrence_rule = ? WHERE id = ?",
				[d, sd, rr, task.id],
			);
			for (const a of asg)
				await tx.execute("UPDATE assignments SET completed_at = ? WHERE id = ?", [a.val, a.id]);
		});
	};
	const cleared = asgReset.map((a) => ({ id: a.id, val: null }));
	const restore = asgReset.map((a) => ({ id: a.id, val: a.completed_at }));
	await write(next, nextStart, nextRule, cleared);
	// ⌘Z vrátí posun řady i reset účastí (prototyp verzuje každou změnu tasks, ř. 2239).
	pushUndo({
		undo: () => write(prev.due_date, prev.start_date, prev.recurrence_rule, restore),
		redo: () => write(next, nextStart, nextRule, cleared),
	});
	showToast(`${i18n.t("detail.movedTo")} ${occLabel(next)}`);
	return true;
}

/**
 * Přepnutí dokončení KONKRÉTNÍ účasti (per-osoba kulatý checkbox v shared_all detailu).
 * Po zápisu ODVODÍ tasks.completed_at (R2 — hotovo až když všichni) + status (R9) + posun
 * postupu; symetricky při odškrtnutí. Vše v jednom undo záznamu (dřív chybělo → R2 obcházeno).
 */
export async function toggleAssignmentDone(task: TaskRow, assignmentId: string) {
	const asg = await powerSync.getAll<{
		id: string;
		user_id: string | null;
		completed_at: string | null;
	}>("SELECT id, user_id, completed_at FROM assignments WHERE task_id = ?", [task.id]);
	const target = asg.find((a) => a.id === assignmentId);
	if (!target) return;
	const nowDone = !target.completed_at;
	// Detail umožňuje přepnout konkrétní účast mimo hlavní checkbox. Musí projít
	// stejnou závislostní branou, jinak by tento povrch obešel warning/strict UX.
	if (nowDone && !(await acceptanceAllowsCompletion(task.id, target.user_id))) return;
	if (nowDone && !(await dependencyAllowsCompletion(task.id))) return;
	const allDone = asg.every((a) => (a.id === assignmentId ? nowDone : !!a.completed_at));
	// R4 — poslední dokončení u opakovaného úkolu = posun řady + reset účastí.
	if (nowDone && allDone && (await advanceRecurrence(task, asg))) return;
	const myTs = nowDone ? new Date().toISOString() : null;
	const prevTaskDone = task.completed_at;
	const prevStatus = task.status_id;
	const newTaskDone = allDone ? (task.completed_at ?? new Date().toISOString()) : null;
	const nextStatus = await resolveStatusForDone(task.id, allDone, task.status_id);
	const apply = async (aVal: string | null, taskDone: string | null, st: string | null) => {
		await powerSync.writeTransaction(async (tx) => {
			await tx.execute("UPDATE assignments SET completed_at = ? WHERE id = ?", [
				aVal,
				assignmentId,
			]);
			await tx.execute("UPDATE tasks SET completed_at = ?, status_id = ? WHERE id = ?", [
				taskDone,
				st,
				task.id,
			]);
		});
	};
	await apply(myTs, newTaskDone, nextStatus);
	pushUndo({
		undo: () => apply(target.completed_at, prevTaskDone, prevStatus),
		redo: () => apply(myTs, newTaskDone, nextStatus),
	});
	if (allDone !== !!prevTaskDone) await advanceChainForTask(task.id, allDone);
}

const isoPlus = (iso: string, n: number) => {
	const d = fromISO(iso);
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fromISO = (d: string) => {
	const [y, m, day] = d.split("-").map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
};
const wdShort = (d: string) =>
	new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(fromISO(d));

/**
 * Štítek termínu pro TaskCard (1:1 dle designu): po termínu = „po termínu · {den}" (červeně),
 * dnes/zítra slovy, jinak „{den v týdnu} {d. m.}".
 */
export function dueLabel(dueRaw: string, t: (k: string) => string) {
	const d = dueRaw.slice(0, 10);
	const tdy = todayISO();
	if (d < tdy)
		return {
			label: `${t("today.duePastLower")} · ${wdShort(d)}`,
			overdue: true,
		};
	if (d === tdy) return { label: t("today.todayLower"), overdue: false };
	const tm = new Date();
	tm.setDate(tm.getDate() + 1);
	const tmISO = `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(tm.getDate())}`;
	if (d === tmISO) return { label: t("today.tomorrowLower"), overdue: false };
	const dt = fromISO(d);
	return {
		label: `${wdShort(d)} ${dt.getDate()}. ${dt.getMonth() + 1}.`,
		overdue: false,
	};
}

/** Deadline vlaječka „do pá 27. 6." (prototyp deadlineLabel, seed ř. 2158). */
export function deadlineLabel(deadlineRaw: string | null) {
	if (!deadlineRaw) return undefined;
	const d = deadlineRaw.slice(0, 10);
	const dt = fromISO(d);
	// Prefix „do"/„by" přes i18n (dřív natvrdo česky i v EN).
	return `${i18n.t("deadline.byPrefix")} ${wdShort(d)} ${dt.getDate()}. ${dt.getMonth() + 1}.`;
}

/**
 * Termín pro ŘÁDEK úkolu (prototyp timeLabel/dueLabel, ř. 2902–2903 + submitTask 2463–2466):
 * dnes s časem = „09:00–10:30" (konec = start + trvání), jiné dny s časem = „zítra · 13:00",
 * vícedenní = „N dní", datum v příštím týdnu = „{den} · příští týden".
 */
export function rowDue(task: TaskRow, t: (k: string, o?: Record<string, unknown>) => string) {
	const dueRaw = task.due_date;
	if (!dueRaw) return undefined;
	const d = dueRaw.slice(0, 10);
	const tdy = todayISO();
	// Čas ze sdíleného parseru (startMinOf) — jeden zdroj pravdy s kalendářem (P1-06).
	const sMin = startMinOf(task);
	const minLbl = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
	const time = sMin != null ? minLbl(sMin) : null;
	const days = task.days ?? 1;

	if (d < tdy)
		return {
			label: `${t("today.duePastLower")} · ${wdShort(d)}`,
			overdue: true,
		};
	if (days > 1)
		return {
			label: `${time ? `${time} · ` : ""}${t("today.daysCount", { count: days })}`,
			overdue: false,
		};
	if (d === tdy) {
		if (time != null && sMin != null) {
			const end = sMin + (task.duration_min ?? 30);
			return { label: `${time}–${minLbl(end)}`, overdue: false };
		}
		return { label: t("today.todayLower"), overdue: false };
	}
	const base = dueLabel(dueRaw, t).label;
	// Datum v příštím kalendářním týdnu → „{den} · příští týden" (prototyp ř. 2180).
	const now = fromISO(tdy);
	const nextMonday = new Date(now);
	nextMonday.setDate(now.getDate() + ((1 - now.getDay() + 7) % 7 || 7));
	const nextSunday = new Date(nextMonday);
	nextSunday.setDate(nextMonday.getDate() + 6);
	const dt = fromISO(d);
	if (dt >= nextMonday && dt <= nextSunday && d !== todayISO()) {
		return {
			label: `${wdShort(d)} · ${t("today.nextWeekLower")}${time ? ` · ${time}` : ""}`,
			overdue: false,
		};
	}
	return { label: `${base}${time ? ` · ${time}` : ""}`, overdue: false };
}
