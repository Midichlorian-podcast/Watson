export type MentionMatch = { start: number; end: number; query: string };

/** Poslední rozepsaná @zmínka u kurzoru. @ uprostřed e-mailu se za zmínku nepovažuje. */
export function mentionMatchAt(value: string, cursor = value.length): MentionMatch | null {
	const before = value.slice(0, cursor);
	const start = before.lastIndexOf("@");
	if (start < 0) return null;
	if (start > 0 && !/[\s([]/.test(before[start - 1] ?? "")) return null;
	const query = before.slice(start + 1);
	if (query.includes("\n") || query.length > 60 || /[,:;!?()[\]{}]/.test(query)) return null;
	return { start, end: cursor, query: query.trimStart() };
}

export function insertMentionToken(
	value: string,
	match: MentionMatch,
	name: string,
): { value: string; cursor: number } {
	const token = `@${name} `;
	const next = `${value.slice(0, match.start)}${token}${value.slice(match.end)}`;
	return { value: next, cursor: match.start + token.length };
}

export function selectedMentionIds(
	body: string,
	selectedIds: Iterable<string>,
	members: { id: string; name: string }[],
): string[] {
	const selected = new Set(selectedIds);
	return members
		.filter((member) => selected.has(member.id) && body.includes(`@${member.name}`))
		.map((member) => member.id);
}
