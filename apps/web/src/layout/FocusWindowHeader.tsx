import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { SidebarTrustState } from "../components/TrustState";
import { useViewMode, type ViewMode } from "../lib/viewMode";
import {
	buildWatsonWindowUrl,
	openWatsonWindow,
	type WindowShell,
	windowSurfaceForPath,
} from "../lib/windowSurfaces";

export function FocusWindowHeader({ shell }: { shell: Exclude<WindowShell, "app"> }) {
	const { t } = useTranslation();
	const path = useRouterState({ select: (state) => state.location.pathname });
	const surface = windowSurfaceForPath(path);
	const title = surface ? t(surface.labelKey) : t("app.name");
	const mode = shell === "wallboard" ? t("shell.wallboardWindow") : t("shell.focusWindow");
	const navigateUpcoming = useNavigate({ from: "/nadchazejici" });
	const navigateTasks = useNavigate({ from: "/ukoly" });
	const search = useSearch({ strict: false }) as { projekt?: string; zobrazeni?: ViewMode };
	const viewSurface = surface?.id === "upcoming" ? "upcoming" : "tasks";
	const { view, setView } = useViewMode(viewSurface);
	const selectedView = search.zobrazeni ?? view;
	const viewOptions: ViewMode[] =
		surface?.id === "upcoming" || (surface?.id === "tasks" && search.projekt)
			? ["list", "board", "calendar"]
			: ["list", "board"];
	const showViews =
		shell === "focus" &&
		(surface?.id === "upcoming" || (surface?.id === "tasks" && path.startsWith("/ukoly")));
	const selectView = (nextView: ViewMode) => {
		setView(nextView);
		// Focus chrome je dostupný ještě před dokončením SyncGate. Zápis přímo do
		// URL proto zabrání tomu, aby pozdější hydratace obrazovky rychlé kliknutí přepsala.
		if (surface?.id === "upcoming") {
			void navigateUpcoming({
				to: "/nadchazejici",
				search: (current) => ({ ...current, zobrazeni: nextView }),
				replace: true,
			});
		} else if (surface?.id === "tasks" && path.startsWith("/ukoly")) {
			void navigateTasks({
				to: "/ukoly",
				search: (current) => ({ ...current, zobrazeni: nextView }),
				replace: true,
			});
		}
	};
	const closeWindow = () => {
		window.close();
		// Safari/WebKit fallback nevznikl skriptem, takže jej prohlížeč zavřít nesmí.
		// V takovém případě X bezpečně odstraní shell a vrátí stejné okno do Watsonu.
		window.setTimeout(() => {
			if (!window.closed) {
				window.location.assign(
					buildWatsonWindowUrl(window.location.href, "app", window.location.href),
				);
			}
		}, 0);
	};

	return (
		<header
			className="flex min-h-14 items-center gap-3 border-b border-white/10 px-4"
			style={{ flex: "none", background: "var(--w-sidebar)" }}
			data-window-chrome={shell}
		>
			<div className="min-w-0 flex-1">
				<SidebarTrustState collapsed={false} appName={title} />
			</div>
			<span
				className="hidden rounded-full px-2.5 py-1 font-display font-bold uppercase tracking-[.08em] text-[10px] sm:inline-flex"
				style={{ color: "var(--w-sidebar-accent)", background: "rgba(255,255,255,.07)" }}
			>
				{mode}
			</span>
			{showViews && (
				<div className="hidden rounded-lg border border-white/15 p-0.5 md:flex">
					{viewOptions.map((option) => (
						<button
							key={option}
							type="button"
							onClick={() => selectView(option)}
							aria-pressed={selectedView === option}
							className="min-h-9 rounded-md px-2.5 font-display text-[11px] font-semibold"
							style={{
								color: selectedView === option ? "var(--w-sidebar-ink)" : "var(--w-sidebar-ink-2)",
								background: selectedView === option ? "rgba(255,255,255,.09)" : "transparent",
							}}
						>
							{option === "list"
								? t("calendar.viewList")
								: option === "board"
									? t("toolbar.board")
									: t("calendar.viewCalendar")}
						</button>
					))}
				</div>
			)}
			<button
				type="button"
				onClick={() => openWatsonWindow(window.location.href, "app")}
				className="min-h-11 rounded-lg border border-white/15 px-3 font-display text-xs font-semibold text-[var(--w-sidebar-ink)] hover:border-[var(--w-sidebar-accent)]"
			>
				{t("shell.openInWatson")}
			</button>
			<button
				type="button"
				onClick={closeWindow}
				aria-label={t("shell.closeWindow")}
				title={t("shell.closeWindow")}
				className="grid h-11 w-11 place-items-center rounded-lg text-xl text-[var(--w-sidebar-ink-2)] hover:bg-white/5 hover:text-[var(--w-sidebar-ink)]"
			>
				<span aria-hidden>×</span>
			</button>
		</header>
	);
}
