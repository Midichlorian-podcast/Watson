export const WINDOW_SHELLS = ["app", "focus", "wallboard"] as const;
export type WindowShell = (typeof WINDOW_SHELLS)[number];
export type CalendarRange = "day" | "week" | "month";

export type WatsonSurface =
	| "overview"
	| "mail"
	| "tasks"
	| "upcoming"
	| "projects"
	| "meetings"
	| "intake"
	| "lists"
	| "knowledge"
	| "goals"
	| "reports"
	| "flows"
	| "command-center"
	| "employee"
	| "favorites"
	| "search"
	| "settings"
	| "capture";

export interface WindowSurfaceDefinition {
	id: WatsonSurface;
	/** Navigační cíl používaný při otevření povrchu bez konkrétního deep-linku. */
	path: string;
	paths: readonly string[];
	labelKey: string;
	focus: boolean;
	wallboard: boolean;
}

/**
 * Jediný registr povrchů, které lze otevřít v dalším okně. Každá Watson routa
 * může běžet v plném app shellu; focus/wallboard jsou výslovně povolené jen tam,
 * kde UI a stav obrazovky jejich kontrakt skutečně podporují.
 */
export const WINDOW_SURFACES: readonly WindowSurfaceDefinition[] = [
	{
		id: "overview",
		path: "/prehled",
		paths: ["/prehled"],
		labelKey: "nav.overview",
		focus: true,
		wallboard: true,
	},
	{
		id: "mail",
		path: "/mail",
		paths: ["/mail"],
		labelKey: "nav.mail",
		focus: true,
		wallboard: false,
	},
	{
		id: "tasks",
		path: "/ukoly",
		paths: ["/", "/ukoly", "/schranka"],
		labelKey: "nav.tasks",
		focus: true,
		wallboard: false,
	},
	{
		id: "upcoming",
		path: "/nadchazejici",
		paths: ["/nadchazejici"],
		labelKey: "nav.upcoming",
		focus: true,
		wallboard: false,
	},
	{
		id: "projects",
		path: "/projekty",
		paths: ["/projekty"],
		labelKey: "nav.projects",
		focus: false,
		wallboard: false,
	},
	{
		id: "meetings",
		path: "/meets",
		paths: ["/meets"],
		labelKey: "nav.meetings",
		focus: false,
		wallboard: false,
	},
	{
		id: "intake",
		path: "/prijem-prace",
		paths: ["/prijem-prace"],
		labelKey: "nav.intake",
		focus: false,
		wallboard: false,
	},
	{
		id: "lists",
		path: "/seznamy",
		paths: ["/seznamy"],
		labelKey: "nav.lists",
		focus: true,
		wallboard: false,
	},
	{
		id: "knowledge",
		path: "/znalosti",
		paths: ["/znalosti"],
		labelKey: "nav.knowledge",
		focus: false,
		wallboard: false,
	},
	{
		id: "goals",
		path: "/cile",
		paths: ["/cile"],
		labelKey: "nav.goals",
		focus: false,
		wallboard: false,
	},
	{
		id: "reports",
		path: "/reporty",
		paths: ["/reporty"],
		labelKey: "nav.reports",
		focus: false,
		wallboard: false,
	},
	{
		id: "flows",
		path: "/postupy",
		paths: ["/postupy"],
		labelKey: "nav.flows",
		focus: false,
		wallboard: false,
	},
	{
		id: "command-center",
		path: "/velin",
		paths: ["/velin"],
		labelKey: "nav.velin",
		focus: true,
		wallboard: true,
	},
	{
		id: "employee",
		path: "/zamestnanec",
		paths: ["/zamestnanec"],
		labelKey: "nav.employee",
		focus: false,
		wallboard: false,
	},
	{
		id: "favorites",
		path: "/oblibene/p1",
		paths: ["/oblibene"],
		labelKey: "nav.priority1",
		focus: false,
		wallboard: false,
	},
	{
		id: "search",
		path: "/hledat",
		paths: ["/hledat"],
		labelKey: "nav.search",
		focus: false,
		wallboard: false,
	},
	{
		id: "settings",
		path: "/nastaveni",
		paths: ["/nastaveni"],
		labelKey: "nav.settings",
		focus: false,
		wallboard: false,
	},
	{
		id: "capture",
		path: "/zachytit",
		paths: ["/zachytit"],
		labelKey: "nav.capture",
		focus: false,
		wallboard: false,
	},
] as const;

function routeMatches(pathname: string, route: string): boolean {
	if (route === "/") return pathname === "/";
	return pathname === route || pathname.startsWith(`${route}/`);
}

export function parseWindowShell(value: unknown): WindowShell {
	return value === "focus" || value === "wallboard" ? value : "app";
}

export function parseCalendarRange(value: unknown): CalendarRange | undefined {
	return value === "day" || value === "week" || value === "month" ? value : undefined;
}

export function parseCalendarDate(value: unknown): string | undefined {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
	return date.getUTCFullYear() === year &&
		date.getUTCMonth() === (month ?? 1) - 1 &&
		date.getUTCDate() === day
		? value
		: undefined;
}

export function windowSurfaceForPath(pathname: string): WindowSurfaceDefinition | null {
	return (
		WINDOW_SURFACES.find((surface) =>
			surface.paths.some((route) => routeMatches(pathname, route)),
		) ?? null
	);
}

export function resolveWindowShell(pathname: string, requested: unknown): WindowShell {
	const shell = parseWindowShell(requested);
	if (shell === "app") return shell;
	const surface = windowSurfaceForPath(pathname);
	if (!surface) return "app";
	if (shell === "focus" && surface.focus) return shell;
	if (shell === "wallboard" && surface.wallboard) return shell;
	return "app";
}

export function buildWatsonWindowUrl(
	href: string,
	requestedShell: WindowShell,
	baseUrl: string,
): string {
	const base = new URL(baseUrl);
	const target = new URL(href, base);
	if (target.origin !== base.origin) throw new Error("cross_origin_window_target");
	const shell = resolveWindowShell(target.pathname, requestedShell);
	if (shell === "app") target.searchParams.delete("shell");
	else target.searchParams.set("shell", shell);
	return `${target.pathname}${target.search}${target.hash}`;
}

export interface MultiWindowCapabilities {
	sharedWorker: boolean;
	mobileDevice: boolean;
	safari: boolean;
}

/** Stejná bezpečnostní hranice jako PowerSync Web 1.38.x default multi-tab flags. */
export function supportsSafeMultiWindowData(capabilities: MultiWindowCapabilities): boolean {
	return capabilities.sharedWorker && !capabilities.mobileDevice && !capabilities.safari;
}

export function browserSupportsSafeMultiWindowData(): boolean {
	if (typeof window === "undefined" || typeof navigator === "undefined") return false;
	return supportsSafeMultiWindowData({
		sharedWorker: typeof SharedWorker !== "undefined",
		mobileDevice: /(Android|iPhone|iPod|iPad)/i.test(navigator.userAgent),
		safari: Boolean((window as Window & { safari?: unknown }).safari),
	});
}

export type WindowOpenDisposition = "new-window" | "same-window";

export function openWatsonWindow(href: string, shell: WindowShell = "app"): WindowOpenDisposition {
	const target = buildWatsonWindowUrl(href, shell, window.location.href);
	if (!browserSupportsSafeMultiWindowData()) {
		window.location.assign(target);
		return "same-window";
	}
	window.open(target, "_blank", "noopener,noreferrer");
	return "new-window";
}
