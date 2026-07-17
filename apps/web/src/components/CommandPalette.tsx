import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAddTask } from "../lib/addTask";
import { API_URL } from "../lib/api";
import { focusOnMount } from "../lib/focusOnMount";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjects } from "../lib/projects";
import {
	type RecentEntity,
	readRecentEntities,
	trackRecentEntity,
} from "../lib/recentItems";
import { useViewMode } from "../lib/viewMode";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import { isLeadership, useWorkspace, useWorkspaces } from "../lib/workspace";
import { searchMailThreads } from "../mail/search";
import { useMail } from "../mail/state";

type Route =
	| "/"
	| "/prehled"
	| "/mail"
	| "/seznamy"
	| "/velin"
	| "/ukoly"
	| "/nadchazejici"
	| "/projekty"
	| "/nastaveni"
	| "/schranka"
	| "/hledat"
	| "/cile"
	| "/reporty"
	| "/postupy";
interface PalItem {
	key: string;
	kind: string;
	label: string;
	color?: string;
	initials?: string;
	run: () => void;
}

const ini = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0] ?? "")
		.join("")
		.toUpperCase() || "?";

/** ⌘K command palette (prototyp ř. 2282–2287): obrazovky + projekty + lidé + postupy. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const projects = useProjects();
	const { activeWs } = useWorkspace();
	const { data: workspaces } = useWorkspaces();
	const { setView } = useViewMode();
	const { openAdd, openCapture } = useAddTask();
	const projectDetail = useProjectDetail();
	const m = useMail();
	const [q, setQ] = useState("");
	const [idx, setIdx] = useState(0);
	const [recent, setRecent] = useState<RecentEntity[]>([]);
	const overlayRef = useOverlayLayer<HTMLDivElement>(true, onClose);

	useEffect(() => {
		let active = true;
		const refresh = () => {
			void readRecentEntities().then((rows) => {
				if (active) setRecent(rows);
			});
		};
		refresh();
		window.addEventListener("watson:recent-items", refresh);
		return () => {
			active = false;
			window.removeEventListener("watson:recent-items", refresh);
		};
	}, []);

	const { data: chains } = usePsQuery<{ id: string; name: string | null }>(
		"SELECT id, name FROM chains WHERE state IS NULL OR state != 'done'",
	);
	const { data: tasks } = usePsQuery<{
		id: string;
		name: string | null;
		project_id: string | null;
	}>(
		"SELECT id, name, project_id FROM tasks WHERE parent_id IS NULL ORDER BY completed_at IS NOT NULL, created_at DESC",
	);
	const { data: meetings } = usePsQuery<{
		id: string;
		title: string | null;
		status: string | null;
	}>("SELECT id, title, status FROM meetings ORDER BY created_at DESC");
	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as { id: string; name: string }[];
		},
	});

	const go = useCallback((to: Route) => () => {
		onClose();
		void navigate({ to });
	}, [navigate, onClose]);

	const items = useMemo(() => {
		const query = q.trim().toLowerCase();
		const actionItems: PalItem[] = [
			{
				key: "a:quick-capture",
				kind: t("palette.kindAction"),
				label: t("palette.actionQuickCapture"),
				run: () => {
					onClose();
					openCapture();
				},
			},
			{
				key: "a:new-task",
				kind: t("palette.kindAction"),
				label: t("palette.actionNewTask"),
				run: () => {
					onClose();
					openAdd();
				},
			},
			{
				key: "a:search",
				kind: t("palette.kindAction"),
				label: t("palette.actionSearch"),
				run: go("/hledat"),
			},
		];
		// Nové obrazovky handoffu (prototyp SCN, ř. 2933): Přehled/Mail/Seznamy/Velín;
		// Velín jen pro vedení (stejný gating jako sidebar).
		const screens: PalItem[] = (
			[
				[t("nav.overview"), "/prehled"],
				[t("nav.mail"), "/mail"],
				[t("nav.today"), "/"],
				[t("nav.inbox"), "/schranka"],
				[t("nav.upcoming"), "/nadchazejici"],
				[t("nav.tasks"), "/ukoly"],
				[t("nav.projects"), "/projekty"],
				[t("nav.lists"), "/seznamy"],
				...(isLeadership(workspaces) ? ([[t("nav.velin"), "/velin"]] as [string, Route][]) : []),
				[t("nav.goals"), "/cile"],
				[t("nav.reports"), "/reporty"],
				[t("nav.flows"), "/postupy"],
				[t("nav.search"), "/hledat"],
				[t("nav.settings"), "/nastaveni"],
			] as [string, Route][]
		).map(([label, to]) => ({
			key: `s:${to}`,
			kind: t("palette.kindGoto"),
			label,
			run: go(to),
		}));
		// Kalendář = pohled Úkolů (prototyp SCN ř. 2282, jako g+k) — hned za Úkoly.
		screens.splice(6, 0, {
			key: "s:kalendar",
			kind: t("palette.kindGoto"),
			label: t("calendar.viewCalendar"),
			run: () => {
				onClose();
				setView("calendar");
				void navigate({ to: "/ukoly" });
			},
		});
		// Projekt → filtrovaný seznam Úkolů (prototyp openProj, ř. 2295).
		const projItems: PalItem[] = projects
			.filter((p) => !activeWs || p.workspace_id === activeWs)
			.map((p) => ({
				key: `p:${p.id}`,
				kind: t("palette.kindProject"),
				label: p.name ?? "",
				color: p.color ?? undefined,
				run: () => {
					onClose();
					projectDetail.open(p.id);
					void navigate({ to: "/projekty" });
				},
			}));
		const projectMap = new Map(projects.map((project) => [project.id, project] as const));
		const taskItems: PalItem[] = (tasks ?? []).map((task) => ({
			key: `t:${task.id}`,
			kind: t("palette.kindTask"),
			label: task.name ?? "",
			color: task.project_id ? (projectMap.get(task.project_id)?.color ?? undefined) : undefined,
			run: () => {
				onClose();
				trackRecentEntity("task", task.id);
				void navigate({ to: "/ukoly", search: { ukol: task.id } });
			},
		}));
		const meetingItems: PalItem[] = (meetings ?? []).map((meeting) => ({
			key: `mt:${meeting.id}`,
			kind: t("palette.kindMeeting"),
			label: meeting.title ?? t("search.meeting"),
			run: () => {
				onClose();
				trackRecentEntity("meeting", meeting.id);
				void navigate({ to: "/meets", search: { meet: meeting.id } });
			},
		}));
		const peopleItems: PalItem[] = (team ?? []).map((m) => ({
			key: `m:${m.id}`,
			kind: t("palette.kindPerson"),
			label: m.name,
			initials: ini(m.name),
			run: () => {
				onClose();
				void navigate({ to: "/reporty", search: { tab: "lide", clen: m.id } });
			},
		}));
		const flowItems: PalItem[] = (chains ?? []).map((c) => ({
			key: `f:${c.id}`,
			kind: t("palette.kindFlow"),
			label: c.name ?? "",
			run: () => {
				onClose();
				void navigate({ to: "/postupy", search: { postup: c.id } });
			},
		}));
		const all = [
			...actionItems,
			...screens,
			...taskItems,
			...projItems,
			...meetingItems,
			...peopleItems,
			...flowItems,
		];
		// Pošta — STEJNÉ hledání jako dřívější mailový overlay (operátory from:/has:/…),
		// teď v jedné globální paletě. Klik otevře vlákno v mailu.
		const mailItems: PalItem[] = (query ? searchMailThreads(m, q) : []).map((h) => ({
			key: `mail:${h.id}`,
			kind: t("nav.mail"),
			label: h.subj,
			initials: h.ini,
			run: () => {
				onClose();
				m.openThread(h.id);
				void navigate({ to: "/mail" });
			},
		}));
		if (query) {
			const matches = all.filter((item) => item.label.toLowerCase().includes(query));
			return [...matches.slice(0, 14), ...mailItems].slice(0, 18);
		}
		const entityMap = new Map<string, PalItem>([
			...taskItems.map((item) => [`task:${item.key.slice(2)}`, item] as const),
			...projItems.map((item) => [`project:${item.key.slice(2)}`, item] as const),
			...meetingItems.map((item) => [`meeting:${item.key.slice(3)}`, item] as const),
		]);
		const recentItems = recent
			.map((entry) => entityMap.get(`${entry.kind}:${entry.id}`))
			.filter((item): item is PalItem => Boolean(item))
			.map((item) => ({ ...item, key: `r:${item.key}`, kind: t("palette.kindRecent") }));
		return [...actionItems, ...recentItems.slice(0, 6), ...screens].slice(0, 18);
	}, [
		q,
		projects,
		activeWs,
		team,
		chains,
		tasks,
		meetings,
		recent,
		t,
		m,
		navigate,
		onClose,
		go,
		setView,
		workspaces,
		openAdd,
		openCapture,
		projectDetail,
	]);

	const activeIdx = Math.min(idx, Math.max(0, items.length - 1));

	const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setIdx((i) => Math.min(items.length - 1, i + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setIdx((i) => Math.max(0, i - 1));
		} else if (e.key === "Enter") {
			e.preventDefault();
			items[activeIdx]?.run();
		}
	};

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.5)", zIndex: "var(--w-layer-nested)" }}
			/>
			<div
				data-esc-layer
				className="pointer-events-none fixed inset-0 flex items-start justify-center"
				style={{ zIndex: "calc(var(--w-layer-nested) + 1)", paddingTop: "11vh" }}
			>
				<div
					ref={overlayRef}
					role="dialog"
					aria-modal="true"
					aria-label={t("palette.placeholder")}
					className="pointer-events-auto overflow-hidden rounded-[14px] border border-line bg-card"
					style={{ width: 560, maxWidth: "94vw", boxShadow: "var(--w-shadow)" }}
				>
					<div
						className="flex items-center gap-2.5 border-line border-b"
						style={{ padding: "13px 16px" }}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 15 15"
							fill="none"
							className="shrink-0 text-ink-3"
							aria-hidden
						>
							<circle cx="6.4" cy="6.4" r="4.4" stroke="currentColor" strokeWidth="1.4" />
							<line x1="9.6" y1="9.6" x2="13" y2="13" stroke="currentColor" strokeWidth="1.4" />
						</svg>
						<input
							ref={focusOnMount}
							value={q}
							onChange={(e) => {
								setQ(e.target.value);
								setIdx(0);
							}}
							onKeyDown={onKey}
							placeholder={t("palette.placeholder")}
							aria-label={t("palette.placeholder")}
							className="flex-1 border-none bg-transparent font-display font-semibold text-ink outline-none"
							style={{ fontSize: 15 }}
						/>
						<kbd
							className="rounded border border-line bg-panel-2 font-mono text-ink-3"
							style={{ padding: "2px 6px", fontSize: 11 }}
						>
							Esc
						</kbd>
					</div>
					<div style={{ maxHeight: "50vh", overflow: "auto", padding: 6 }}>
						{items.length === 0 ? (
							<div className="py-4 text-center font-body text-ink-3" style={{ fontSize: 13 }}>
								{t("palette.empty")}
							</div>
						) : (
							items.map((it, i) => (
								<button
									key={it.key}
									type="button"
									onClick={it.run}
									onMouseEnter={() => setIdx(i)}
									className="flex w-full items-center gap-2.5 rounded-[9px] text-left"
									style={{
										padding: "9px 11px",
										background: i === activeIdx ? "var(--w-brass-soft)" : "transparent",
									}}
								>
									{it.color && (
										<span
											className="shrink-0 rounded-full"
											style={{ width: 16, height: 16, background: it.color }}
										/>
									)}
									{it.initials && (
										<span
											className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
											style={{
												width: 20,
												height: 20,
												fontSize: 8.5,
												color: "#fff",
												background: "var(--w-avatar)",
											}}
										>
											{it.initials}
										</span>
									)}
									<span
										className="flex-1 font-display font-semibold text-ink"
										style={{ fontSize: 13.5 }}
									>
										{it.label}
									</span>
									<span
										className="font-mono text-ink-3 uppercase"
										style={{ fontSize: 10, letterSpacing: ".04em" }}
									>
										{it.kind}
									</span>
								</button>
							))
						)}
					</div>
				</div>
			</div>
		</>
	);
}
