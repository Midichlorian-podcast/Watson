/**
 * Quick-add parser — kontrakt (produkční přepis prototypu).
 * Spec: files/logika/01-parser-quickadd.md. Čisté funkce, testovatelné, řízené `today`.
 */

export type Priority = 1 | 2 | 3 | 4;
/** Den v týdnu dle JS getDay: neděle=0 … sobota=6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type HighlightKind =
	| "priority"
	| "time"
	| "duration"
	| "date"
	| "deadline"
	| "repeat"
	| "proj"
	| "person";

/** Rozsah rozpoznaného tokenu v původním textu (rawName) — pro overlay zvýraznění. */
export interface Highlight {
	start: number;
	end: number;
	kind: HighlightKind;
}

export type RecurrenceKind =
	| "daily"
	| "weekly"
	| "biweekly"
	| "monthly"
	| "yearly"
	| "monthly-nth"
	| "monthly-day";

export interface RecurrenceRule {
	kind: RecurrenceKind;
	/** weekly / biweekly / monthly-nth */
	weekday?: Weekday;
	/** monthly-nth: -1 = poslední, 1..5 = první..páté */
	nth?: number;
	/** monthly-day: 1..31 */
	day?: number;
	/** biweekly: sudý/lichý ISO týden */
	parity?: "even" | "odd";
	/** Český label do UI (např. „Každou středu"). */
	label: string;
}

export interface ParseCtx {
	/** Reálný „dnešek" YYYY-MM-DD (nahrazuje fixní recBase prototypu). */
	today: string;
	/** Kandidáti projektů (pro exact-match `#X`). */
	projects: { id: string; name: string }[];
	/** Kandidáti osob (pro autocomplete `@X`/`+X` — řeší UI, ne parser). */
	people?: { id: string; name: string; initials: string }[];
}

/**
 * Výstup parseru. Pole jsou `undefined`, pokud nebyl rozpoznán odpovídající token
 * (caller pak aplikuje defaulty — např. priorita P2 dle designu).
 */
export interface ParsedDraft {
	/** Vyčištěný název (rozpoznané tokeny + `@`/`+` osoby odebrané). */
	name: string;
	/** Původní text (pro overlay zvýraznění). */
	rawName: string;
	priority?: Priority;
	/** Pracovní termín YYYY-MM-DD (z data / relativního / holého dne / startu opakování). */
	due?: string;
	/** Deadline YYYY-MM-DD (z `!d. m.`). */
	deadline?: string;
	/** Čas dne v minutách od půlnoci. */
	startMin?: number;
	durationMin?: number;
	/** Vícedenní rozsah (1–60), nastaveno jen když > 1. */
	days?: number;
	recurrence?: RecurrenceRule;
	/** Jen přesná shoda názvu projektu; fuzzy našeptávač řeší UI. */
	projectId?: string;
	/** `@X`/`+X` query stringy (neresolvované; autocomplete řeší UI). */
	personQueries?: string[];
	highlights: Highlight[];
}
