import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ProjectDetailPanel } from "../components/ProjectDetailPanel";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { WriteRejectedToast } from "../components/WriteRejectedToast";
import { AddTaskProvider } from "../lib/addTask";
import { KeyboardProvider } from "../lib/keyboard";
import { ProjectDetailProvider } from "../lib/projectDetail";
import { TaskDetailProvider } from "../lib/taskDetail";
import { applyTweaks } from "../lib/tweaks";
import { useIsMobile } from "../lib/useIsMobile";
import { WatsonProvider } from "../lib/watson";
import { WorkspaceProvider } from "../lib/workspace";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();
  useEffect(applyTweaks, []);
  return (
    <WorkspaceProvider>
    <WatsonProvider>
      <AddTaskProvider>
        <TaskDetailProvider>
          <ProjectDetailProvider>
            <KeyboardProvider>
              <div className="flex h-full min-h-full" style={{ background: "var(--w-paper)" }}>
                {!isMobile && (
                  <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <Header />
                  <main
                    className="flex-1 overflow-auto"
                    style={isMobile ? { paddingBottom: 58 } : undefined}
                  >
                    <Outlet />
                  </main>
                </div>
                {isMobile && <MobileTabBar />}
                <WriteRejectedToast />
                <TaskDetailPanel />
                <ProjectDetailPanel />
              </div>
            </KeyboardProvider>
          </ProjectDetailProvider>
        </TaskDetailProvider>
      </AddTaskProvider>
    </WatsonProvider>
    </WorkspaceProvider>
  );
}
