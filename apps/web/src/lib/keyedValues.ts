/**
 * Produces deterministic React keys for value-only lists, including duplicate
 * values, without coupling component identity to the array position.
 */
export function keyedValues<T>(values: readonly T[], identity: (value: T) => string) {
	const occurrences = new Map<string, number>();
	return values.map((value) => {
		const base = identity(value);
		const occurrence = occurrences.get(base) ?? 0;
		occurrences.set(base, occurrence + 1);
		return { key: `${base}\u0000${occurrence}`, value };
	});
}
