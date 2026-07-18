import { lazy, Suspense } from "react";
import type { TaskRow } from "../lib/powersync/AppSchema";
import type { CalendarRange } from "../lib/windowSurfaces";
import type { CalendarNavigationState } from "./Calendar";

/**
 * Calendar (2400+ řádků) je nejtěžší jednotlivá komponenta a zobrazuje se JEN v pohledu „Kalendář".
 * Lazy wrapper → chunk se stáhne až při přepnutí do kalendáře (ne v main bundlu core obrazovek).
 */
const CalendarInner = lazy(() => import("./Calendar").then((m) => ({ default: m.Calendar })));

export function Calendar({
	tasks,
	range,
	anchorDate,
	onNavigationChange,
}: {
	tasks: TaskRow[];
	range?: CalendarRange;
	anchorDate?: string;
	onNavigationChange?: (state: CalendarNavigationState) => void;
}) {
	return (
		<Suspense fallback={null}>
			<CalendarInner
				tasks={tasks}
				range={range}
				anchorDate={anchorDate}
				onNavigationChange={onNavigationChange}
			/>
		</Suspense>
	);
}
