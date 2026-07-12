import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { lazy } from "react";
import { AppLayout } from "./layout/AppLayout";
// Core obrazovky (navštěvované pořád) = eager. Ostatní = code-split přes lazy() → menší main chunk
// (Suspense boundary je kolem <Outlet/> v AppLayout).
import { Nadchazejici } from "./screens/Nadchazejici";
import { parseTab, type TaskTab, UkolyShell } from "./screens/UkolyShell";

// biome-ignore lint/suspicious/noExplicitAny: obrazovky nemají props; any tu jen sjednotí lazy typ
const named = <K extends string>(
	loader: () => Promise<Record<K, React.ComponentType<any>>>,
	key: K,
) => lazy(() => loader().then((m) => ({ default: m[key] })));

const Cile = named(() => import("./screens/Cile"), "Cile");
const Hledat = named(() => import("./screens/Hledat"), "Hledat");
const Prehled = named(() => import("./screens/Prehled"), "Prehled");
const Seznamy = named(() => import("./screens/Seznamy"), "Seznamy");
const Velin = named(() => import("./screens/Velin"), "Velin");
const Mail = named(() => import("./screens/Mail"), "Mail");
const Mitingy = named(() => import("./screens/Mitingy"), "Mitingy");
const Nastaveni = named(() => import("./screens/Nastaveni"), "Nastaveni");
const Postupy = named(() => import("./screens/Postupy"), "Postupy");
const Projekty = named(() => import("./screens/Projekty"), "Projekty");
const Reporty = named(() => import("./screens/Reporty"), "Reporty");
const Schranka = named(() => import("./screens/Schranka"), "Schranka");
const Oblibene = lazy(() => import("./screens/Oblibene").then((m) => ({ default: m.Oblibene })));

const rootRoute = createRootRoute({ component: AppLayout });

const prehledRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/prehled",
	component: Prehled,
});
const seznamyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/seznamy",
	component: Seznamy,
	validateSearch: (s: Record<string, unknown>): { seznam?: string } => ({
		seznam: typeof s.seznam === "string" ? s.seznam : undefined,
	}),
});
const velinRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/velin",
	component: Velin,
});
const mailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail",
	component: Mail,
});
const mitingyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/meets",
	component: Mitingy,
});
// „/" = domovská routa sloučeného modulu Úkoly → záložka Dnes (zachovává landing redirect
// watson.landing v AppLayout). `?tab=` umí přepnout i tady, default = dnes.
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: () => <UkolyShell defaultTab="dnes" />,
	validateSearch: (s: Record<string, unknown>): { tab?: TaskTab } => ({
		tab: parseTab(s.tab),
	}),
});
const ukolyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/ukoly",
	component: () => <UkolyShell defaultTab="vse" />,
	validateSearch: (
		s: Record<string, unknown>,
	): { projekt?: string; ukol?: string; tab?: TaskTab } => ({
		projekt: typeof s.projekt === "string" ? s.projekt : undefined,
		// deep-link z „Kopírovat odkaz" — otevře detail úkolu
		ukol: typeof s.ukol === "string" ? s.ukol : undefined,
		// aktivní záložka modulu (dnes | vse | zasobnik); default vse na /ukoly
		tab: parseTab(s.tab),
	}),
});
const projektyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projekty",
	component: Projekty,
});
const nastaveniRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/nastaveni",
	component: Nastaveni,
});
const nadchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/nadchazejici",
	component: Nadchazejici,
});
const schrankaRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/schranka",
	component: Schranka,
});
const hledatRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/hledat",
	component: Hledat,
});
const cileRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/cile",
	component: Cile,
});
const postupyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/postupy",
	component: Postupy,
	validateSearch: (s: Record<string, unknown>): { postup?: string } => ({
		postup: typeof s.postup === "string" ? s.postup : undefined,
	}),
});
const reportyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/reporty",
	component: Reporty,
	validateSearch: (s: Record<string, unknown>): { tab?: string; clen?: string } => ({
		tab: typeof s.tab === "string" ? s.tab : undefined,
		clen: typeof s.clen === "string" ? s.clen : undefined,
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
	seznamyRoute,
	velinRoute,
	mailRoute,
	mitingyRoute,
	indexRoute,
	ukolyRoute,
	nadchRoute,
	schrankaRoute,
	hledatRoute,
	cileRoute,
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
