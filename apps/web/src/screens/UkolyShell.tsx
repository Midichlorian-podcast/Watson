import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { useMemo } from "react";
import { inboxProjectIds } from "../lib/inbox";
import { useProjects } from "../lib/projects";
import { todayISO } from "../lib/tasks";
import { parseTaskTab, type TaskTab } from "../lib/taskTabs";
import { DnesTab } from "./Today";
import { VseTab, ZasobnikTab } from "./Ukoly";

/**
 * Sloučený modul „Úkoly" se záložkami Dnes · Vše · Zásobník (jeden URL prostor):
 * - `/` = Dnes (denní závazek), `/ukoly` = Vše (inventář), `/ukoly?tab=zasobnik` = Zásobník.
 * - `?tab=dnes|vse|zasobnik` řídí aktivní záložku; default se liší dle domovské routy.
 * - `?projekt=` (drill-down projektu) = fokusovaný pohled BEZ záložek (má vlastní baner).
 */
export function UkolyShell({ defaultTab }: { defaultTab: TaskTab }) {
	const search = useSearch({ strict: false }) as { tab?: string; projekt?: string };
	// Projektový drill-down = fokusovaný pohled bez záložek (VseTab si projekt čte sám ze search).
	if (search.projekt) return <VseTab />;
	const tab = parseTaskTab(search.tab) ?? defaultTab;
	return (
		<>
			<TaskViewTabs active={tab} />
			{tab === "dnes" ? <DnesTab /> : tab === "zasobnik" ? <ZasobnikTab /> : <VseTab />}
		</>
	);
}

/** Záložky modulu Úkoly + akční počty (Dnes = dnes+zpožděné bez nedatovaných; Zásobník = nedatované). */
function TaskViewTabs({ active }: { active: TaskTab }) {
	const { t } = useTranslation();
	const projects = useProjects();
	const { data: rows } = usePsQuery<{
		project_id: string | null;
		due_date: string | null;
		parent_id: string | null;
		kind: string | null;
	}>(
		// Dnes = denní agenda (porady ZAPOČÍTÁVÁ — seznam je ukazuje, badge musí sedět
		// s řádky); Zásobník je nedatovaný a porady mají termín vždy → filtr netřeba.
		"SELECT project_id, due_date, parent_id, kind FROM tasks WHERE completed_at IS NULL",
	);

	const { dnes, zasobnik } = useMemo(() => {
		const inbox = inboxProjectIds(projects);
		const today = todayISO();
		// Stejné pravidlo viditelnosti jako obrazovky/Sidebar (podúkoly + bez netriážované Schránky).
		const inboxTask = (r: { project_id: string | null; due_date: string | null }) =>
			!r.due_date && !!r.project_id && inbox.has(r.project_id);
		const visible = (rows ?? []).filter((r) => (!r.parent_id || r.due_date) && !inboxTask(r));
		return {
			dnes: visible.filter((r) => {
				const dd = r.due_date ? r.due_date.slice(0, 10) : null;
				if (dd == null) return false;
				// porada jen ve svůj den — po něm není „zpožděná" položka agendy (hlásí ji Meets)
				return r.kind === "meeting" ? dd === today : dd <= today;
			}).length,
			zasobnik: visible.filter((r) => !r.due_date).length,
		};
	}, [rows, projects]);

	const pill = (on: boolean) =>
		({
			fontSize: 12.5,
			padding: "6px 12px",
			borderRadius: 8,
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			background: on ? "var(--w-brass-soft)" : "transparent",
			color: on ? "var(--w-brass-text)" : "var(--w-ink-3)",
		}) as const;

	const badge = (n: number) => (
		<span className="font-mono" style={{ fontSize: 10.5 }}>
			{n > 99 ? "99+" : n}
		</span>
	);

	return (
		<div
			className="flex items-center border-line border-b bg-card"
			style={{ gap: 4, padding: "6px 14px", flex: "none" }}
		>
			<Link
				to="/"
				search={{}}
				className="font-display font-semibold"
				style={pill(active === "dnes")}
			>
				{t("tasks.tabToday")}
				{dnes > 0 && badge(dnes)}
			</Link>
			<Link
				to="/ukoly"
				search={{}}
				className="font-display font-semibold"
				style={pill(active === "vse")}
			>
				{t("tasks.tabAll")}
			</Link>
			<Link
				to="/ukoly"
				search={{ tab: "zasobnik" }}
				className="font-display font-semibold"
				style={pill(active === "zasobnik")}
			>
				{t("tasks.tabBacklog")}
				{zasobnik > 0 && badge(zasobnik)}
			</Link>
		</div>
	);
}
