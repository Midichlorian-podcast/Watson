export const RECURRENCE_KINDS = [
	"daily",
	"weekly",
	"biweekly",
	"monthly",
	"yearly",
	"monthly-nth",
	"monthly-day",
] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

const recurrenceKinds = new Set<string>(RECURRENCE_KINDS);

/**
 * R4 — occurrence engine. Expanduje opakovaný úkol na výskyty v okně [fromISO, toISO].
 *
 * Na rozdíl od zjednodušené verze (jen `kind` + krok od kotvy, viz files/logika/02 §3.1)
 * tento materializer respektuje strukturovaná pravidla uložená v `recurrence_rule`
 * (files/logika/02 §3.2): `monthly-nth` (n-tý den v týdnu), `monthly-day` (konkrétní den
 * v měsíci) a `parity` (sudý/lichý ISO týden) generují SKUTEČNÉ kalendářní termíny, ne jen
 * `+krok` od base data. Daily/weekly/biweekly/monthly/yearly krokují od base (kotvy) jako
 * dřív — kompatibilita s callery, kteří filtrují první výskyt `=== base`.
 */

const parseISO = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** ISO číslo týdne (1–53, pondělí = začátek týdne). */
function isoWeek(d: Date): number {
	const t = utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	const day = (t.getUTCDay() + 6) % 7; // Po=0 … Ne=6
	t.setUTCDate(t.getUTCDate() - day + 3); // čtvrtek téhož ISO týdne
	const firstThu = utc(t.getUTCFullYear(), 0, 4);
	const fday = (firstThu.getUTCDay() + 6) % 7;
	firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
	return 1 + Math.round((t.getTime() - firstThu.getTime()) / 604800000);
}

/** n-tý `wd` (0=Ne…6=So) v měsíci; nth=-1 = poslední. null když neexistuje (např. 5. pondělí). */
function nthWeekday(y: number, m: number, nth: number, wd: number): Date | null {
	if (nth === -1) {
		const last = daysInMonth(y, m);
		const back = (utc(y, m, last).getUTCDay() - wd + 7) % 7;
		return utc(y, m, last - back);
	}
	const offset = (wd - utc(y, m, 1).getUTCDay() + 7) % 7;
	const day = 1 + offset + (nth - 1) * 7;
	return day <= daysInMonth(y, m) ? utc(y, m, day) : null;
}

/**
 * Kotva řady. Pro weekly/biweekly se srovná na cílový `weekday` (a u biweekly na správnou
 * paritu ISO týdne), aby „každé pondělí" padalo na pondělí i když base data leží jinde.
 * Ostatní druhy krokují přímo od base.
 */
function seriesAnchor(
	base: Date,
	kind: RecurrenceKind,
	weekday?: number,
	parity?: "even" | "odd",
): Date {
	if ((kind === "weekly" || kind === "biweekly") && weekday != null) {
		const fwd = (weekday - base.getUTCDay() + 7) % 7;
		let a = fwd ? utc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + fwd) : base;
		if (kind === "biweekly" && parity) {
			const want = parity === "even" ? 0 : 1;
			if (isoWeek(a) % 2 !== want) a = utc(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + 7);
		}
		return a;
	}
	return base;
}

/** k-tý výskyt řady od kotvy. null = daný interval nemá platné datum (přeskoč — 31. v únoru, 5. pondělí). */
function occurrenceAt(
	anchor: Date,
	kind: RecurrenceKind,
	k: number,
	r: { weekday?: number; nth?: number; day?: number },
): Date | null {
	const y = anchor.getUTCFullYear();
	const m = anchor.getUTCMonth();
	const d = anchor.getUTCDate();
	switch (kind) {
		case "daily":
			return utc(y, m, d + k);
		case "weekly":
			return utc(y, m, d + 7 * k);
		case "biweekly":
			return utc(y, m, d + 14 * k);
		case "monthly":
			return utc(y, m + k, d); // JS přetočí 31.→ další měsíc (prototyp)
		case "yearly":
			return utc(y + k, m, d);
		case "monthly-day": {
			const total = m + k;
			const yy = y + Math.floor(total / 12);
			const mm = ((total % 12) + 12) % 12;
			const day = r.day ?? d;
			return day <= daysInMonth(yy, mm) ? utc(yy, mm, day) : null;
		}
		case "monthly-nth": {
			const total = m + k;
			const yy = y + Math.floor(total / 12);
			const mm = ((total % 12) + 12) % 12;
			return nthWeekday(yy, mm, r.nth ?? 1, r.weekday ?? anchor.getUTCDay());
		}
	}
	return null;
}

export interface ExpandOpts {
	/** ISO base data řady (due_date). */
	baseISO: string;
	kind: RecurrenceKind;
	/** weekly/biweekly/monthly-nth: cílový den v týdnu (0=Ne…6=So, dle getDay). */
	weekday?: number;
	/** monthly-nth: -1 = poslední, 1..5 = první..páté. */
	nth?: number;
	/** monthly-day: 1..31. */
	day?: number;
	/** biweekly: sudý/lichý ISO týden. */
	parity?: "even" | "odd";
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
	weekday,
	nth,
	day,
	parity,
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
	const anchor = seriesAnchor(parseISO(baseISO), kind, weekday, parity);
	const res: string[] = [];
	let idx = doneCount;
	// Guard 800 je od kotvy — u vzdáleného okna (denně >~2,2 roku) by se vyčerpal dřív, než
	// lineární krokování dojde k `fromISO`, a řada by zmizela. U uniformních druhů (každý krok
	// = právě jeden platný výskyt) předpočítáme počáteční `k` skokem k oknu a posuneme `idx`.
	let k0 = 0;
	const diff = A.getTime() - anchor.getTime();
	if (diff > 0) {
		const dayMs = 86400000;
		if (kind === "daily") k0 = Math.floor(diff / dayMs);
		else if (kind === "weekly") k0 = Math.floor(diff / (7 * dayMs));
		else if (kind === "biweekly") k0 = Math.floor(diff / (14 * dayMs));
		else if (kind === "monthly")
			k0 = Math.max(
				0,
				(A.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
					(A.getUTCMonth() - anchor.getUTCMonth()) -
					1,
			);
		else if (kind === "yearly") k0 = Math.max(0, A.getUTCFullYear() - anchor.getUTCFullYear() - 1);
		// monthly-day/monthly-nth mají kalendářní díry (null výskyty) → necháme lineárně (800
		// měsíčních kroků pokryje 66 let, guard je tam nedosažitelný).
		idx += k0;
	}
	for (let k = k0, guard = 0; guard < 800 && res.length < cap; k++, guard++) {
		const cur = occurrenceAt(anchor, kind, k, { weekday, nth, day });
		if (!cur) continue; // interval bez platného data (31. v únoru, chybějící 5. výskyt)
		if (cur.getTime() > B.getTime()) break;
		if (count != null && count > 0 && idx >= count) break;
		if (until && toISO(cur) > until.slice(0, 10)) break;
		if (cur.getTime() >= A.getTime()) res.push(toISO(cur));
		idx++;
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
export function recurrenceKind(rule: string | null | undefined): RecurrenceKind | null {
	return parseRecurrenceRule(rule)?.kind ?? null;
}

export interface ParsedRecurrence {
	kind: RecurrenceKind;
	/** weekly/biweekly/monthly-nth cílový den v týdnu (0–6). */
	weekday?: number;
	/** monthly-nth: -1 | 1..5. */
	nth?: number;
	/** monthly-day: 1..31. */
	day?: number;
	/** biweekly parita ISO týdne. */
	parity?: "even" | "odd";
	until?: string | null;
	count?: number | null;
	doneCount: number;
	showAll: boolean;
}

/** Posun kalendářního data bez závislosti na lokální zóně procesu. */
export function shiftCalendarDate(iso: string, days: number): string {
	const date = parseISO(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return toISO(date);
}

export function calendarDayDistance(fromISO: string, toISOValue: string): number {
	return Math.round((parseISO(toISOValue).getTime() - parseISO(fromISO).getTime()) / 86_400_000);
}

/** N-tý skutečný výskyt (0 = kotva); měsíční díry se do indexu nepočítají. */
export function recurrenceDateAtIndex(
	baseISO: string,
	rule: ParsedRecurrence,
	index: number,
): string | null {
	if (!Number.isInteger(index) || index < 0) return null;
	const anchor = seriesAnchor(parseISO(baseISO), rule.kind, rule.weekday, rule.parity);
	if (rule.kind !== "monthly-day" && rule.kind !== "monthly-nth") {
		const value = occurrenceAt(anchor, rule.kind, index, rule);
		return value ? toISO(value) : null;
	}
	let found = 0;
	for (let k = 0; k < 20_000; k++) {
		const value = occurrenceAt(anchor, rule.kind, k, rule);
		if (!value) continue;
		if (found === index) return toISO(value);
		found++;
	}
	return null;
}

/** Index platného výskytu v řadě; datum mimo řadu vrací null. */
export function recurrenceIndexOfDate(
	baseISO: string,
	rule: ParsedRecurrence,
	dateISO: string,
): number | null {
	const anchor = seriesAnchor(parseISO(baseISO), rule.kind, rule.weekday, rule.parity);
	const target = parseISO(dateISO);
	if (Number.isNaN(target.getTime()) || target < anchor) return null;
	const dayDiff = Math.round((target.getTime() - anchor.getTime()) / 86_400_000);
	if (rule.kind === "daily") return dayDiff;
	if (rule.kind === "weekly") return dayDiff % 7 === 0 ? dayDiff / 7 : null;
	if (rule.kind === "biweekly") return dayDiff % 14 === 0 ? dayDiff / 14 : null;

	let found = 0;
	for (let k = 0; k < 20_000; k++) {
		const value = occurrenceAt(anchor, rule.kind, k, rule);
		if (!value) continue;
		if (value.getTime() === target.getTime()) return found;
		if (value > target) return null;
		found++;
	}
	return null;
}

export function previousRecurrenceDate(
	baseISO: string,
	rule: ParsedRecurrence,
	dateISO: string,
): string | null {
	const index = recurrenceIndexOfDate(baseISO, rule, dateISO);
	return index !== null && index > 0 ? recurrenceDateAtIndex(baseISO, rule, index - 1) : null;
}

/**
 * Přenastaví kalendářní tvar řady podle cílového dne. Zachová neznámá kompatibilní
 * metadata, ale volitelně posune konec a přepočte počet zbylých aktivních výskytů.
 */
export function transformRecurrenceRule(
	ruleText: string,
	targetDate: string,
	options: { shiftUntilDays?: number; remainingCount?: number } = {},
): string | null {
	const parsed = parseRecurrenceRule(ruleText);
	if (!parsed) return null;
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(ruleText) as Record<string, unknown>;
	} catch {
		return null;
	}
	const target = parseISO(targetDate);
	if (Number.isNaN(target.getTime()) || toISO(target) !== targetDate) return null;
	if (parsed.kind === "weekly" || parsed.kind === "biweekly" || parsed.kind === "monthly-nth") {
		raw.weekday = target.getUTCDay();
	}
	if (parsed.kind === "biweekly") {
		raw.parity = isoWeek(target) % 2 === 0 ? "even" : "odd";
	}
	if (parsed.kind === "monthly-day") raw.day = target.getUTCDate();
	if (parsed.kind === "monthly-nth") {
		raw.nth =
			target.getUTCDate() + 7 > daysInMonth(target.getUTCFullYear(), target.getUTCMonth())
				? -1
				: Math.ceil(target.getUTCDate() / 7);
	}
	if (
		raw.endKind === "until" &&
		typeof raw.until === "string" &&
		options.shiftUntilDays
	) {
		raw.until = shiftCalendarDate(raw.until.slice(0, 10), options.shiftUntilDays);
	}
	if (options.remainingCount !== undefined) {
		if (!Number.isInteger(options.remainingCount) || options.remainingCount < 1) return null;
		raw.endKind = "count";
		raw.count = options.remainingCount;
		raw.doneCount = 0;
	}
	return JSON.stringify(raw);
}

/** Celé pravidlo opakování vč. strukturovaných polí, konce (endKind/until/count) a showAll. */
export function parseRecurrenceRule(rule: string | null | undefined): ParsedRecurrence | null {
	if (!rule) return null;
	try {
		const p = JSON.parse(rule) as Record<string, unknown>;
		if (typeof p.kind !== "string" || !recurrenceKinds.has(p.kind)) return null;
		const endKind = typeof p.endKind === "string" ? p.endKind : "never";
		return {
			kind: p.kind as RecurrenceKind,
			weekday: typeof p.weekday === "number" ? p.weekday : undefined,
			nth: typeof p.nth === "number" ? p.nth : undefined,
			day: typeof p.day === "number" ? p.day : undefined,
			parity: p.parity === "even" || p.parity === "odd" ? p.parity : undefined,
			until: endKind === "until" && typeof p.until === "string" ? p.until : null,
			count: endKind === "count" && typeof p.count === "number" ? p.count : null,
			doneCount: typeof p.doneCount === "number" ? p.doneCount : 0,
			showAll: p.showAll !== false,
		};
	} catch {
		return null;
	}
}
