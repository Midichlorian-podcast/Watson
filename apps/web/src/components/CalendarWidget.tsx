/**
 * Kalendářový widget Přehledu (feedback 2026-07-11) — měsíční mini-kalendář
 * ve stylu Apple: mřížka dní s tečkami podle náplně (červená = po termínu,
 * mosazná = otevřené úkoly, šedá = jen hotové), dnešek zvýrazněný, navigace
 * ‹ › + „Dnes". Klik na den otevře denní agendu NA MÍSTĚ (peek s odbavením
 * — zaškrtávání, detail, + úkol na den); plný pohled = Nadcházející.
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useMemo, useState } from "react";
import { todayISO } from "../lib/tasks";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

interface DayInfo {
	open: number;
	overdue: boolean;
	done: number;
}

export function CalendarWidget({ onDay }: { onDay: (dateISO: string) => void }) {
	const { t, i18n } = useTranslation();
	const tdy = todayISO();
	const [ym, setYm] = useState<{ y: number; m: number }>(() => {
		const d = new Date();
		return { y: d.getFullYear(), m: d.getMonth() };
	});

	const { data: rows } = usePsQuery<{
		d: string | null;
		completed_at: string | null;
	}>("SELECT substr(due_date, 1, 10) AS d, completed_at FROM tasks WHERE due_date IS NOT NULL");

	// agregace per den (jen zobrazený měsíc — mapa je malá)
	const byDay = useMemo(() => {
		const map = new Map<string, DayInfo>();
		for (const r of rows ?? []) {
			if (!r.d) continue;
			const s = map.get(r.d) ?? { open: 0, overdue: false, done: 0 };
			if (r.completed_at) s.done++;
			else {
				s.open++;
				if (r.d < tdy) s.overdue = true;
			}
			map.set(r.d, s);
		}
		return map;
	}, [rows, tdy]);

	// mřížka: pondělí první (evropský týden), 6 řádků × 7 dní
	const first = new Date(ym.y, ym.m, 1);
	const lead = (first.getDay() + 6) % 7;
	const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
	const cells: { day: number; inMonth: boolean; iso: string }[] = [];
	const prevDays = new Date(ym.y, ym.m, 0).getDate();
	for (let i = lead - 1; i >= 0; i--) {
		const d = prevDays - i;
		const pm = ym.m === 0 ? 11 : ym.m - 1;
		const py = ym.m === 0 ? ym.y - 1 : ym.y;
		cells.push({ day: d, inMonth: false, iso: iso(py, pm, d) });
	}
	for (let d = 1; d <= daysInMonth; d++)
		cells.push({ day: d, inMonth: true, iso: iso(ym.y, ym.m, d) });
	while (cells.length < 42) {
		const idx = cells.length - (lead + daysInMonth);
		const nm = ym.m === 11 ? 0 : ym.m + 1;
		const ny = ym.m === 11 ? ym.y + 1 : ym.y;
		cells.push({ day: idx + 1, inMonth: false, iso: iso(ny, nm, idx + 1) });
	}

	const monthLabel = new Intl.DateTimeFormat(i18n.language, {
		month: "long",
		year: "numeric",
	}).format(first);
	// iniciály dnů od pondělí (Intl narrow; 2026-06-01 = pondělí)
	const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key, i) => ({
		key,
		label: new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" }).format(
			new Date(2026, 5, 1 + i),
		),
	}));
	const shift = (dir: -1 | 1) =>
		setYm(({ y, m }) => {
			const nm = m + dir;
			return nm < 0 ? { y: y - 1, m: 11 } : nm > 11 ? { y: y + 1, m: 0 } : { y, m: nm };
		});
	const isCurrentMonth = ym.y === new Date().getFullYear() && ym.m === new Date().getMonth();

	return (
		<div style={{ padding: "4px 12px 12px" }}>
			{/* navigace měsíce */}
			<div className="flex items-center" style={{ gap: 6, padding: "2px 4px 8px" }}>
				<span
					className="font-display font-bold text-ink"
					style={{ fontSize: 12.5, flex: 1, textTransform: "capitalize" }}
				>
					{monthLabel}
				</span>
				{!isCurrentMonth && (
					<button
						type="button"
						onClick={() => {
							const d = new Date();
							setYm({ y: d.getFullYear(), m: d.getMonth() });
						}}
						aria-label={t("calendar.today")}
						className="rounded-md border border-line font-display font-semibold text-ink-3 hover:border-brass hover:text-brass-text"
						style={{ fontSize: 10, padding: "2px 8px" }}
					>
						{new Intl.DateTimeFormat(i18n.language, { day: "numeric" }).format(new Date())}.
					</button>
				)}
				<button
					type="button"
					onClick={() => shift(-1)}
					aria-label={t("calendar.prev")}
					className="grid place-items-center rounded-md border border-line text-ink-2 hover:border-brass"
					style={{ width: 22, height: 22, fontSize: 12 }}
				>
					‹
				</button>
				<button
					type="button"
					onClick={() => shift(1)}
					aria-label={t("calendar.next")}
					className="grid place-items-center rounded-md border border-line text-ink-2 hover:border-brass"
					style={{ width: 22, height: 22, fontSize: 12 }}
				>
					›
				</button>
			</div>

			{/* hlavička dnů */}
			<div
				className="grid font-mono text-ink-3"
				style={{ gridTemplateColumns: "repeat(7, 1fr)", fontSize: 9, textAlign: "center" }}
			>
				{weekdays.map((weekday) => (
					<span key={weekday.key} style={{ padding: "2px 0 4px" }}>
						{weekday.label}
					</span>
				))}
			</div>

			{/* dny */}
			<div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", rowGap: 2 }}>
				{cells.map((c) => {
					const info = byDay.get(c.iso);
					const isToday = c.iso === tdy;
					const dots: { key: string; bg: string }[] = [];
					if (info) {
						if (info.overdue) dots.push({ key: "overdue", bg: "var(--w-overdue)" });
						if (info.open > 0)
							for (let i = 0; i < Math.min(info.overdue ? 2 : 3, Math.ceil(info.open / 2)); i++)
								dots.push({ key: `open-${i}`, bg: "var(--w-brass)" });
						if (dots.length === 0 && info.done > 0)
							dots.push({ key: "done", bg: "var(--w-ink-3)" });
					}
					return (
						<button
							key={c.iso}
							type="button"
							onClick={() => onDay(c.iso)}
							className="flex flex-col items-center rounded-lg hover:bg-panel-2"
							style={{ padding: "3px 0 4px", gap: 2, opacity: c.inMonth ? 1 : 0.35 }}
						>
							<span
								className="grid place-items-center font-display font-semibold"
								style={{
									width: 22,
									height: 22,
									borderRadius: 999,
									fontSize: 11.5,
									background: isToday ? "var(--w-brass)" : "transparent",
									color: isToday ? "#fff" : "var(--w-ink)",
								}}
							>
								{c.day}
							</span>
							<span className="flex" style={{ gap: 2, height: 4 }}>
								{dots.slice(0, 3).map((dot) => (
									<span
										key={dot.key}
										style={{ width: 4, height: 4, borderRadius: 999, background: dot.bg }}
									/>
								))}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
