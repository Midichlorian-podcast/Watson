import { Outlet, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { BulkBar } from "../components/BulkBar";
import { SyncGate } from "../components/Loading";
import { ProjectDetailPanel } from "../components/ProjectDetailPanel";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { WriteRejectedToast } from "../components/WriteRejectedToast";
import { AddTaskProvider } from "../lib/addTask";
import { BulkSelectProvider } from "../lib/bulkSelect";
import { MailProvider } from "../mail/state";
import { KeyboardProvider } from "../lib/keyboard";
import { ListSearchProvider } from "../lib/listSearch";
import { ProjectDetailProvider } from "../lib/projectDetail";
import { RowMetaProvider } from "../lib/rowMeta";
import { TaskDetailProvider } from "../lib/taskDetail";
import { ActionToast } from "../lib/toast";
import { applyTweaks } from "../lib/tweaks";
import { useIsMobile } from "../lib/useIsMobile";
import { ViewModeProvider } from "../lib/viewMode";
import { WatsonProvider } from "../lib/watson";
import { WorkspaceProvider } from "../lib/workspace";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
	// Sbalení sidebaru se persistuje (prototyp toggleRail + persist, ř. 2580).
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem("watson.rail") === "1",
	);
	const isMobile = useIsMobile();
	// Mail zabírá celou plochu MAIN místo topbaru (prototyp screenNotMail, ř. 357).
	const path = useRouterState({ select: (s) => s.location.pathname });
	const onMail = path.startsWith("/mail");
	useEffect(applyTweaks, []);
	useEffect(() => {
		localStorage.setItem("watson.rail", collapsed ? "1" : "0");
	}, [collapsed]);
	return (
		<WorkspaceProvider>
			<RowMetaProvider>
				<ViewModeProvider>
					<ListSearchProvider>
						<WatsonProvider>
							<AddTaskProvider>
								<TaskDetailProvider>
									<ProjectDetailProvider>
										<BulkSelectProvider>
											<MailProvider>
											<KeyboardProvider>
											<div
												className="flex h-full min-h-full"
												style={{ background: "var(--w-paper)" }}
											>
												{!isMobile && (
													<Sidebar
														collapsed={collapsed}
														onToggle={() => setCollapsed((c) => !c)}
													/>
												)}
												<div className="flex min-w-0 flex-1 flex-col">
													{!onMail && <Header />}
													<main
														className={
															onMail
																? "flex flex-1 flex-col overflow-hidden"
																: "flex-1 overflow-auto"
														}
														style={isMobile ? { paddingBottom: 58 } : undefined}
													>
														<SyncGate>
															<Suspense fallback={null}>
																<Outlet />
															</Suspense>
														</SyncGate>
													</main>
												</div>
												{isMobile && <MobileTabBar />}
												<WriteRejectedToast />
												<ActionToast />
												<TaskDetailPanel />
												<ProjectDetailPanel />
												<BulkBar />
											</div>
											</KeyboardProvider>
											</MailProvider>
										</BulkSelectProvider>
									</ProjectDetailProvider>
								</TaskDetailProvider>
							</AddTaskProvider>
						</WatsonProvider>
					</ListSearchProvider>
				</ViewModeProvider>
			</RowMetaProvider>
		</WorkspaceProvider>
	);
}
