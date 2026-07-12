import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import { QuickAdd } from "../components/QuickAdd";
import { RescheduleMenu } from "../components/RescheduleMenu";
import { TaskItem } from "../components/TaskItem";
import {
	DEFAULT_TOOLBAR,
	filterTasks,
	sortTasks,
	TasksToolbar,
	type ToolbarState,
	useToolbarCtx,
} from "../components/TasksToolbar";
import { WorkspaceChips } from "../components/WorkspaceChips";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useFlowSteps } from "../lib/flowSteps";
import { inboxProjectIds, isInboxTask, pickInboxId } from "../lib/inbox";
import { useKbNav } from "../lib/kbNav";
import { filterByQuery, useListSearch } from "../lib/listSearch";
import { expandOccurrences, parseRecurrenceRule } from "../lib/occurrences";
import type { ProjectRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { showToast } from "../lib/toast";
import { pushUndo } from "../lib/undo";
import { useIsMobile } from "../lib/useIsMobile";
import { useWatson } from "../lib/watson";
import { useWorkspace } from "../lib/workspace";

type Member = { id: string; name: string };

// Lokální „dnešek" (ne UTC!) — jinak mezi půlnocí a ~02:00 v ČR spadne na včerejšek a úkoly
// s dnešním termínem zmizí z Dnes (nespadnou ani do „Zpožděné", ani do „Dnes"). Sjednoceno s lib/tasks.
const pad2 = (n: number) => String(n).padStart(2, "0");
const todayISO = () => {
	const d = new Date();
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const dayOf = (x: TaskRow) => (x.due_date ? x.due_date.slice(0, 10) : null);
const plusDays = (iso: string, n: number) => {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Dnes — 1:1 dle Cloud Design: Watson strip (brass-soft) + workspace kontext + skupiny
 * „Zpožděné" (s akcí Přeplánovat) a „{datum} · Dnes · {den}". Karty = sdílený TaskCard řádek.
 *
 * Záložka „Dnes" sloučeného modulu Úkoly (UkolyShell). Denní ZÁVAZEK = zpožděné + dnešní,
 * BEZ nedatovaných (ty žijí v záložce Zásobník, ať Dnes nesoutěží se skladem úkolů).
 */
export function DnesTab() {
	const { t, i18n } = useTranslation();
	const { data: session } = useSession();
	const { toggleWatson } = useWatson();
	const isMobile = useIsMobile();

	const projects = useProjects();
	const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);

	const [tb, setTb] = useState<ToolbarState>(DEFAULT_TOOLBAR);
	// Výkon: v běžném případě (bez „Dokončené") filtruj hotové rovnou v SQL — méně řádků materializuje
	// se přes WASM bridge při KAŽDÉ změně tabulky. Zapnutí „Dokončené" se re-subscribne na plný dotaz.
	const { data: tasks } = usePsQuery<TaskRow>(
		tb.showDone
			? "SELECT * FROM tasks ORDER BY priority, due_date IS NULL, due_date, created_at DESC"
			: "SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY priority, due_date IS NULL, due_date, created_at DESC",
	);
	const [wsFilter, setWsFilter] = useState<string | null>(null);
	const { q: searchQ } = useListSearch();
	const flowSteps = useFlowSteps();
	const navigate = useNavigate();
	const userId = session?.user?.id;
	const { activeWs } = useWorkspace();
	const inboxId = useMemo(() => pickInboxId(projects, activeWs), [projects, activeWs]);
	const { data: allAsg } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments ORDER BY created_at");
	const { data: allSteps } = usePsQuery<{
		chain_id: string | null;
		task_id: string | null;
		position: number | null;
	}>("SELECT chain_id, task_id, position FROM chain_steps ORDER BY position");
	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as Member[];
		},
	});

	const tbCtx = useToolbarCtx();
	const g = useMemo(() => {
		const tdy = todayISO();
		const all = tasks ?? [];
		const inboxIds = inboxProjectIds(projects);
		// Spící kroky postupů se v Dnes nezobrazují (README ř. 73) + filtr dle workspace chipů.
		// Podúkoly jen s VLASTNÍM termínem; netriážovaná Schránka do Dnes nepatří (prototyp inbox).
		const awake = all.filter((x) => {
			if (isInboxTask(x, inboxIds)) return false;
			if (x.parent_id && !x.due_date) return false;
			const fs = flowSteps.get(x.id);
			if (fs && (fs.state === "dormant" || fs.state === "waiting")) return false;
			if (wsFilter) {
				const p = x.project_id ? projMap.get(x.project_id) : undefined;
				if (p?.workspace_id !== wsFilter) return false;
			}
			return true;
		});
		// Projekce opakování: base s minulým termínem, jehož dnešek JE výskyt, patří do Dnes
		// (ne do Zpožděných); s budoucím výskytem do Dnes nepatří vůbec (prototyp occurrences).
		const projected: TaskRow[] = [];
		for (const x of awake) {
			const rule = parseRecurrenceRule(x.recurrence_rule);
			const d = dayOf(x);
			if (rule && d && d < tdy && !x.completed_at) {
				const [next] = expandOccurrences({
					baseISO: d,
					kind: rule.kind,
					weekday: rule.weekday,
					nth: rule.nth,
					day: rule.day,
					parity: rule.parity,
					fromISO: tdy,
					toISO: plusDays(tdy, 800),
					cap: 1,
					until: rule.until,
					count: rule.count,
					doneCount: rule.doneCount,
				});
				if (next === tdy) {
					projected.push({
						...x,
						due_date: x.due_date && x.due_date.length > 10 ? tdy + x.due_date.slice(10) : tdy,
					});
				} else if (!next) {
					projected.push(x);
				}
				continue;
			}
			projected.push(x);
		}
		const opn = filterByQuery(sortTasks(filterTasks(projected, tb, tbCtx), tb, tbCtx), searchQ);
		return {
			overdue: opn.filter((x) => {
				const d = dayOf(x);
				return !x.completed_at && d !== null && d < tdy;
			}),
			// Nedatované (d === null) do Dnes NEpatří — přesunuly se do záložky Zásobník (triage).
			// Dnes = jen skutečný dnešek + dnes dokončené zpožděné (ať sekce nezmizí hned po odškrtnutí).
			today: opn.filter((x) => {
				const d = dayOf(x);
				return d === tdy || (!!x.completed_at && d !== null && d < tdy);
			}),
		};
	}, [tasks, tb, tbCtx, flowSteps, wsFilter, projMap, projects, searchQ]);

	// Pořadí pro ↑/↓ v detailu (prototyp _navIds) + kbsel navigace.
	const flatList = useMemo(() => [...g.overdue, ...g.today], [g.overdue, g.today]);
	const { setNavIds } = useTaskDetail();
	useEffect(() => {
		setNavIds(flatList.map((x) => x.id));
	}, [flatList, setNavIds]);
	const kbSel = useKbNav(flatList, true);

	/** „Tvůj další krok v postupech" — VŠECHNY aktivní kroky přiřazené mně (prototyp myFlowSteps, ř. 396–406). */
	const myFlowSteps = useMemo(() => {
		const mine = new Set((allAsg ?? []).filter((a) => a.user_id === userId).map((a) => a.task_id));
		const asgFirst = new Map<string, string>();
		for (const a of allAsg ?? []) {
			if (a.task_id && a.user_id && !asgFirst.has(a.task_id)) asgFirst.set(a.task_id, a.user_id);
		}
		const nameOf = new Map((team ?? []).map((m) => [m.id, m.name] as const));
		const byChain = new Map<string, { task_id: string | null; position: number | null }[]>();
		for (const s of allSteps ?? []) {
			if (!s.chain_id) continue;
			const arr = byChain.get(s.chain_id) ?? [];
			arr.push(s);
			byChain.set(s.chain_id, arr);
		}
		const out: {
			task: TaskRow;
			fs: NonNullable<ReturnType<typeof flowSteps.get>>;
			blocking?: string;
		}[] = [];
		for (const tk of tasks ?? []) {
			if (tk.completed_at || !mine.has(tk.id)) continue;
			const fs = flowSteps.get(tk.id);
			if (fs?.state !== "active") continue;
			// „pak předáš → {jméno}" = přiřazený člověk NÁSLEDUJÍCÍHO kroku (prototyp f.blocking).
			const next = (byChain.get(fs.chainId) ?? []).find(
				(s) => (s.position ?? 0) + 1 === fs.pos + 1,
			);
			const nextUid = next?.task_id ? asgFirst.get(next.task_id) : undefined;
			out.push({
				task: tk,
				fs,
				blocking: nextUid ? nameOf.get(nextUid) : undefined,
			});
		}
		return out;
	}, [tasks, allAsg, allSteps, team, flowSteps, userId]);

	// Přeplánování zpožděných na zvolený den (menu: zítra/víkend/příští pondělí/za týden/…).
	async function rescheduleOverdue(targetIso: string) {
		// R4: opakované úkoly hromadně NEpřeplánovávat — přepsalo by kotvu CELÉ řady bez dotazu
		// „tento / tento a další / celá řada" (stejně jako BulkBar/TaskItem). Řadu uživatel upraví v detailu.
		const movable = g.overdue.filter((tk) => !tk.recurrence_rule);
		const skipped = g.overdue.length - movable.length;
		// Datum-only (bez natvrdo 09:00), konzistentní se zbytkem appky (siblings přes rescheduleDate).
		const moved = movable.map((tk) => ({ id: tk.id, prev: tk.due_date }));
		const apply = (to: (m: { id: string; prev: string | null }) => string | null) => () =>
			// Lokální atomicita: hromadné přeplánování zpožděných v jedné transakci.
			powerSync.writeTransaction(async (tx) => {
				for (const m of moved) {
					await tx.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [to(m), m.id]);
				}
			});
		if (moved.length) {
			await apply(() => targetIso)();
			pushUndo({ undo: apply((m) => m.prev), redo: apply(() => targetIso) });
		}
		showToast(
			[
				...(moved.length ? [t("today.rescheduledToast", { count: moved.length })] : []),
				...(skipped ? [t("bulk.recurringSkipped", { count: skipped })] : []),
			].join(" · "),
		);
	}

	const hour = new Date().getHours();
	const greeting =
		hour < 11 ? t("today.morning") : hour < 18 ? t("today.afternoon") : t("today.evening");
	const firstName = session?.user?.name?.split(" ")[0] ?? "";
	const greet = `${greeting}${firstName ? `, ${firstName}` : ""}. ${t("today.summaryToday", {
		count: g.today.length,
	})}${g.overdue.length > 0 ? ` · ${t("today.summaryOverdue", { count: g.overdue.length })}` : ""}`;

	const dateLabel = `${new Intl.DateTimeFormat(i18n.language, {
		day: "numeric",
		month: "long",
	}).format(
		new Date(),
	)} · ${t("nav.today")} · ${new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(new Date())}`;

	const card = (task: TaskRow) => {
		const p = task.project_id ? projMap.get(task.project_id) : undefined;
		return (
			<div
				key={task.id}
				data-kbsel={kbSel === task.id || undefined}
				className="rounded-xl"
				style={
					kbSel === task.id ? { outline: "2px solid var(--w-brass)", outlineOffset: -1 } : undefined
				}
			>
				<TaskItem
					task={task}
					project={p ? { name: p.name, color: p.color, workspace_id: p.workspace_id } : undefined}
					flow={flowSteps.get(task.id)}
				/>
			</div>
		);
	};

	return (
		<>
			{/* WATSON strip — na mobilu skrytý (prototyp showWatsonStrip, ř. 3243) */}
			{!isMobile && (
				<div
					className="flex items-center gap-2.5 border-line border-b"
					style={{ padding: "10px 20px", background: "var(--w-brass-soft)" }}
				>
					<span
						className="shrink-0 rounded-full"
						style={{ width: 6, height: 6, background: "var(--w-brass)" }}
					/>
					<span
						className="shrink-0 font-display font-bold text-brass-text"
						style={{ fontSize: 11.5, letterSpacing: ".04em" }}
					>
						WATSON
					</span>
					<span className="min-w-0 flex-1 truncate font-body text-ink-2" style={{ fontSize: 13 }}>
						{greet}
					</span>
					{g.overdue.length > 0 && (
						<div className="shrink-0">
							<RescheduleMenu
								anchor={t("today.rescheduleOverdue")}
								onPick={(d) => void rescheduleOverdue(d)}
							/>
						</div>
					)}
					<button
						type="button"
						onClick={toggleWatson}
						className="shrink-0 font-display font-semibold text-ink-3 hover:text-brass-text"
						style={{ fontSize: 12 }}
					>
						{t("today.watsonMore")}
					</button>
				</div>
			)}

			<div className="mx-auto max-w-[1080px]" style={{ padding: "12px 22px 90px" }}>
				{/* Workspace chipy Vše/Moje/… (prototyp ř. 342–346) */}
				<WorkspaceChips value={wsFilter} onChange={setWsFilter} />

				{/* toolbar hned pod ws chipy (prototyp ř. 348) */}
				<TasksToolbar state={tb} onChange={setTb} ctx={tbCtx} />

				{/* Chytré přidání úkolu (parser, #7) */}
				<QuickAdd
					projects={projects.map((p: ProjectRow) => ({
						id: p.id,
						name: p.name ?? "",
					}))}
					people={(team ?? []).map((m) => ({
						id: m.id,
						name: m.name,
						initials: m.name
							.split(/\s+/)
							.filter(Boolean)
							.slice(0, 2)
							.map((w) => w[0] ?? "")
							.join("")
							.toUpperCase(),
					}))}
					inboxId={inboxId}
				/>

				{/* Tvůj další krok v postupech (prototyp ř. 396–406) */}
				{myFlowSteps.length > 0 && (
					<>
						<div
							className="flex items-center gap-2 font-display font-bold text-ink"
							style={{ margin: "16px 0 8px", padding: "0 4px", fontSize: 13 }}
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 16 16"
								fill="none"
								className="shrink-0"
								style={{ color: "var(--w-brass)" }}
								aria-hidden
							>
								<path
									d="M2 5h7l-2-2M14 11H7l2 2"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							{t("today.flowNextTitle")}
						</div>
						{myFlowSteps.map((f) => (
							<button
								key={f.task.id}
								type="button"
								onClick={() =>
									void navigate({
										to: "/postupy",
										search: { postup: f.fs.chainId },
									})
								}
								className="flex w-full items-center rounded-[11px] border border-line text-left hover:border-brass"
								style={{
									gap: 11,
									padding: "11px 13px",
									marginBottom: 8,
									background: "var(--w-brass-soft)",
								}}
							>
								<span
									className="shrink-0 rounded-full"
									style={{ width: 7, height: 7, background: "var(--w-brass)" }}
								/>
								<div className="min-w-0 flex-1">
									<div
										className="truncate font-display font-bold text-ink"
										style={{ fontSize: 13.5 }}
									>
										{f.task.name}
									</div>
									<div className="truncate font-body text-ink-3" style={{ fontSize: 11.5 }}>
										{f.fs.name}
										{f.blocking ? ` · ${t("today.thenHandOff")} → ${f.blocking}` : ""}
									</div>
								</div>
								<span className="shrink-0 font-mono text-brass-text" style={{ fontSize: 11.5 }}>
									{f.fs.pos}/{f.fs.total}
								</span>
							</button>
						))}
					</>
				)}

				{/* Zpožděné */}
				{g.overdue.length > 0 && (
					<section>
						<SectionHead
							label={t("today.overdue")}
							count={g.overdue.length}
							actionNode={
								<RescheduleMenu
									anchor={t("today.reschedule")}
									onPick={(d) => void rescheduleOverdue(d)}
								/>
							}
						/>
						<ul>{g.overdue.map(card)}</ul>
					</section>
				)}

				{/* Dnes / datum */}
				<section>
					<SectionHead label={dateLabel} count={g.today.length} />
					{g.today.length === 0 ? (
						<div className="text-center" style={{ padding: "80px 20px" }}>
							<p className="font-body text-ink-3" style={{ fontSize: 13.5 }}>
								{t("today.emptyClean")}
							</p>
							{/* Nedatované teď žijí v Zásobníku — nabídni cestu k triage. */}
							<Link
								to="/ukoly"
								search={{ tab: "zasobnik" }}
								className="mt-3 inline-block font-display font-semibold text-brass-text hover:underline"
								style={{ fontSize: 12.5 }}
							>
								{t("today.backlogCta")}
							</Link>
						</div>
					) : (
						<ul>{g.today.map(card)}</ul>
					)}
				</section>
			</div>
		</>
	);
}

function SectionHead({
	label,
	count,
	actionNode,
}: {
	label: string;
	count: number;
	/** Volitelný akční prvek vpravo (např. RescheduleMenu). */
	actionNode?: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-2.5" style={{ margin: "18px 0 2px", padding: "0 4px" }}>
			<span className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
				{label}
			</span>
			<span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
				{count}
			</span>
			{actionNode && <div className="ml-auto">{actionNode}</div>}
		</div>
	);
}
