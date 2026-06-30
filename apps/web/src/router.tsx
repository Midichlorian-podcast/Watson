import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { IconName } from "@watson/ui";
import { AppLayout } from "./layout/AppLayout";
import { Nadchazejici } from "./screens/Nadchazejici";
import { Nastaveni } from "./screens/Nastaveni";
import { Placeholder } from "./screens/Placeholder";
import { Projekty } from "./screens/Projekty";
import { Today } from "./screens/Today";
import { Ukoly } from "./screens/Ukoly";

const rootRoute = createRootRoute({ component: AppLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Today });
const ukolyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ukoly",
  component: Ukoly,
  validateSearch: (s: Record<string, unknown>): { projekt?: string } => ({
    projekt: typeof s.projekt === "string" ? s.projekt : undefined,
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

/** Dočasné routy pro nav cíle (nahradí je reálné obrazovky v dalších úkolech). */
const stub = (path: string, labelKey: string, icon: IconName) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <Placeholder labelKey={labelKey} icon={icon} />,
  });

const stubRoutes = [
  stub("/hledat", "nav.search", "hledat"),
  stub("/schranka", "nav.inbox", "schranka"),
  stub("/cile", "nav.goals", "cile"),
  stub("/reporty", "nav.reports", "reporty"),
  stub("/postupy", "nav.flows", "postup"),
  stub("/oblibene/p1", "nav.priority1", "priorita"),
  stub("/oblibene/me", "nav.assignedToMe", "prirazeni"),
];

const routeTree = rootRoute.addChildren([
  indexRoute,
  ukolyRoute,
  nadchRoute,
  projektyRoute,
  nastaveniRoute,
  ...stubRoutes,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
