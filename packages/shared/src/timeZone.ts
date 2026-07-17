/** Bezpečný fallback pro starší nebo hardened runtimy bez rozpoznané IANA zóny. */
export function deviceTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Prague";
	} catch {
		return "Europe/Prague";
	}
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone }).format(0);
		return true;
	} catch {
		return false;
	}
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number };

function wallParts(instantMs: number, timeZone: string): WallParts | null {
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(new Date(instantMs));
		const get = (type: "year" | "month" | "day" | "hour" | "minute") =>
			Number(parts.find((part) => part.type === type)?.value);
		const result = {
			year: get("year"),
			month: get("month"),
			day: get("day"),
			hour: get("hour"),
			minute: get("minute"),
		};
		return Object.values(result).every(Number.isFinite) ? result : null;
	} catch {
		return null;
	}
}

/**
 * Převod lokálního kalendářního času v konkrétní IANA zóně na skutečný UTC instant.
 * Neexistující čas při jarním DST skoku vrací null místo tichého posunu o hodinu.
 */
export function zonedDateTimeToIso(
	date: string,
	time: string,
	timeZone: string,
): string | null {
	const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
	if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) return null;
	const desired = {
		year: Number(dateMatch[1]),
		month: Number(dateMatch[2]),
		day: Number(dateMatch[3]),
		hour: Number(timeMatch[1]),
		minute: Number(timeMatch[2]),
	};
	if (
		desired.month < 1 ||
		desired.month > 12 ||
		desired.day < 1 ||
		desired.day > 31 ||
		desired.hour > 23 ||
		desired.minute > 59
	) return null;
	const second = Number(timeMatch[3] ?? 0);
	const naive = Date.UTC(
		desired.year,
		desired.month - 1,
		desired.day,
		desired.hour,
		desired.minute,
		second,
	);
	// Offset před a po přechodu se může lišit. Oba kandidáty výslovně ověříme;
	// při podzimní dvojznačnosti volíme deterministicky dřívější instant (Temporal
	// disambiguation="compatible"). Při jarní mezeře nevyhoví žádný kandidát.
	const offsets = new Set<number>();
	for (const deltaHours of [-36, -12, 0, 12, 36]) {
		const sample = naive + deltaHours * 3_600_000;
		const observed = wallParts(sample, timeZone);
		if (!observed) return null;
		const observedAsUtc = Date.UTC(
			observed.year,
			observed.month - 1,
			observed.day,
			observed.hour,
			observed.minute,
			new Date(sample).getUTCSeconds(),
		);
		offsets.add(observedAsUtc - sample);
	}
	const matches = [...offsets]
		.map((offset) => naive - offset)
		.filter((candidate) => {
			const verify = wallParts(candidate, timeZone);
			return (
				!!verify &&
				Object.keys(desired).every(
					(key) => verify[key as keyof WallParts] === desired[key as keyof WallParts],
				)
			);
		})
		.sort((a, b) => a - b);
	return matches[0] === undefined ? null : new Date(matches[0]).toISOString();
}

export function minutesInTimeZone(
	instant: string,
	timeZone: string | null | undefined,
): number | null {
	if (!timeZone || !isValidTimeZone(timeZone)) return null;
	const ms = new Date(instant).getTime();
	if (Number.isNaN(ms)) return null;
	const parts = wallParts(ms, timeZone);
	return parts ? parts.hour * 60 + parts.minute : null;
}

export function wallTimeFromInstant(instant: string, timeZone: string): string | null {
	const minutes = minutesInTimeZone(instant, timeZone);
	if (minutes === null) return null;
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
}

export function dateInTimeZone(timeZone: string, instant = new Date()): string {
	const parts = wallParts(instant.getTime(), timeZone);
	if (!parts) {
		return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, "0")}-${String(
			instant.getDate(),
		).padStart(2, "0")}`;
	}
	return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Pro automatický posun opakování přes jarní DST mezeru; ruční vstup zůstává striktní. */
export function nextValidZonedDateTimeToIso(
	date: string,
	time: string,
	timeZone: string,
	maxMinutes = 180,
): string | null {
	const exact = zonedDateTimeToIso(date, time, timeZone);
	if (exact) return exact;
	const match = /^(\d{2}):(\d{2})/.exec(time);
	if (!match) return null;
	const baseMinutes = Number(match[1]) * 60 + Number(match[2]);
	for (let delta = 1; delta <= maxMinutes; delta++) {
		const total = baseMinutes + delta;
		if (total >= 24 * 60) break;
		const candidate = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
			total % 60,
		).padStart(2, "0")}:00`;
		const instant = zonedDateTimeToIso(date, candidate, timeZone);
		if (instant) return instant;
	}
	return null;
}
