export type SearchKind =
	| "task"
	| "project"
	| "person"
	| "flow"
	| "goal"
	| "list"
	| "meeting"
	| "mail"
	| "contact";

export type SearchScope = "all" | SearchKind;

export interface ParsedSearchQuery {
	terms: string[];
	types: SearchKind[];
	workspaces: string[];
	statuses: string[];
	from: string[];
	before: string | null;
	after: string | null;
}

export interface SearchCandidate<T> {
	id: string;
	kind: SearchKind;
	title: string;
	fields?: Array<string | null | undefined>;
	workspace?: string | null;
	status?: string | null;
	date?: string | null;
	from?: Array<string | null | undefined>;
	value: T;
}

export interface RankedSearchResult<T> extends SearchCandidate<T> {
	score: number;
}

const TYPE_ALIASES: Record<string, SearchKind> = {
	task: "task",
	tasks: "task",
	ukol: "task",
	ukoly: "task",
	project: "project",
	projects: "project",
	projekt: "project",
	projekty: "project",
	person: "person",
	people: "person",
	clovek: "person",
	lide: "person",
	flow: "flow",
	flows: "flow",
	postup: "flow",
	postupy: "flow",
	goal: "goal",
	goals: "goal",
	cil: "goal",
	cile: "goal",
	list: "list",
	lists: "list",
	seznam: "list",
	seznamy: "list",
	meeting: "meeting",
	meetings: "meeting",
	meet: "meeting",
	porada: "meeting",
	porady: "meeting",
	mail: "mail",
	email: "mail",
	posta: "mail",
	contact: "contact",
	contacts: "contact",
	kontakt: "contact",
	kontakty: "contact",
};

const OPERATOR_ALIASES: Record<string, keyof Omit<ParsedSearchQuery, "terms">> = {
	type: "types",
	typ: "types",
	in: "workspaces",
	prostor: "workspaces",
	status: "statuses",
	stav: "statuses",
	from: "from",
	od: "from",
	before: "before",
	pred: "before",
	after: "after",
	po: "after",
};

export function normalizeSearchText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase()
		.trim();
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
	const parsed: ParsedSearchQuery = {
		terms: [],
		types: [],
		workspaces: [],
		statuses: [],
		from: [],
		before: null,
		after: null,
	};
	const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	for (const rawToken of tokens) {
		const token = rawToken.startsWith('"') && rawToken.endsWith('"') ? rawToken.slice(1, -1) : rawToken;
		const colon = token.indexOf(":");
		if (colon <= 0 || colon === token.length - 1) {
			const term = normalizeSearchText(token);
			if (term) parsed.terms.push(term);
			continue;
		}
		const rawKey = normalizeSearchText(token.slice(0, colon));
		const key = OPERATOR_ALIASES[rawKey];
		if (!key) {
			parsed.terms.push(normalizeSearchText(token));
			continue;
		}
		const rawValue = token.slice(colon + 1);
		const unquotedValue =
			rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
		const values = unquotedValue
			.split(",")
			.map(normalizeSearchText)
			.filter(Boolean);
		if (key === "types") {
			for (const value of values) {
				const kind = TYPE_ALIASES[value];
				if (kind) parsed.types.push(kind);
			}
		} else if (key === "before" || key === "after") {
			const value = values[0];
			if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed[key] = value;
		} else {
			parsed[key].push(...values);
		}
	}
	parsed.terms = unique(parsed.terms);
	parsed.types = [...new Set(parsed.types)];
	parsed.workspaces = unique(parsed.workspaces);
	parsed.statuses = unique(parsed.statuses);
	parsed.from = unique(parsed.from);
	return parsed;
}

const statusMatches = (status: string, wanted: string) => {
	if (["open", "otevrene", "otevreny"].includes(wanted))
		return [
			"open",
			"active",
			"running",
			"planned",
			"probiha",
			"kontrola",
			"nezahajeno",
			"novy",
			"otevreny",
			"ceka",
			"odeslano",
		].includes(status);
	if (["done", "hotovo", "completed"].includes(wanted))
		return ["done", "completed", "committed", "hotovo"].includes(status);
	return status.includes(wanted);
};

function textScore(title: string, fields: string[], terms: string[]): number | null {
	if (terms.length === 0) return 1;
	const haystack = [title, ...fields].join(" \n ");
	let score = 0;
	for (const term of terms) {
		if (!haystack.includes(term)) return null;
		if (title === term) score += 120;
		else if (title.startsWith(term)) score += 80;
		else if (title.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(term))) score += 48;
		else if (title.includes(term)) score += 34;
		else score += 12;
	}
	return score;
}

export function rankSearchCandidates<T>(
	candidates: SearchCandidate<T>[],
	query: ParsedSearchQuery,
	scope: SearchScope = "all",
): RankedSearchResult<T>[] {
	const ranked: RankedSearchResult<T>[] = [];
	for (const candidate of candidates) {
		if (scope !== "all" && candidate.kind !== scope) continue;
		if (query.types.length > 0 && !query.types.includes(candidate.kind)) continue;
		const workspace = normalizeSearchText(candidate.workspace ?? "");
		if (query.workspaces.some((wanted) => !workspace.includes(wanted))) continue;
		const status = normalizeSearchText(candidate.status ?? "");
		if (query.statuses.length > 0 && !query.statuses.some((wanted) => statusMatches(status, wanted)))
			continue;
		const senders = (candidate.from ?? []).map((value) => normalizeSearchText(value ?? ""));
		if (query.from.some((wanted) => !senders.some((sender) => sender.includes(wanted)))) continue;
		const date = candidate.date?.slice(0, 10) ?? null;
		if (query.before && (!date || date >= query.before)) continue;
		if (query.after && (!date || date <= query.after)) continue;
		const title = normalizeSearchText(candidate.title);
		const fields = (candidate.fields ?? []).map((value) => normalizeSearchText(value ?? ""));
		const score = textScore(title, fields, query.terms);
		if (score === null) continue;
		ranked.push({ ...candidate, score });
	}
	return ranked.sort(
		(left, right) =>
			right.score - left.score ||
			left.title.localeCompare(right.title, "cs") ||
			left.id.localeCompare(right.id),
	);
}
