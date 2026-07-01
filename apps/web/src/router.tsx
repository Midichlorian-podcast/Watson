import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { IconName } from "@watson/ui";
import { AppLayout } from "./layout/AppLayout";
import { Cile } from "./screens/Cile";
import { Hledat } from "./screens/Hledat";
import { Nadchazejici } from "./screens/Nadchazejici";
import { Nastaveni } from "./screens/Nastaveni";
import { Placeholder } from "./screens/Placeholder";
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
const stub = <P extends string>(path: P, labelKey: string, icon: IconName) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <Placeholder labelKey={labelKey} icon={icon} />,
  });

const postupyStub = stub("/postupy", "nav.flows", "postup");
const oblP1Stub = stub("/oblibene/p1", "nav.priority1", "priorita");
const oblMeStub = stub("/oblibene/me", "nav.assignedToMe", "prirazeni");

const routeTree = rootRoute.addChildren([
  indexRoute,
  ukolyRoute,
  nadchRoute,
  schrankaRoute,
  hledatRoute,
  cileRoute,
  reportyRoute,
  projektyRoute,
  nastaveniRoute,
  postupyStub,
  oblP1Stub,
  oblMeStub,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
