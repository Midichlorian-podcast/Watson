import { lazy, Suspense } from "react";
import type { TaskRow } from "../lib/powersync/AppSchema";

/**
 * Calendar (2400+ řádků) je nejtěžší jednotlivá komponenta a zobrazuje se JEN v pohledu „Kalendář".
 * Lazy wrapper → chunk se stáhne až při přepnutí do kalendáře (ne v main bundlu core obrazovek).
 */
const CalendarInner = lazy(() =>
	import("./Calendar").then((m) => ({ default: m.Calendar })),
);

export function Calendar({ tasks }: { tasks: TaskRow[] }) {
	return (
		<Suspense fallback={null}>
			<CalendarInner tasks={tasks} />
		</Suspense>
	);
}
