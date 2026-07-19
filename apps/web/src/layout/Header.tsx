import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { useMemo, useState } from "react";
import { AvailabilityQuickToggle } from "../components/AvailabilityQuickToggle";
import { NotifCenter, useNotifItems } from "../components/NotifCenter";
import { useAddTask } from "../lib/addTask";
import { focusOnMount } from "../lib/focusOnMount";
import { INBOX_NAMES } from "../lib/inbox";
import { useListSearch } from "../lib/listSearch";
import { useIsMobile } from "../lib/useIsMobile";
import { useViewMode, type ViewMode } from "../lib/viewMode";
import { useWatson } from "../lib/watson";
import { openWatsonWindow, windowSurfaceForPath } from "../lib/windowSurfaces";
import { ALL_NAV } from "./nav";
import { useTheme } from "./useTheme";

const ICON_BASE =
	"grid h-11 w-11 place-items-center rounded-[9px] border border-line bg-panel-2 text-ink-2 md:h-[34px] md:w-[34px]";
// Hover dle prototypu ř. 298–301: lupa jen okraj, zvonek/motiv jen barva textu.
const ICON_BTN_BORDER = `${ICON_BASE} hover:border-brass`;
const ICON_BTN_TEXT = `${ICON_BASE} hover:text-brass-text`;

/** Horní header — 1:1 dle Cloud Design (square ikon-buttony, Watson pill, brass „+ Úkol"). */
export function Header() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const navigateUpcoming = useNavigate({ from: "/nadchazejici" });
	const navigateTasks = useNavigate({ from: "/ukoly" });
	const { openAdd } = useAddTask();
	const { toggleWatson } = useWatson();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const active = ALL_NAV.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
	const title = active ? t(active.labelKey) : t("app.name");
	const windowSurface = windowSurfaceForPath(path);
	const { theme, toggle } = useTheme();
	const isDark = theme === "dark";
	// Mobil: header nesmí přetékat 375px. Redundantní ovládání skryto (Watson = spodní lišta,
	// motiv = Nastavení, zámek pohledu = pokročilé); zbytek se ve výjimečném případě odscrolluje.
	const isMobile = useIsMobile();

	// Notifikační centrum — agregace štafet, po termínu a pošty (components/NotifCenter);
	// odznak = položky, které uživatel ještě neviděl.
	const [notifOpen, setNotifOpen] = useState(false);
	const { unseen } = useNotifItems();

	// Podtitulek „{n} úkolů · {x,x} h" pro workspace obrazovky (prototyp ř. 269–274 + 3090–3092):
	// count = úkoly aktuální obrazovky, hodiny = součet trvání úkolů s časem.
	const { data: openRows } = usePsQuery<{
		due_date: string | null;
		start_date: string | null;
		duration_min: number | null;
		parent_id: string | null;
		project_id: string | null;
		kind: string | null;
	}>(
		// Hlavička Dnes = denní AGENDA — porady ZAPOČÍTÁVÁ (seznam Dnes je zobrazuje;
		// badge/hodiny musí sedět s viditelnými řádky). Pracovní statistiky je filtrují jinde.
		"SELECT due_date, start_date, duration_min, parent_id, project_id, kind FROM tasks WHERE completed_at IS NULL",
	);
	const { data: projRows } = usePsQuery<{ id: string; name: string | null }>(
		"SELECT id, name FROM projects",
	);
	// Sloučený modul Úkoly (Dnes/Vše/Zásobník žijí pod „/" i „/ukoly") — záložka z URL.
	const search = useSearch({ strict: false }) as {
		tab?: string;
		projekt?: string;
		zobrazeni?: ViewMode;
	};
	const inTaskModule = path === "/" || path.startsWith("/ukoly") || path.startsWith("/schranka");
	const activeTab = path.startsWith("/schranka")
		? "prichozi"
		: (search.tab ?? (path === "/" ? "dnes" : "vse"));
	const isWorkspace =
		inTaskModule || path.startsWith("/nadchazejici") || path.startsWith("/oblibene");
	const subtitle = useMemo(() => {
		if (!isWorkspace) return null;
		const tdy = new Date();
		const tdyISO = `${tdy.getFullYear()}-${String(tdy.getMonth() + 1).padStart(2, "0")}-${String(tdy.getDate()).padStart(2, "0")}`;
		// Stejné pravidlo viditelnosti jako obrazovky (podúkoly + bez netriážované Schránky).
		const inboxIds = new Set(
			(projRows ?? []).filter((p) => INBOX_NAMES.has(p.name ?? "")).map((p) => p.id),
		);
		// Domovská „/" = záložka Dnes (dnešní + zpožděné, BEZ nedatovaných — ty jsou v Zásobníku).
		const dnesView = path === "/" && activeTab === "dnes";
		const incomingView = inTaskModule && activeTab === "prichozi";
		const backlogView = inTaskModule && activeTab === "zasobnik";
		const src = (openRows ?? []).filter((r) => {
			const d = r.due_date ? r.due_date.slice(0, 10) : null;
			if (incomingView) return !r.parent_id && !d && !!r.project_id && inboxIds.has(r.project_id);
			if (!d && r.project_id && inboxIds.has(r.project_id)) return false;
			if (dnesView)
				// jen s termínem dnes/zpožděné (nedatované už nepatří do Dnes);
				// porada se počítá JEN ve svůj den — po něm není „zpožděná" (hlásí ji Meets)
				return (
					(r.parent_id ? d !== null : true) &&
					d !== null &&
					(r.kind === "meeting" ? d === tdyISO : d <= tdyISO)
				);
			if (backlogView) return !r.parent_id && d === null; // Zásobník = nedatované top-level
			if (path.startsWith("/nadchazejici")) return d !== null && d >= tdyISO;
			return !r.parent_id; // Vše / Oblíbené: jen top-level
		});
		const mins = src.filter((r) => r.start_date).reduce((a, r) => a + (r.duration_min ?? 30), 0);
		const h = Math.round((mins / 60) * 10) / 10;
		return {
			count: src.length,
			timeLabel: h > 0 ? `${String(h).replace(".", ",")} h` : null,
		};
	}, [openRows, projRows, path, isWorkspace, activeTab, inTaskModule]);

	const { q, setQ, open: searchOpen, setOpen: setSearchOpen } = useListSearch();

	// Přepínač pohledů Seznam|Nástěnka|Kalendář v headeru (prototyp ř. 277–287; ne Dnes/Schránka).
	const viewSurface = path.startsWith("/nadchazejici")
		? "upcoming"
		: path.startsWith("/oblibene")
			? "favorites"
			: "tasks";
	const { view, setView, locked, defaultView, toggleLock } = useViewMode(viewSurface);
	// Přepínač pohledů dává smysl jen tam, kde víc pohledů existuje: záložka „Vše"
	// sloučeného modulu (ne Dnes/Zásobník), Nadcházející a Oblíbené.
	const showViewSwitcher =
		(inTaskModule && activeTab === "vse") ||
		path.startsWith("/nadchazejici") ||
		path.startsWith("/oblibene");
	// Kalendář je pohled jen pro Nadcházející/Oblíbené a pro projektový drill-down ve „Vše"
	// (globální „Vše" ho nemá — duplicita s Nadcházejícími).
	const allowCalendar =
		path.startsWith("/nadchazejici") ||
		path.startsWith("/oblibene") ||
		(inTaskModule && !!search.projekt);
	const viewOptions: ViewMode[] = allowCalendar ? ["list", "board", "calendar"] : ["list", "board"];
	const viewLabels: Record<ViewMode, string> = {
		list: t("calendar.viewList"),
		board: t("toolbar.board"),
		calendar: t("calendar.viewCalendar"),
	};
	const selectedView =
		path.startsWith("/nadchazejici") || path.startsWith("/ukoly")
			? (search.zobrazeni ?? view)
			: view;
	const selectView = (nextView: ViewMode) => {
		setView(nextView);
		if (path.startsWith("/nadchazejici")) {
			void navigateUpcoming({
				to: "/nadchazejici",
				search: (current) => ({ ...current, zobrazeni: nextView }),
				replace: true,
			});
		} else if (path.startsWith("/ukoly")) {
			void navigateTasks({
				to: "/ukoly",
				search: (current) => ({ ...current, zobrazeni: nextView }),
				replace: true,
			});
		}
	};

	return (
		<header
			className={`flex items-center gap-3 border-line border-b bg-card px-4 ${isMobile ? "flex-wrap overflow-visible" : "overflow-x-auto"}`}
			style={{ padding: "11px 16px", flex: "none" }}
		>
			<div style={{ flex: "none", minWidth: 0, maxWidth: isMobile ? "40vw" : "34vw" }}>
				<div
					className="truncate font-display font-extrabold text-ink"
					style={{ fontSize: 19, lineHeight: 1.1 }}
				>
					{title}
				</div>
				{subtitle && (
					<div
						className="mt-0.5 flex font-mono text-ink-3"
						style={{ fontSize: 11.5, gap: 8, whiteSpace: "nowrap" }}
					>
						<span>{t("shell.taskCount", { count: subtitle.count })}</span>
						{subtitle.timeLabel && <span>· {subtitle.timeLabel}</span>}
					</div>
				)}
			</div>

			{showViewSwitcher && !isMobile && (
				<>
					<div
						className="flex border border-line bg-panel-2"
						style={{
							marginLeft: 6,
							flex: "none",
							borderRadius: 10,
							padding: 3,
						}}
					>
						{viewOptions.map((v) => (
							<button
								key={v}
								type="button"
								onClick={() => selectView(v)}
								aria-pressed={selectedView === v}
								className="cursor-pointer font-display font-semibold"
								style={{
									fontSize: 12.5,
									padding: "5px 12px",
									borderRadius: 7,
									background: selectedView === v ? "var(--w-card)" : "transparent",
									color: selectedView === v ? "var(--w-ink)" : "var(--w-ink-3)",
								}}
							>
								{viewLabels[v]}
							</button>
						))}
					</div>
					{!isMobile && (
						<button
							type="button"
							onClick={toggleLock}
							title={t("shell.lockView")}
							aria-label={t("shell.lockView")}
							aria-pressed={locked}
							className="flex shrink-0 cursor-pointer items-center justify-center hover:border-brass"
							style={{
								width: 32,
								height: 32,
								borderRadius: 9,
								border: `1px solid ${locked ? "var(--w-brass)" : "var(--w-line)"}`,
								background: locked ? "var(--w-brass-soft)" : "transparent",
								color: locked ? "var(--w-brass-text)" : "var(--w-ink-2)",
							}}
						>
							{locked ? (
								<svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden>
									<rect
										x="3"
										y="7"
										width="9"
										height="6"
										rx="1.5"
										stroke="currentColor"
										strokeWidth="1.3"
									/>
									<path
										d="M5 7 V5 A2.5 2.5 0 0 1 10 5 V7"
										stroke="currentColor"
										strokeWidth="1.3"
									/>
								</svg>
							) : (
								<svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden>
									<rect
										x="3"
										y="7"
										width="9"
										height="6"
										rx="1.5"
										stroke="currentColor"
										strokeWidth="1.3"
									/>
									<path
										d="M5 7 V5 A2.5 2.5 0 0 1 9.7 4"
										stroke="currentColor"
										strokeWidth="1.3"
										strokeLinecap="round"
									/>
								</svg>
							)}
						</button>
					)}
					{!isMobile && locked && defaultView && (
						<span
							className="inline-flex shrink-0 items-center font-display font-semibold"
							style={{
								gap: 5,
								fontSize: 11,
								color: "var(--w-brass-text)",
								background: "var(--w-brass-soft)",
								borderRadius: 7,
								padding: "4px 9px",
								whiteSpace: "nowrap",
							}}
							title={t("shell.lockView")}
						>
							{t("shell.defaultView")}: {viewLabels[defaultView]}
						</span>
					)}
				</>
			)}

			<div className="ml-auto flex items-center" style={{ gap: 9 }}>
				{/* inline hledání aktuálního seznamu (prototyp searchOpen, ř. 290–296) */}
				{searchOpen && (
					<div
						className="flex items-center border border-line bg-panel-2"
						style={{
							gap: 7,
							borderRadius: 9,
							padding: "6px 11px",
							width: 200,
							minWidth: 120,
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 15 15"
							fill="none"
							className="shrink-0 text-ink-3"
							aria-hidden
						>
							<circle cx="6.4" cy="6.4" r="4.4" stroke="currentColor" strokeWidth="1.4" />
							<line
								x1="9.6"
								y1="9.6"
								x2="13"
								y2="13"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
							/>
						</svg>
						<input
							ref={focusOnMount}
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.stopPropagation();
									setSearchOpen(false);
								}
							}}
							placeholder={t("shell.searchInline")}
							aria-label={t("shell.searchInline")}
							className="w-full border-none bg-transparent font-body text-ink outline-none"
							style={{ fontSize: 13 }}
						/>
						<button
							type="button"
							onClick={() => {
								setQ("");
								setSearchOpen(false);
							}}
							className="shrink-0 text-ink-3 hover:text-ink"
							style={{ fontSize: 14, lineHeight: 1 }}
							aria-label={t("shell.searchClose")}
						>
							×
						</button>
					</div>
				)}
				{!searchOpen && (
					<button
						type="button"
						onClick={() => (isWorkspace ? setSearchOpen(true) : void navigate({ to: "/hledat" }))}
						title={t("shell.search")}
						aria-label={t("shell.search")}
						className={ICON_BTN_BORDER}
					>
						<svg
							width="17"
							height="17"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							strokeLinecap="butt"
							strokeLinejoin="round"
							aria-hidden
						>
							<circle cx="10.5" cy="10.5" r="6" />
							<line x1="15" y1="15" x2="20" y2="20" />
						</svg>
					</button>
				)}

				<AvailabilityQuickToggle isMobile={isMobile} />

				{!isMobile && (
					<button
						type="button"
						onClick={() =>
							openWatsonWindow(window.location.href, windowSurface?.focus ? "focus" : "app")
						}
						title={windowSurface?.focus ? t("shell.openFocusedWindow") : t("shell.openNewWindow")}
						aria-label={
							windowSurface?.focus ? t("shell.openFocusedWindow") : t("shell.openNewWindow")
						}
						className={ICON_BTN_BORDER}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.3"
							aria-hidden
						>
							<rect x="2" y="4.5" width="8.5" height="8.5" rx="1.5" />
							<path d="M6 2.5h6.5c.55 0 1 .45 1 1V10" />
							<path d="m9.5 6.5 4-4m-3.5 0h3.5V6" />
						</svg>
					</button>
				)}
				{!isMobile && windowSurface?.wallboard && (
					<button
						type="button"
						onClick={() => openWatsonWindow(window.location.href, "wallboard")}
						title={t("shell.openWallboard")}
						aria-label={t("shell.openWallboard")}
						className={ICON_BTN_BORDER}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.3"
							aria-hidden
						>
							<rect x="2" y="2.5" width="12" height="9" rx="1.5" />
							<path d="M6 14h4M8 11.5V14" />
						</svg>
					</button>
				)}

				<div className="relative">
					<button
						type="button"
						onClick={() => setNotifOpen((o) => !o)}
						title={t("shell.notifications")}
						aria-label={t("shell.notifications")}
						className={`${ICON_BTN_TEXT} relative`}
					>
						<svg
							width="17"
							height="17"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							strokeLinecap="butt"
							strokeLinejoin="round"
							aria-hidden
						>
							<path d="M6.6 17 C6.6 11.2 7.8 8.6 12 8.6 C16.2 8.6 17.4 11.2 17.4 17 Z" />
							<line x1="5" y1="17" x2="19" y2="17" />
							<path d="M10.2 20 A2.1 2.1 0 0 0 13.8 20" />
							<line x1="12" y1="6" x2="12" y2="8.6" />
						</svg>
						{/* odznak = neviděné položky (štafeta + po termínu + pošta) */}
						{unseen > 0 && (
							<span
								className="absolute grid place-items-center font-display font-bold text-white"
								style={{
									top: -3,
									right: -3,
									minWidth: 15,
									height: 15,
									padding: "0 3px",
									borderRadius: 999,
									fontSize: 9,
									background: "var(--w-overdue)",
									boxShadow: "0 0 0 2px var(--w-card)",
								}}
							>
								{unseen > 99 ? "99+" : unseen}
							</span>
						)}
					</button>
					<NotifCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
				</div>

				{!isMobile && (
					<button
						type="button"
						onClick={toggle}
						title={t("shell.theme")}
						aria-label={t("shell.theme")}
						className={ICON_BTN_TEXT}
					>
						{isDark ? (
							<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
								<circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.4" />
								<g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
									<line x1="7.5" y1="1.5" x2="7.5" y2="3" />
									<line x1="7.5" y1="12" x2="7.5" y2="13.5" />
									<line x1="1.5" y1="7.5" x2="3" y2="7.5" />
									<line x1="12" y1="7.5" x2="13.5" y2="7.5" />
								</g>
							</svg>
						) : (
							<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
								<path
									d="M11.6 8.9 A4.7 4.7 0 1 1 6.1 3.4 A3.7 3.7 0 0 0 11.6 8.9 Z"
									fill="currentColor"
								/>
							</svg>
						)}
					</button>
				)}

				{!isMobile && (
					<button
						type="button"
						onClick={toggleWatson}
						title={t("shell.assistant")}
						className="flex h-[34px] items-center rounded-[9px] border border-brass font-display font-bold text-brass-text hover:bg-brass hover:text-white"
						style={{
							gap: 7,
							background: "var(--w-brass-soft)",
							padding: "0 11px",
							fontSize: 12.5,
						}}
					>
						<span
							className="flex items-center justify-center rounded-full"
							style={{
								width: 16,
								height: 16,
								border: "1.6px solid currentColor",
								fontSize: 9,
								fontWeight: 800,
							}}
						>
							W
						</span>
						{t("shell.assistant")}
					</button>
				)}

				<button
					type="button"
					onClick={() => openAdd()}
					aria-label={t("shell.addTask")}
					className="flex h-11 items-center rounded-[9px] font-display font-bold text-white hover:brightness-105 md:h-[34px]"
					style={{
						gap: 6,
						background: "var(--w-brass)",
						padding: "0 13px",
						fontSize: 12.5,
					}}
				>
					<svg width="12" height="12" viewBox="0 0 13 13" aria-hidden>
						<line
							x1="6.5"
							y1="2"
							x2="6.5"
							y2="11"
							stroke="#fff"
							strokeWidth="1.8"
							strokeLinecap="round"
						/>
						<line
							x1="2"
							y1="6.5"
							x2="11"
							y2="6.5"
							stroke="#fff"
							strokeWidth="1.8"
							strokeLinecap="round"
						/>
					</svg>
					{!isMobile && t("shell.newTask")}
				</button>
			</div>

			{showViewSwitcher && isMobile && (
				<div
					className="flex w-full items-center border-line border-t"
					style={{
						gap: 4,
						margin: "0 -16px -11px",
						padding: "6px 14px",
						width: "calc(100% + 32px)",
					}}
				>
					{viewOptions.map((v) => (
						<button
							key={v}
							type="button"
							onClick={() => selectView(v)}
							aria-pressed={selectedView === v}
							className="min-h-11 flex-1 rounded-lg font-display font-semibold"
							style={{
								fontSize: 12.5,
								background: selectedView === v ? "var(--w-brass-soft)" : "transparent",
								color:
									selectedView === v ? "var(--w-brass-text)" : "var(--w-ink-3)",
							}}
						>
							{viewLabels[v]}
						</button>
					))}
				</div>
			)}
		</header>
	);
}
