import { useQuery as usePsQuery } from "@powersync/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import {
	type CSSProperties,
	Fragment,
	type MouseEvent as ReactMouseEvent,
	useMemo,
	useState,
} from "react";
import { type CtxItem, useContextMenu } from "../components/ContextMenu";
import { SidebarTrustState } from "../components/TrustState";
import { useAddTask } from "../lib/addTask";
import { useSession } from "../lib/auth-client";
import { useEmployeeHub } from "../lib/employee";
import { initials } from "../lib/format";
import { inboxProjectIds } from "../lib/inbox";
import { useNavigationPins } from "../lib/navigationPins";
import { useNavigationMode } from "../lib/navigationPreferences";
import type { FilterRow } from "../lib/powersync/AppSchema";
import { useProjects } from "../lib/projects";
import { openWatsonWindow, windowSurfaceForPath } from "../lib/windowSurfaces";
import { isLeadership, useWorkspace, useWorkspaces } from "../lib/workspace";
import { useMailUnread } from "../mail/state";
import { CORE_NAV, EMPLOYEE_NAV, type NavItem, TOOL_NAV, VELIN_NAV } from "./nav";

const pad = (n: number) => String(n).padStart(2, "0");
const todayIso = () => {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const NAV_BASE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 11,
	padding: "7px 10px",
	borderRadius: 9,
	borderLeft: "3px solid transparent",
	fontWeight: 600,
	fontSize: 13,
	cursor: "pointer",
};
const BADGE: CSSProperties = {
	fontFamily: "var(--w-font-mono, ui-monospace, monospace)",
	fontSize: 11,
};

function NavRow({
	item,
	active,
	collapsed,
	count,
	marker,
	badge,
	title,
	onContextMenu,
}: {
	item: NavItem;
	active: boolean;
	collapsed: boolean;
	count?: number;
	marker?: CSSProperties;
	/** Textový odznak místo počtu (Velín → „VEDENÍ", prototyp ř. 255). */
	badge?: string;
	title?: string;
	onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
	const { t } = useTranslation();
	return (
		<Link
			to={item.to}
			title={title ?? (collapsed ? t(item.labelKey) : undefined)}
			className={`font-display ${active ? "text-[var(--w-sidebar-ink)]" : "text-[var(--w-sidebar-ink-2)] hover:text-[var(--w-sidebar-ink)]"}`}
			onContextMenu={onContextMenu}
			style={{
				...NAV_BASE,
				justifyContent: collapsed ? "center" : undefined,
				background: active ? "rgba(255,255,255,.09)" : "transparent",
				borderLeftColor: active && !collapsed ? "var(--w-brass)" : "transparent",
				boxShadow: active && collapsed ? "inset 2px 0 0 var(--w-brass)" : undefined,
			}}
		>
			{marker ? (
				<span style={{ width: 9, height: 9, flex: "none", ...marker }} />
			) : (
				<Icon name={item.icon} size={17} />
			)}
			{!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{t(item.labelKey)}</span>}
			{!collapsed && count != null && <span style={BADGE}>{count}</span>}
			{!collapsed && badge && (
				<span
					className="font-mono"
					style={{
						fontSize: 9,
						letterSpacing: ".05em",
						color: "var(--w-sidebar-accent)",
						border: "1px solid var(--w-sidebar-accent)",
						borderRadius: 5,
						padding: "0 4px",
					}}
				>
					{badge}
				</span>
			)}
		</Link>
	);
}

function PinnedRow({
	label,
	onClick,
	active,
	marker,
	icon = "nastaveni",
	onContextMenu,
}: {
	label: string;
	onClick: () => void;
	active: boolean;
	marker?: CSSProperties;
	icon?: NavItem["icon"];
	onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left font-display ${active ? "text-[var(--w-sidebar-ink)]" : "text-[var(--w-sidebar-ink-2)] hover:text-[var(--w-sidebar-ink)]"}`}
			onContextMenu={onContextMenu}
			style={{
				...NAV_BASE,
				background: active ? "rgba(255,255,255,.09)" : "transparent",
				borderLeftColor: active ? "var(--w-brass)" : "transparent",
			}}
		>
			{marker ? (
				<span style={{ width: 9, height: 9, flex: "none", ...marker }} />
			) : (
				<Icon name={icon} size={16} />
			)}
			<span className="min-w-0 flex-1 truncate">{label}</span>
		</button>
	);
}

/** Levý sidebar — 1:1 dle Cloud Design (brass „Přidat úkol", počty, aktivní brass okraj, footer). */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const cm = useContextMenu();
	const { openAdd } = useAddTask();
	const { data: session } = useSession();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const navigationMode = useNavigationMode();
	const [toolsOpen, setToolsOpen] = useState(false);
	// Aktivní projektový filtr (?projekt=) — zvýraznění řádku projektu (prototyp data-projrow).
	const activeProjekt = useRouterState({
		select: (s) => (s.location.search as { projekt?: string }).projekt,
	});
	const activePohled = useRouterState({
		select: (s) => (s.location.search as { pohled?: string }).pohled,
	});
	const projects = useProjects();
	const { pins } = useNavigationPins();
	const { data: savedViewRows } = usePsQuery<FilterRow>(
		"SELECT * FROM filters WHERE query IN ('tasks:v1', 'upcoming:v1') ORDER BY lower(name)",
	);
	const pinnedProjects = pins
		.filter((pin) => pin.kind === "project")
		.map((pin) => projects.find((project) => project.id === pin.id))
		.filter((project): project is NonNullable<typeof project> => !!project);
	const pinnedViews = pins
		.filter((pin) => pin.kind === "saved_view")
		.map((pin) => {
			const synced = (savedViewRows ?? []).find((view) => view.id === pin.id);
			if (synced)
				return {
					id: synced.id,
					name: synced.name,
					surface: synced.surface,
					workspaceId: synced.workspace_id,
				};
			if (!pin.label) return null;
			return {
				id: pin.id,
				name: pin.label,
				surface: pin.surface ?? "tasks",
				workspaceId: pin.workspaceId ?? null,
			};
		})
		.filter((view): view is NonNullable<typeof view> => !!view);
	const userId = session?.user?.id;

	const { data: openTasks } = usePsQuery<{
		id: string;
		project_id: string | null;
		due_date: string | null;
		priority: number | null;
		created_by: string | null;
		parent_id: string | null;
		kind: string | null;
	}>(
		// `kind` se řeší per-počet níž: agendové počty (Dnes/Nadcházející) porady ZAPOČÍTÁVAJÍ
		// (seznamy je ukazují — badge musí sedět s řádky), pracovní počty je vynechávají.
		"SELECT id, project_id, due_date, priority, created_by, parent_id, kind FROM tasks WHERE completed_at IS NULL",
	);
	const { data: myAssignments } = usePsQuery<{ task_id: string | null }>(
		"SELECT task_id FROM assignments WHERE user_id = ?",
		[userId ?? ""],
	);
	// Seznamy — badge = aktivní (nearchivované) checklisty (prototyp navCount.seznamy).
	const { data: activeLists } = usePsQuery<{ id: string }>(
		"SELECT id FROM lists WHERE archived = 0 OR archived IS NULL",
	);
	// Mail — badge = per-osoba nepřečtené v týmových schránkách (unreadFor součet).
	const mailUnread = useMailUnread();
	const employeeHub = useEmployeeHub();
	const employeeLinked = employeeHub.data?.linked === true;

	const { data: workspaces } = useWorkspaces();
	const { activeWs, setActiveWs, isCollapsed, toggleCollapse } = useWorkspace();
	const activeWsName = workspaces?.find((w) => w.id === activeWs)?.name ?? "";
	const wsName = activeWsName || workspaces?.[0]?.name || "";

	// Otevřené úkoly per projekt (pro počty u projektů v sidebaru) — bez porad (práce, ne agenda).
	const projOpen = useMemo<Record<string, number>>(() => {
		const map: Record<string, number> = {};
		for (const t of openTasks ?? [])
			if (t.project_id && t.kind !== "meeting") map[t.project_id] = (map[t.project_id] ?? 0) + 1;
		return map;
	}, [openTasks]);

	const counts = useMemo<Record<string, number>>(() => {
		const tasks = openTasks ?? [];
		const assigned = new Set((myAssignments ?? []).map((a) => a.task_id).filter(Boolean));
		const today = todayIso();
		// Sdílený zdroj názvů schránky (lib/inbox) — ať se počty nerozejdou s obrazovkami.
		const inbox = inboxProjectIds(projects);
		const day = (d: string | null) => d?.slice(0, 10) ?? null;
		// Netriážovaná Schránka (inbox bez termínu) patří jen do počtu /schranka.
		const inboxTask = (t: { project_id: string | null; due_date: string | null }) =>
			!t.due_date && !!t.project_id && inbox.has(t.project_id);
		// Stejné pravidlo viditelnosti podúkolů jako obrazovky: bez termínu žijí jen v rodiči.
		const visible = tasks.filter((t) => (!t.parent_id || t.due_date) && !inboxTask(t));
		// Pracovní podmnožina bez porad — pro Vše/Zásobník/oblíbené (Meets/agenda porady ukazují).
		const visibleWork = visible.filter((t) => t.kind !== "meeting");
		const work = tasks.filter((t) => t.kind !== "meeting");
		return {
			"/schranka": work.filter(
				(t) => t.project_id && inbox.has(t.project_id) && !t.due_date && !t.parent_id,
			).length,
			// Dnes = denní AGENDA (dnes + zpožděné, bez nedatovaných) — VČETNĚ porad,
			// protože seznam Dnes porady zobrazuje a badge musí sedět s řádky.
			"/": visible.filter((t) => {
				const dd = day(t.due_date);
				if (dd == null) return false;
				// porada jen ve svůj den — po něm není „zpožděná" položka agendy
				return t.kind === "meeting" ? dd === today : dd <= today;
			}).length,
			// D3 — kánon = filtr obrazovky Nadcházející (>= dnes, viz Nadchazejici.tsx
			// a Header): dřívější `> dnes` dával jiné číslo než header a obsah.
			"/nadchazejici": visible.filter((t) => {
				const dd = day(t.due_date);
				return dd != null && dd >= today;
			}).length,
			// Úkoly (Vše) skrývá podúkoly úplně — reprezentuje je ⚏ rodiče. Bez porad.
			"/ukoly": work.filter((t) => !t.parent_id && !inboxTask(t)).length,
			// Zásobník = nedatované (non-inbox, top-level) — akční „dluh triage". Bez porad.
			zasobnik: visibleWork.filter((t) => !t.due_date).length,
			"/oblibene/p1": visibleWork.filter((t) => t.priority === 1).length,
			// Jen skutečně přiřazené (prototyp ř. 3150 — ne autor).
			"/oblibene/me": visibleWork.filter((t) => assigned.has(t.id)).length,
			"/seznamy": (activeLists ?? []).length,
			"/mail": mailUnread,
		};
	}, [openTasks, myAssignments, projects, activeLists, mailUnread]);

	const isActive = (to: string) => {
		if (to === "/") return path === "/";
		if (to === "/prehled") return path.startsWith(to);
		return path.startsWith(to);
	};
	const userName = session?.user?.name ?? "";
	const taskModuleActive =
		path === "/" || path.startsWith("/ukoly") || path.startsWith("/schranka");
	const leadership = isLeadership(workspaces);
	const toolRouteActive =
		TOOL_NAV.some((item) => path.startsWith(item.to)) || path.startsWith("/velin");
	const showTools = collapsed || navigationMode === "advanced" || toolsOpen || toolRouteActive;
	const windowMenu = (href: string): CtxItem[] => {
		const surface = windowSurfaceForPath(new URL(href, window.location.origin).pathname);
		return [
			{
				label: t("shell.openNewWindow"),
				onClick: () => openWatsonWindow(href, "app"),
			},
			...(surface?.focus
				? [
						{
							label: t("shell.openFocusedWindow"),
							onClick: () => openWatsonWindow(href, "focus"),
						} satisfies CtxItem,
					]
				: []),
			...(surface?.wallboard
				? [
						{
							label: t("shell.openWallboard"),
							onClick: () => openWatsonWindow(href, "wallboard"),
						} satisfies CtxItem,
					]
				: []),
		];
	};
	const openWindowMenu = (event: ReactMouseEvent<HTMLElement>, href: string) =>
		cm.open(event, windowMenu(href));
	const renderNavItem = (item: NavItem) => {
		// Úkoly jsou v sidebaru jediný modul. Dnes/Příchozí/Vše/Zásobník jsou jeho
		// záložky uvnitř obsahu, takže zde nevznikají čtyři konkurenční vstupy.
		if (item.to === "/ukoly") {
			return (
				<NavRow
					key={item.to}
					item={{ ...item, to: "/" }}
					active={taskModuleActive}
					collapsed={collapsed}
					count={counts["/"]}
					onContextMenu={(event) => openWindowMenu(event, "/")}
				/>
			);
		}
		return (
			<Fragment key={item.to}>
				<NavRow
					item={item}
					active={isActive(item.to)}
					collapsed={collapsed}
					count={item.count ? counts[item.to] : undefined}
					onContextMenu={(event) => openWindowMenu(event, item.to)}
				/>
				{item.to === "/mail" && employeeLinked && (
					<NavRow
						item={EMPLOYEE_NAV}
						active={isActive(EMPLOYEE_NAV.to)}
						collapsed={collapsed}
						onContextMenu={(event) => openWindowMenu(event, EMPLOYEE_NAV.to)}
					/>
				)}
				{item.to === "/reporty" && leadership && (
					<NavRow
						item={VELIN_NAV}
						active={isActive("/velin")}
						collapsed={collapsed}
						badge={t("velin.badge")}
						title={t("velin.navTitle")}
						onContextMenu={(event) => openWindowMenu(event, VELIN_NAV.to)}
					/>
				)}
			</Fragment>
		);
	};

	return (
		<aside
			style={{
				width: collapsed ? 62 : 232,
				flex: "none",
				background: "var(--w-sidebar)",
				display: "flex",
				flexDirection: "column",
				padding: collapsed ? "16px 7px" : "16px 12px",
				transition: "width .16s ease",
			}}
		>
			{/* logo */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 9,
					padding: "2px 4px 14px",
				}}
			>
				<SidebarTrustState collapsed={collapsed} appName={t("app.name")} />
				<button
					type="button"
					onClick={onToggle}
					title={t("shell.collapse")}
					aria-label={t("shell.collapse")}
					className="text-[var(--w-sidebar-ink-2)] hover:text-[var(--w-sidebar-ink)]"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 24,
						height: 24,
						borderRadius: 7,
						flex: "none",
					}}
				>
					<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
						<rect
							x="2"
							y="2.5"
							width="11"
							height="10"
							rx="2"
							stroke="currentColor"
							strokeWidth="1.3"
						/>
						<line x1="6" y1="2.5" x2="6" y2="12.5" stroke="currentColor" strokeWidth="1.3" />
					</svg>
				</button>
			</div>

			{/* + Přidat úkol */}
			<button
				type="button"
				onClick={() => openAdd()}
				title={t("shell.newTask")}
				className="font-display hover:brightness-105"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: collapsed ? "center" : undefined,
					gap: 9,
					background: "var(--w-brass)",
					color: "#fff",
					borderRadius: 10,
					padding: "9px 12px",
					marginBottom: 12,
					fontWeight: 700,
					fontSize: 13.5,
					border: "none",
					cursor: "pointer",
				}}
			>
				<Icon name="pridat" size={collapsed ? 16 : 14} />
				{!collapsed && t("shell.addTask")}
			</button>

			{/* nav */}
			<div
				style={{
					overflow: "auto",
					flex: 1,
					margin: "0 -4px",
					padding: "0 4px",
				}}
			>
				{CORE_NAV.map(renderNavItem)}
				{!collapsed && navigationMode === "guided" && (
					<button
						type="button"
						onClick={() => setToolsOpen((open) => !open)}
						aria-expanded={showTools}
						className="mt-1 flex min-h-11 w-full items-center rounded-lg px-2.5 font-display text-[12px] font-semibold text-[var(--w-sidebar-ink-2)] hover:bg-white/5 hover:text-[var(--w-sidebar-ink)]"
					>
						<Icon name="pridat" size={15} />
						<span className="ml-2 flex-1 text-left">{t("nav.allTools")}</span>
						<span aria-hidden style={{ transform: showTools ? "rotate(45deg)" : undefined }}>
							+
						</span>
					</button>
				)}
				{!collapsed && navigationMode === "advanced" && (
					<div className="px-2 pt-3 pb-1 font-display text-[10px] font-bold uppercase tracking-[.07em] text-[var(--w-sidebar-ink-2)]">
						{t("nav.allTools")}
					</div>
				)}
				{showTools && TOOL_NAV.map(renderNavItem)}

				{!collapsed && (
					<>
						<div
							className="font-display"
							style={{
								fontWeight: 700,
								fontSize: 10.5,
								letterSpacing: ".07em",
								textTransform: "uppercase",
								color: "var(--w-sidebar-ink-2)",
								padding: "16px 10px 6px",
							}}
						>
							{t("navigationPins.title")}
						</div>
						<NavRow
							item={{
								to: "/oblibene/p1",
								icon: "priorita",
								labelKey: "nav.priority1",
							}}
							active={isActive("/oblibene/p1")}
							collapsed={false}
							count={counts["/oblibene/p1"]}
							marker={{ borderRadius: 2, background: "var(--w-brass)" }}
							onContextMenu={(event) => openWindowMenu(event, "/oblibene/p1")}
						/>
						<NavRow
							item={{
								to: "/oblibene/me",
								icon: "prirazeni",
								labelKey: "nav.assignedToMe",
							}}
							active={isActive("/oblibene/me")}
							collapsed={false}
							count={counts["/oblibene/me"]}
							marker={{ borderRadius: "50%", background: "#2a6fdb" }}
							onContextMenu={(event) => openWindowMenu(event, "/oblibene/me")}
						/>
						{pinnedProjects.map((project) => (
							<PinnedRow
								key={`project:${project.id}`}
								label={project.name ?? t("nav.projects")}
								active={activeProjekt === project.id}
								marker={{
									borderRadius: "50%",
									background: project.color ?? "var(--w-sidebar-ink-2)",
								}}
								onClick={() => {
									if (project.workspace_id) setActiveWs(project.workspace_id);
									void navigate({ to: "/ukoly", search: { projekt: project.id } });
								}}
								onContextMenu={(event) => {
									const search = new URLSearchParams({ projekt: project.id });
									if (project.workspace_id) search.set("prostor", project.workspace_id);
									openWindowMenu(event, `/ukoly?${search}`);
								}}
							/>
						))}
						{pinnedViews.map((savedView) => (
							<PinnedRow
								key={`saved-view:${savedView.id}`}
								label={savedView.name ?? t("savedViews.button")}
								active={activePohled === savedView.id}
								onClick={() => {
									if (savedView.workspaceId) setActiveWs(savedView.workspaceId);
									void navigate({
										to: savedView.surface === "upcoming" ? "/nadchazejici" : "/ukoly",
										search: { pohled: savedView.id },
									});
								}}
								onContextMenu={(event) => {
									const search = new URLSearchParams({ pohled: savedView.id });
									if (savedView.workspaceId) search.set("prostor", savedView.workspaceId);
									openWindowMenu(
										event,
										`${savedView.surface === "upcoming" ? "/nadchazejici" : "/ukoly"}?${search}`,
									);
								}}
							/>
						))}

						{/* Pracovní prostory — přepínač + projekty (1:1 dle Cloud Design) */}
						<div
							className="font-display"
							style={{
								fontWeight: 700,
								fontSize: 10.5,
								letterSpacing: ".07em",
								textTransform: "uppercase",
								color: "var(--w-sidebar-ink-2)",
								padding: "16px 10px 6px",
							}}
						>
							{t("nav.workspaces")}
						</div>
						{(workspaces ?? []).map((ws) => {
							const wsProjects = projects.filter((p) => p.workspace_id === ws.id);
							const wsCollapsed = ws.isPersonal ? false : isCollapsed(ws.id);
							const wsActive = ws.id === activeWs;
							return (
								<div key={ws.id}>
									<div
										className="flex items-center"
										style={{
											gap: 7,
											padding: "7px 8px 6px",
											marginTop: 10,
											borderRadius: 8,
											background: wsActive ? "rgba(255,255,255,.05)" : "transparent",
										}}
									>
										<button
											type="button"
											onClick={() => toggleCollapse(ws.id)}
											aria-label={ws.name}
											className="flex items-center"
											// Klikací cíl ≥24px (SVG je jen 9px): padding zvětší plochu, stejně velký
											// záporný margin ho vtáhne zpět → šipka i rozestupy řádku beze změny.
											style={{
												color: "var(--w-sidebar-ink-2)",
												padding: 8,
												margin: -8,
											}}
										>
											<svg
												width="9"
												height="9"
												viewBox="0 0 9 9"
												style={{
													transform: wsCollapsed ? "none" : "rotate(90deg)",
													transition: "transform .15s",
												}}
												aria-hidden
											>
												<path
													d="M2 1.5 L6.5 4.5 L2 7.5"
													stroke="currentColor"
													strokeWidth="1.5"
													fill="none"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
											</svg>
										</button>
										<span
											style={{
												width: 8,
												height: 8,
												borderRadius: 3,
												flex: "none",
												background: ws.color ?? "var(--w-sidebar-ink-2)",
											}}
										/>
										<button
											type="button"
											onClick={() => {
												setActiveWs(ws.id);
												void navigate({ to: "/projekty" });
											}}
											onContextMenu={(event) =>
												openWindowMenu(event, `/projekty?prostor=${encodeURIComponent(ws.id)}`)
											}
											className="truncate text-left font-display hover:text-[var(--w-sidebar-ink)]"
											style={{
												flex: 1,
												fontWeight: 700,
												fontSize: 10.5,
												letterSpacing: ".05em",
												textTransform: "uppercase",
												color: wsActive ? "var(--w-sidebar-ink)" : "var(--w-sidebar-ink-2)",
											}}
										>
											{ws.name}
										</button>
										<span
											className="font-mono"
											style={{
												fontSize: 10.5,
												color: "var(--w-sidebar-ink-2)",
											}}
										>
											{wsProjects.length}
										</span>
									</div>
									{!wsCollapsed &&
										wsProjects.map((p) => (
											<button
												key={p.id}
												type="button"
												onClick={() =>
													void navigate({
														to: "/ukoly",
														search: { projekt: p.id },
													})
												}
												onContextMenu={(event) => {
													const search = new URLSearchParams({
														projekt: p.id,
														prostor: ws.id,
													});
													openWindowMenu(event, `/ukoly?${search}`);
												}}
												className="flex w-full items-center text-left font-display hover:text-[var(--w-sidebar-ink)]"
												style={{
													gap: 11,
													padding: "6px 10px 6px 27px",
													borderRadius: 9,
													color:
														activeProjekt === p.id
															? "var(--w-sidebar-ink)"
															: "var(--w-sidebar-ink-2)",
													background: activeProjekt === p.id ? "rgba(255,255,255,.10)" : undefined,
													fontWeight: 600,
													fontSize: 13,
												}}
											>
												<span
													style={{
														width: 9,
														height: 9,
														borderRadius: "50%",
														flex: "none",
														background: p.color ?? "var(--w-sidebar-ink-2)",
													}}
												/>
												<span className="truncate" style={{ flex: 1 }}>
													{p.name}
												</span>
												<span className="font-mono" style={{ fontSize: 11 }}>
													{projOpen[p.id] ?? 0}
												</span>
											</button>
										))}
								</div>
							);
						})}
					</>
				)}
			</div>

			{/* footer — uživatel → Nastavení */}
			<Link
				to="/nastaveni"
				onContextMenu={(event) => openWindowMenu(event, "/nastaveni")}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 9,
					padding: "9px 8px 2px",
					marginTop: 8,
					borderTop: "1px solid var(--w-sidebar-line)",
				}}
			>
				<span
					className="font-display"
					style={{
						width: 28,
						height: 28,
						borderRadius: "50%",
						background: "var(--w-brass)",
						color: "#fff",
						fontWeight: 700,
						fontSize: 10,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flex: "none",
					}}
				>
					{initials(userName)}
				</span>
				{!collapsed && (
					<div style={{ minWidth: 0, flex: 1 }}>
						<div
							className="font-display"
							style={{
								fontWeight: 600,
								fontSize: 12.5,
								color: "var(--w-sidebar-ink)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{userName}
						</div>
						<div className="font-body" style={{ fontSize: 11, color: "var(--w-sidebar-ink-2)" }}>
							{wsName}
						</div>
					</div>
				)}
				{!collapsed && (
					<svg
						width="14"
						height="14"
						viewBox="0 0 15 15"
						fill="none"
						style={{ color: "var(--w-sidebar-ink-2)", flex: "none" }}
						aria-hidden
					>
						<circle cx="7.5" cy="7.5" r="5.3" stroke="currentColor" strokeWidth="1.3" />
						<circle cx="7.5" cy="7.5" r="1.9" stroke="currentColor" strokeWidth="1.3" />
					</svg>
				)}
			</Link>
		</aside>
	);
}
