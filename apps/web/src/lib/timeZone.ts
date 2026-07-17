/**
 * Zpětně kompatibilní webový import. Výpočet žije ve sdíleném balíčku, aby klient,
 * API preview i serverová mutace používaly přesně stejnou DST politiku.
 */
export {
	dateInTimeZone,
	deviceTimeZone,
	isValidTimeZone,
	minutesInTimeZone,
	nextValidZonedDateTimeToIso,
	wallTimeFromInstant,
	zonedDateTimeToIso,
} from "@watson/shared";
