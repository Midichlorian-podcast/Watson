/** Zpětně kompatibilní import; occurrence engine sdílí klient i serverové commandy. */

export type { ExpandOpts, ParsedRecurrence, RecurrenceKind } from "@watson/shared";
export {
	expandOccurrences,
	isOccId,
	occId,
	parseOccId,
	parseRecurrenceRule,
	recurrenceKind,
} from "@watson/shared";
