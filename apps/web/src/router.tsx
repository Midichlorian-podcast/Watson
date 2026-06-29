import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { IconName } from "@watson/ui";
import { AppLayout } from "./layout/AppLayout";
import { Placeholder } from "./screens/Placeholder";
import { Today } from "./screens/Today";

const rootRoute = createRootRoute({ component: AppLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Today,
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
  stub("/nadchazejici", "nav.upcoming", "nadchazejici"),
  stub("/ukoly", "nav.tasks", "ukoly"),
  stub("/projekty", "nav.projects", "projekty"),
  stub("/cile", "nav.goals", "cile"),
  stub("/reporty", "nav.reports", "reporty"),
  stub("/postupy", "nav.flows", "postup"),
  stub("/oblibene/p1", "nav.priority1", "priorita"),
  stub("/oblibene/me", "nav.assignedToMe", "prirazeni"),
  stub("/nastaveni", "nav.settings", "nastaveni"),
];

const routeTree = rootRoute.addChildren([indexRoute, ...stubRoutes]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
