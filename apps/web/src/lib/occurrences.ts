import type { RecurrenceRule } from "./quickadd/types";

/**
 * R4 — occurrence engine. Expanduje opakovaný úkol na výskyty v okně.
 * Krok je kalendářní od base data (1:1 s prototypem `_recOccur`): weekly=+7 dní,
 * monthly=+1 měsíc atd. Přesná projekce nth/parity/monthly-day je zjednodušená
 * (viz files/logika/02 §3.1) — stačí `kind` pro krok.
 */

const parseISO = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toISO = (d: Date) => d.toISOString().slice(0, 10);

/** Posune datum o jeden krok podle druhu opakování (in-place, UTC). */
function advance(d: Date, kind: RecurrenceRule["kind"]): void {
	switch (kind) {
		case "daily":
			d.setUTCDate(d.getUTCDate() + 1);
			break;
		case "weekly":
			d.setUTCDate(d.getUTCDate() + 7);
			break;
		case "biweekly":
			d.setUTCDate(d.getUTCDate() + 14);
			break;
		case "monthly":
		case "monthly-nth":
		case "monthly-day":
			d.setUTCMonth(d.getUTCMonth() + 1);
			break;
		case "yearly":
			d.setUTCFullYear(d.getUTCFullYear() + 1);
			break;
	}
}

export interface ExpandOpts {
	/** ISO base data řady (due_date). */
	baseISO: string;
	kind: RecurrenceRule["kind"];
	/** okno [fromISO, toISO] včetně. */
	fromISO: string;
	toISO: string;
	/** limit počtu vrácených dat. */
	cap?: number;
	/** Konec opakování „do data" (prototyp _recOccur: iso>until → break). */
	until?: string | null;
	/** Konec opakování „N×" — index výskytu od base, doneCount posouvá start. */
	count?: number | null;
	/** Už odškrtnuté výskyty řady (doneCount z rule) — pro count limit. */
	doneCount?: number;
	/** false = promítat jen NEJBLIŽŠÍ budoucí výskyt (prototyp repeatShowAll). */
	showAll?: boolean;
}

/** Vrátí ISO data výskytů v okně [fromISO, toISO]. Guard 800 proti zacyklení. */
export function expandOccurrences({
	baseISO,
	kind,
	fromISO,
	toISO: to,
	cap = 366,
	until,
	count,
	doneCount = 0,
	showAll = true,
}: ExpandOpts): string[] {
	if (!baseISO) return [];
	const A = parseISO(fromISO);
	const B = parseISO(to);
	const res: string[] = [];
	const cur = parseISO(baseISO);
	let idx = doneCount;
	let guard = 0;
	while (guard < 800 && res.length < cap) {
		if (cur.getTime() > B.getTime()) break;
		if (until && toISO(cur) > until.slice(0, 10)) break;
		if (count != null && count > 0 && idx >= count) break;
		if (cur.getTime() >= A.getTime()) res.push(toISO(cur));
		advance(cur, kind);
		idx++;
		guard++;
	}
	return showAll ? res : res.slice(0, 1);
}

/** Virtuální identita výskytu — `taskId@YYYY-MM-DD`. */
export const occId = (taskId: string, iso: string) => `${taskId}@${iso}`;
export const isOccId = (id: string) => id.indexOf("@") > 0;
export function parseOccId(id: string): { taskId: string; iso: string } | null {
	const i = id.indexOf("@");
	return i > 0 ? { taskId: id.slice(0, i), iso: id.slice(i + 1) } : null;
}

/** Vytáhne `kind` opakování z uloženého `recurrence_rule` (JSON). null = neopakuje se. */
export function recurrenceKind(
	rule: string | null | undefined,
): RecurrenceRule["kind"] | null {
	if (!rule) return null;
	try {
		const parsed = JSON.parse(rule) as Partial<RecurrenceRule>;
		return parsed.kind ?? null;
	} catch {
		return null;
	}
}

export interface ParsedRecurrence {
	kind: RecurrenceRule["kind"];
	until?: string | null;
	count?: number | null;
	doneCount: number;
	showAll: boolean;
}

/** Celé pravidlo opakování vč. konce (endKind/until/count) a showAll pro projekci výskytů. */
export function parseRecurrenceRule(
	rule: string | null | undefined,
): ParsedRecurrence | null {
	if (!rule) return null;
	try {
		const p = JSON.parse(rule) as Record<string, unknown>;
		if (typeof p.kind !== "string") return null;
		const endKind = typeof p.endKind === "string" ? p.endKind : "never";
		return {
			kind: p.kind as RecurrenceRule["kind"],
			until:
				endKind === "until" && typeof p.until === "string" ? p.until : null,
			count:
				endKind === "count" && typeof p.count === "number" ? p.count : null,
			doneCount: typeof p.doneCount === "number" ? p.doneCount : 0,
			showAll: p.showAll !== false,
		};
	} catch {
		return null;
	}
}
