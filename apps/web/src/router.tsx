import {
	createRootRoute,
	createRoute,
	createRouter,
	retainSearchParams,
} from "@tanstack/react-router";
import { lazy } from "react";
import { AppLayout } from "./layout/AppLayout";
import { parseSettingsSection, type SettingsSection } from "./lib/settingsSections";
import { parseTaskTab, type TaskTab } from "./lib/taskTabs";
import {
	type CalendarRange,
	parseCalendarDate,
	parseCalendarRange,
	parseWindowShell,
	type WindowShell,
} from "./lib/windowSurfaces";

// Layout zůstává eager; obrazovky se načítají po vstupu → menší main chunk.
// (Suspense boundary je kolem <Outlet/> v AppLayout).

const named = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, key: K) =>
	lazy(() => loader().then((m) => ({ default: m[key] })));

const Cile = named(() => import("./screens/Cile"), "Cile");
const CaptureIngress = named(() => import("./screens/CaptureIngress"), "CaptureIngress");
const EmployeeHub = named(() => import("./screens/EmployeeHub"), "EmployeeHub");
const Hledat = named(() => import("./screens/Hledat"), "Hledat");
const Intake = named(() => import("./screens/Intake"), "Intake");
const Prehled = named(() => import("./screens/Prehled"), "Prehled");
const Seznamy = named(() => import("./screens/Seznamy"), "Seznamy");
const Znalosti = named(() => import("./screens/Znalosti"), "Znalosti");
const Velin = named(() => import("./screens/Velin"), "Velin");
const Mail = named(() => import("./screens/Mail"), "Mail");
const Mitingy = named(() => import("./screens/Mitingy"), "Mitingy");
const Nadchazejici = named(() => import("./screens/Nadchazejici"), "Nadchazejici");
const Nastaveni = named(() => import("./screens/Nastaveni"), "Nastaveni");
const Postupy = named(() => import("./screens/Postupy"), "Postupy");
const Projekty = named(() => import("./screens/Projekty"), "Projekty");
const Reporty = named(() => import("./screens/Reporty"), "Reporty");
const UkolyShell = lazy(() =>
	import("./screens/UkolyShell").then((module) => ({ default: module.UkolyShell })),
);
const Oblibene = lazy(() => import("./screens/Oblibene").then((m) => ({ default: m.Oblibene })));

type RootSearch = { shell?: Exclude<WindowShell, "app">; prostor?: string };
const retainWindowContext = retainSearchParams<RootSearch>(["shell", "prostor"]);

const rootRoute = createRootRoute({
	component: AppLayout,
	search: {
		middlewares: [
			(context) =>
				parseWindowShell(context.search.shell) === "app"
					? context.next(context.search)
					: retainWindowContext(context),
		],
	},
	validateSearch: (search: Record<string, unknown>): RootSearch => {
		const shell = parseWindowShell(search.shell);
		return {
			shell: shell === "app" ? undefined : shell,
			prostor: typeof search.prostor === "string" ? search.prostor : undefined,
		};
	},
});

const prehledRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/prehled",
	component: Prehled,
	validateSearch: (
		s: Record<string, unknown>,
	): {
		vstup?: "tym" | "provoz";
		prostor?: string;
		firma?: string;
		rozlozeni?: "grid" | "feed";
	} => ({
		vstup: s.vstup === "tym" || s.vstup === "provoz" ? s.vstup : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
		firma: typeof s.firma === "string" ? s.firma : undefined,
		rozlozeni: s.rozlozeni === "grid" || s.rozlozeni === "feed" ? s.rozlozeni : undefined,
	}),
});
const captureRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/zachytit",
	component: CaptureIngress,
	validateSearch: (
		search: Record<string, unknown>,
	): { title?: string; text?: string; url?: string } => ({
		title: typeof search.title === "string" ? search.title : undefined,
		text: typeof search.text === "string" ? search.text : undefined,
		url: typeof search.url === "string" ? search.url : undefined,
	}),
});
const seznamyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/seznamy",
	component: Seznamy,
	validateSearch: (s: Record<string, unknown>): { seznam?: string; prostor?: string } => ({
		seznam: typeof s.seznam === "string" ? s.seznam : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
	}),
});
const znalostiRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/znalosti",
	component: Znalosti,
	validateSearch: (s: Record<string, unknown>): { clanek?: string; prostor?: string } => ({
		clanek: typeof s.clanek === "string" ? s.clanek : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
	}),
});
const velinRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/velin",
	component: Velin,
	validateSearch: (s: Record<string, unknown>): { prostor?: string; firma?: string } => ({
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
		firma: typeof s.firma === "string" ? s.firma : undefined,
	}),
});
const mailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail",
	component: Mail,
	validateSearch: (
		s: Record<string, unknown>,
	): {
		vlakno?: string;
		prostor?: string;
		mailConnection?: "success" | "error";
		code?: string;
		mailAccount?: string;
		mailMessage?: string;
	} => ({
		vlakno: typeof s.vlakno === "string" ? s.vlakno : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
		mailConnection:
			s.mailConnection === "success" || s.mailConnection === "error" ? s.mailConnection : undefined,
		code: typeof s.code === "string" ? s.code : undefined,
		mailAccount: typeof s.mailAccount === "string" ? s.mailAccount : undefined,
		mailMessage: typeof s.mailMessage === "string" ? s.mailMessage : undefined,
	}),
});
const mitingyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/meets",
	// ?meet= otevře board porady (deep-link); ?focus=zapis skočí na vkládání zápisu.
	validateSearch: (
		s: Record<string, unknown>,
	): { meet?: string; decision?: string; focus?: "zapis"; prostor?: string } => ({
		meet: typeof s.meet === "string" ? s.meet : undefined,
		decision: typeof s.decision === "string" ? s.decision : undefined,
		focus: s.focus === "zapis" ? "zapis" : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
	}),
	component: Mitingy,
});
// „/" = domovská routa sloučeného modulu Úkoly → záložka Dnes (zachovává landing redirect
// watson.landing v AppLayout). `?tab=` umí přepnout i tady, default = dnes.
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: () => <UkolyShell defaultTab="dnes" />,
	validateSearch: (s: Record<string, unknown>): { tab?: TaskTab } => ({
		tab: parseTaskTab(s.tab),
	}),
});
const ukolyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/ukoly",
	component: () => <UkolyShell defaultTab="vse" />,
	validateSearch: (
		s: Record<string, unknown>,
	): {
		projekt?: string;
		ukol?: string;
		pohled?: string;
		tab?: TaskTab;
		prostor?: string;
		zobrazeni?: "list" | "board" | "calendar";
		rozsah?: CalendarRange;
		datum?: string;
	} => ({
		projekt: typeof s.projekt === "string" ? s.projekt : undefined,
		// deep-link z „Kopírovat odkaz" — otevře detail úkolu
		ukol: typeof s.ukol === "string" ? s.ukol : undefined,
		pohled: typeof s.pohled === "string" ? s.pohled : undefined,
		// aktivní záložka modulu (dnes | vse | zasobnik); default vse na /ukoly
		tab: parseTaskTab(s.tab),
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
		zobrazeni:
			s.zobrazeni === "list" || s.zobrazeni === "board" || s.zobrazeni === "calendar"
				? s.zobrazeni
				: undefined,
		rozsah: parseCalendarRange(s.rozsah),
		datum: parseCalendarDate(s.datum),
	}),
});
const projektyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projekty",
	component: Projekty,
	validateSearch: (s: Record<string, unknown>): { projekt?: string; prostor?: string } => ({
		projekt: typeof s.projekt === "string" ? s.projekt : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
	}),
});
const nastaveniRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/nastaveni",
	component: Nastaveni,
	validateSearch: (search: Record<string, unknown>): { sekce?: SettingsSection } => ({
		sekce: parseSettingsSection(search.sekce),
	}),
});
const nadchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/nadchazejici",
	component: Nadchazejici,
	validateSearch: (
		s: Record<string, unknown>,
	): {
		pohled?: string;
		prostor?: string;
		zobrazeni?: "list" | "board" | "calendar";
		rozsah?: CalendarRange;
		datum?: string;
	} => ({
		pohled: typeof s.pohled === "string" ? s.pohled : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
		zobrazeni:
			s.zobrazeni === "list" || s.zobrazeni === "board" || s.zobrazeni === "calendar"
				? s.zobrazeni
				: undefined,
		rozsah: parseCalendarRange(s.rozsah),
		datum: parseCalendarDate(s.datum),
	}),
});
const schrankaRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/schranka",
	component: () => <UkolyShell defaultTab="prichozi" />,
});
const hledatRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/hledat",
	component: Hledat,
});
const intakeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/prijem-prace",
	component: Intake,
	validateSearch: (s: Record<string, unknown>): { formular?: string } => ({
		formular: typeof s.formular === "string" ? s.formular : undefined,
	}),
});
const cileRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/cile",
	component: Cile,
	validateSearch: (s: Record<string, unknown>): { cil?: string; prostor?: string } => ({
		cil: typeof s.cil === "string" ? s.cil : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
	}),
});
const employeeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/zamestnanec",
	component: EmployeeHub,
});
const postupyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/postupy",
	component: Postupy,
	validateSearch: (
		s: Record<string, unknown>,
	): { postup?: string; prostor?: string; view?: "automation" } => ({
		postup: typeof s.postup === "string" ? s.postup : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
		view: s.view === "automation" ? "automation" : undefined,
	}),
});
const reportyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/reporty",
	component: Reporty,
	validateSearch: (
		s: Record<string, unknown>,
	): { tab?: string; clen?: string; prostor?: string } => ({
		tab: typeof s.tab === "string" ? s.tab : undefined,
		clen: typeof s.clen === "string" ? s.clen : undefined,
		prostor: typeof s.prostor === "string" ? s.prostor : undefined,
	}),
});

/** Dočasné routy pro nav cíle (nahradí je reálné obrazovky v dalších úkolech). */
const oblP1Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/oblibene/p1",
	component: () => <Oblibene mode="p1" />,
});
const oblMeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/oblibene/me",
	component: () => <Oblibene mode="me" />,
});

const routeTree = rootRoute.addChildren([
	prehledRoute,
	captureRoute,
	seznamyRoute,
	znalostiRoute,
	velinRoute,
	mailRoute,
	mitingyRoute,
	indexRoute,
	ukolyRoute,
	nadchRoute,
	schrankaRoute,
	hledatRoute,
	intakeRoute,
	cileRoute,
	employeeRoute,
	reportyRoute,
	postupyRoute,
	projektyRoute,
	nastaveniRoute,
	oblP1Route,
	oblMeRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
