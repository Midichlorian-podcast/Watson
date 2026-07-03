import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "./layout/AppLayout";
import { Cile } from "./screens/Cile";
import { Hledat } from "./screens/Hledat";
import { Nadchazejici } from "./screens/Nadchazejici";
import { Nastaveni } from "./screens/Nastaveni";
import { Oblibene } from "./screens/Oblibene";
import { Postupy } from "./screens/Postupy";
import { Projekty } from "./screens/Projekty";
import { Reporty } from "./screens/Reporty";
import { Schranka } from "./screens/Schranka";
import { Today } from "./screens/Today";
import { Ukoly } from "./screens/Ukoly";

const rootRoute = createRootRoute({ component: AppLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Today });
const ukolyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ukoly",
  component: Ukoly,
  validateSearch: (s: Record<string, unknown>): { projekt?: string; ukol?: string } => ({
    projekt: typeof s.projekt === "string" ? s.projekt : undefined,
    // deep-link z „Kopírovat odkaz" — otevře detail úkolu
    ukol: typeof s.ukol === "string" ? s.ukol : undefined,
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
