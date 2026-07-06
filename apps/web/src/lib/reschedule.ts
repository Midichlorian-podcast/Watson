/**
 * Cíle přeplánování úkolů (prototyp „Přeplánovat" — víc než jen „na dnes").
 * Vrací ISO den (YYYY-MM-DD) nebo null pro neplatné.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) =>
	`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const base = () => {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
};

export type RescheduleKey =
	| "today"
	| "tomorrow"
	| "weekend"
	| "nextMonday"
	| "inWeek"
	| "nextMonth";

export function rescheduleDate(key: RescheduleKey): string {
	const d = base();
	switch (key) {
		case "today":
			break;
		case "tomorrow":
			d.setDate(d.getDate() + 1);
			break;
		case "weekend": {
			// nejbližší sobota (dnes = So → dnes; Ne → +6 na příští So)
			const delta = (6 - d.getDay() + 7) % 7;
			d.setDate(d.getDate() + delta);
			break;
		}
		case "nextMonday": {
			// nejbližší pondělí, vždy alespoň zítra
			const delta = (1 - d.getDay() + 7) % 7 || 7;
			d.setDate(d.getDate() + delta);
			break;
		}
		case "inWeek":
			d.setDate(d.getDate() + 7);
			break;
		case "nextMonth":
			d.setMonth(d.getMonth() + 1, 1);
			break;
	}
	return iso(d);
}

/** Pořadí + i18n klíče voleb menu (bez „today" — to je triviální). */
export const RESCHEDULE_OPTIONS: { key: RescheduleKey; labelKey: string }[] = [
	{ key: "tomorrow", labelKey: "reschedule.tomorrow" },
	{ key: "weekend", labelKey: "reschedule.weekend" },
	{ key: "nextMonday", labelKey: "reschedule.nextMonday" },
	{ key: "inWeek", labelKey: "reschedule.inWeek" },
	{ key: "nextMonth", labelKey: "reschedule.nextMonth" },
];
