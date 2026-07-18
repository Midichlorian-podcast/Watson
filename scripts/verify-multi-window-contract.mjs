#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const surfaces = read("apps/web/src/lib/windowSurfaces.ts");
const context = read("apps/web/src/lib/windowContext.tsx");
const coordinator = read("apps/web/src/lib/windowCoordinator.ts");
const routing = read("apps/web/src/router.tsx");
const layout = read("apps/web/src/layout/AppLayout.tsx");
const focusHeader = read("apps/web/src/layout/FocusWindowHeader.tsx");
const header = read("apps/web/src/layout/Header.tsx");
const sidebar = read("apps/web/src/layout/Sidebar.tsx");
const workspace = read("apps/web/src/lib/workspace.tsx");
const powerSync = read("apps/web/src/lib/powersync/db.ts");
const app = read("apps/web/src/App.tsx");
const auth = read("apps/web/src/lib/auth-client.ts");
const mail = read("apps/web/src/mail/MailScreen.tsx");
const personalMail = read("apps/web/src/mail/usePersonalMail.ts");
const calendar = read("apps/web/src/components/Calendar.tsx");
const upcoming = read("apps/web/src/screens/Nadchazejici.tsx");
const tasks = read("apps/web/src/screens/Ukoly.tsx");
const overview = read("apps/web/src/screens/Prehled.tsx");
const commandCenter = read("apps/web/src/screens/Velin.tsx");
const notifications = read("apps/web/src/lib/notificationWindowRouting.ts");
const serviceWorker = read("apps/web/src/sw.ts");
const webPackage = read("apps/web/package.json");
const uiVerifier = read("apps/api/verify-information-architecture-ui.ts");

const focusIds = [...surfaces.matchAll(/id: "([^"]+)"[\s\S]{0,180}?focus: true/g)].map(
	(match) => match[1],
);
const wallboardIds = [...surfaces.matchAll(/id: "([^"]+)"[\s\S]{0,180}?wallboard: true/g)].map(
	(match) => match[1],
);

const requiredFocus = ["overview", "mail", "tasks", "upcoming", "lists", "command-center"];
const requiredWallboards = ["overview", "command-center"];

const checks = [
	[
		"registr povrchů explicitně povoluje domluvené focus a wallboard moduly",
		requiredFocus.every((id) => focusIds.includes(id)) &&
			requiredWallboards.every((id) => wallboardIds.includes(id)),
	],
	[
		"shell je uzavřený enum a nepodporovaný focus deep-link bezpečně spadne do app shellu",
		surfaces.includes('export const WINDOW_SHELLS = ["app", "focus", "wallboard"]') &&
			surfaces.includes('if (shell === "focus" && surface.focus)') &&
			surfaces.includes('if (shell === "wallboard" && surface.wallboard)') &&
			routing.includes('retainSearchParams<RootSearch>(["shell", "prostor"])') &&
			routing.includes('parseWindowShell(context.search.shell) === "app"') &&
			routing.includes("parseWindowShell(search.shell)"),
	],
	[
		"nebezpečné prohlížeče degradují na stejné okno podle stejné hranice jako PowerSync",
		surfaces.includes("supportsSafeMultiWindowData") &&
			surfaces.includes("typeof SharedWorker") &&
			surfaces.includes("window.location.assign(target)") &&
			powerSync.includes("enableMultiTabs: browserSupportsSafeMultiWindowData()"),
	],
	[
		"focus shell sdílí providery, ale skrývá globální chrome a nepřepisuje globální workspace",
		layout.includes("<WindowContextProvider") &&
			context.includes('isFocus: shell === "focus"') &&
			/persist=\{!focusShell\}/.test(layout) &&
			/\{!focusShell && !isMobile && \(\s*<Sidebar/.test(layout) &&
			/\{focusShell \? \(\s*<FocusWindowHeader/.test(layout) &&
			workspace.includes("initialWorkspaceId?: string | null") &&
			workspace.includes("persist?: boolean"),
	],
	[
		"focus chrome umožňuje návrat do plného Watsonu a ovládá adresovatelné task/calendar pohledy",
		focusHeader.includes("data-window-chrome={shell}") &&
			focusHeader.includes('openWatsonWindow(window.location.href, "app")') &&
			focusHeader.includes('surface?.id === "upcoming"') &&
			focusHeader.includes("selectView(option)"),
	],
	[
		"univerzální otevření existuje v hlavičce, sidebaru, připnutých projektech i uložených pohledech",
		header.includes("windowSurface?.focus") &&
			header.includes("windowSurface?.wallboard") &&
			sidebar.includes("const windowMenu =") &&
			sidebar.includes("pinnedProjects.map") &&
			sidebar.includes("pinnedViews.map") &&
			(sidebar.match(/onContextMenu=/g)?.length ?? 0) >= 6,
	],
	[
		"stav klíčových povrchů je v URL včetně workspace, pohledu, rozsahu a data",
		routing.includes("mailAccount?: string") &&
			routing.includes("mailMessage?: string") &&
			routing.includes('zobrazeni?: "list" | "board" | "calendar"') &&
			routing.includes("rozsah?: CalendarRange") &&
			routing.includes("datum?: string") &&
			mail.includes("mailAccount") &&
			calendar.includes("onNavigationChange") &&
			upcoming.includes("rozsah") &&
			tasks.includes("rozsah") &&
			overview.includes("rozlozeni") &&
			commandCenter.includes("firma"),
	],
	[
		"cross-window zprávy jsou verzované a validované; odhlášení i mail změny se propagují",
		coordinator.includes("version: 1") &&
			coordinator.includes("parseWindowMessage") &&
			coordinator.includes('"session-invalidated"') &&
			coordinator.includes('"mail-invalidated"') &&
			auth.includes('publishWindowEvent("session-invalidated"') &&
			personalMail.includes('publishWindowEvent("mail-invalidated"'),
	],
	[
		"background finalizace má právě jednoho leadera a start PowerSync je serializovaný",
		coordinator.includes("startLeaderTask") &&
			coordinator.includes("navigator as NavigatorWithLocks") &&
			coordinator.includes("canClaimLeaderLease") &&
			app.includes('startLeaderTask("attachment-finalization"') &&
			powerSync.includes("withCrossWindowLock(`powersync-init:"),
	],
	[
		"notifikace preferují přesný nebo kompatibilní povrch a nehijackují jiné focus okno",
		notifications.includes("notificationWindowPriority") &&
			notifications.includes("Number.POSITIVE_INFINITY") &&
			serviceWorker.includes("notificationWindowPriority") &&
			serviceWorker.includes("Number.isFinite(candidate.priority)") &&
			serviceWorker.includes(".sort((a, b) => a.priority - b.priority)"),
	],
	[
		"čisté jednotkové testy víceokenních kontraktů jsou součástí web testu",
		webPackage.includes("runWindowSurfaceTests") &&
			webPackage.includes("runWindowCoordinatorTests") &&
			webPackage.includes("runNotificationWindowRoutingTests"),
	],
	[
		"browser audit ověřuje souběžné povrchy v Chromiu a bezpečný same-window fallback ve WebKitu",
		uiVerifier.includes("verifyMultiWindowSurfaces") &&
			uiVerifier.includes("ia_ui_window_workspace_leak") &&
			uiVerifier.includes('shell: "wallboard"') &&
			uiVerifier.includes("data-window-chrome") &&
			uiVerifier.includes("chromium,webkit"),
	],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length) {
	console.error(`Multi-window contract failed: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("Multi-window contract: shared, isolated, coordinated and addressable.");
