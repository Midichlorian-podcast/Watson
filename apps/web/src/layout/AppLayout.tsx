import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BulkBar } from "../components/BulkBar";
import { ContextMenuProvider } from "../components/ContextMenu";
import { SyncGate } from "../components/Loading";
import { TrustStateBanner, TrustStateProvider } from "../components/TrustState";
import { AddTaskProvider } from "../lib/addTask";
import { BulkSelectProvider } from "../lib/bulkSelect";
import { KeyboardProvider } from "../lib/keyboard";
import { ListSearchProvider } from "../lib/listSearch";
import { ProjectDetailProvider } from "../lib/projectDetail";
import { RowMetaProvider } from "../lib/rowMeta";
import { storageGet, storageSet } from "../lib/storage";
import { TaskDetailProvider } from "../lib/taskDetail";
import { ActionToast } from "../lib/toast";
import { applyTweaks } from "../lib/tweaks";
import { useIsMobile } from "../lib/useIsMobile";
import { ViewModeProvider } from "../lib/viewMode";
import { WatsonProvider } from "../lib/watson";
import { WindowContextProvider } from "../lib/windowContext";
import { registerWindowPresence } from "../lib/windowCoordinator";
import { resolveWindowShell, windowSurfaceForPath } from "../lib/windowSurfaces";
import { WorkspaceProvider } from "../lib/workspace";
import { MailBridgeProvider } from "../mail/bridge";
import { FocusWindowHeader } from "./FocusWindowHeader";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";
import { Sidebar } from "./Sidebar";
import { useTheme } from "./useTheme";

// Těžké detailní overlaye se stáhnou až při prvním použití. Shell a Můj den tak
// neplatí cenu editorů komentářů, milníků a příloh při každém startu aplikace.
const TaskDetailPanel = lazy(() =>
	import("../components/TaskDetailPanel").then((module) => ({ default: module.TaskDetailPanel })),
);
const ProjectDetailPanel = lazy(() =>
	import("../components/ProjectDetailPanel").then((module) => ({
		default: module.ProjectDetailPanel,
	})),
);

export function AppLayout() {
	// Každé okno, včetně focus/wallboard bez běžného Headeru, poslouchá změnu motivu.
	useTheme();
	// Sbalení sidebaru se persistuje (prototyp toggleRail + persist, ř. 2580).
	const [collapsed, setCollapsed] = useState(() => storageGet("watson.rail") === "1");
	const isMobile = useIsMobile();
	// Mail zabírá celou plochu MAIN místo topbaru (prototyp screenNotMail, ř. 357).
	const location = useRouterState({ select: (state) => state.location });
	const path = location.pathname;
	const requestedShell = (location.search as Record<string, unknown>).shell;
	const shell = resolveWindowShell(path, requestedShell);
	const surface = windowSurfaceForPath(path);
	const targetWorkspace = (location.search as Record<string, unknown>).prostor;
	const focusShell = shell !== "app";
	const onMail = path.startsWith("/mail");
	// Výchozí obrazovka po startu (prototyp prop vychoziObrazovka: Přehled | Dnes) —
	// jen při prvním načtení na "/", volba v Nastavení (watson.landing).
	const navigate = useNavigate();
	const landed = useRef(false);
	useEffect(() => {
		if (landed.current || focusShell) return;
		landed.current = true;
		if (window.location.pathname === "/" && storageGet("watson.landing") === "prehled") {
			void navigate({ to: "/prehled", replace: true });
		}
	}, [navigate, focusShell]);
	useEffect(applyTweaks, []);
	useEffect(() => {
		if (!focusShell) storageSet("watson.rail", collapsed ? "1" : "0");
	}, [collapsed, focusShell]);
	useEffect(
		() =>
			registerWindowPresence({
				shell,
				surface: surface?.id ?? null,
				path,
			}),
		[shell, surface?.id, path],
	);
	return (
		<WindowContextProvider shell={shell} surface={surface?.id ?? null}>
			<WorkspaceProvider
				initialWorkspaceId={typeof targetWorkspace === "string" ? targetWorkspace : null}
				persist={!focusShell}
			>
				<TrustStateProvider>
					<RowMetaProvider>
						<ViewModeProvider>
							<ListSearchProvider>
								<AddTaskProvider>
									<TaskDetailProvider>
										<ProjectDetailProvider>
											<BulkSelectProvider>
												<MailBridgeProvider>
													<WatsonProvider>
														<KeyboardProvider>
															<ContextMenuProvider>
																<div
																	className="flex h-full min-h-full"
																	style={{ background: "var(--w-paper)" }}
																>
																	{!focusShell && !isMobile && (
																		<Sidebar
																			collapsed={collapsed}
																			onToggle={() => setCollapsed((c) => !c)}
																		/>
																	)}
																	<div className="flex min-w-0 flex-1 flex-col">
																		{focusShell ? (
																			<FocusWindowHeader shell={shell} />
																		) : (
																			!onMail && <Header />
																		)}
																		<TrustStateBanner />
																		<main
																			className={
																				onMail
																					? "flex flex-1 flex-col overflow-hidden"
																					: "flex-1 overflow-auto"
																			}
																			// MobileTabBar roste o safe-area (home indikátor) — main musí rezervovat
																			// stejnou výšku, jinak zůstane spodní obsah schovaný za lištou.
																			style={
																				isMobile && !focusShell
																					? {
																							paddingBottom:
																								"calc(58px + env(safe-area-inset-bottom))",
																						}
																					: undefined
																			}
																		>
																			<SyncGate>
																				<Suspense fallback={null}>
																					<Outlet />
																				</Suspense>
																			</SyncGate>
																		</main>
																	</div>
																	{!focusShell && isMobile && <MobileTabBar />}
																	<ActionToast />
																	<Suspense fallback={null}>
																		<TaskDetailPanel />
																		<ProjectDetailPanel />
																	</Suspense>
																	{shell !== "wallboard" && <BulkBar />}
																</div>
															</ContextMenuProvider>
														</KeyboardProvider>
													</WatsonProvider>
												</MailBridgeProvider>
											</BulkSelectProvider>
										</ProjectDetailProvider>
									</TaskDetailProvider>
								</AddTaskProvider>
							</ListSearchProvider>
						</ViewModeProvider>
					</RowMetaProvider>
				</TrustStateProvider>
			</WorkspaceProvider>
		</WindowContextProvider>
	);
}
