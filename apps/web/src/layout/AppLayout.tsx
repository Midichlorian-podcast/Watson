import { Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { ProjectDetailPanel } from "../components/ProjectDetailPanel";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { WriteRejectedToast } from "../components/WriteRejectedToast";
import { AddTaskProvider } from "../lib/addTask";
import { ProjectDetailProvider } from "../lib/projectDetail";
import { TaskDetailProvider } from "../lib/taskDetail";
import { WatsonProvider } from "../lib/watson";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <WatsonProvider>
      <AddTaskProvider>
        <TaskDetailProvider>
          <ProjectDetailProvider>
        <div className="flex h-full min-h-full" style={{ background: "var(--w-paper)" }}>
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="flex-1 overflow-auto">
              <Outlet />
            </main>
          </div>
          <WriteRejectedToast />
          <TaskDetailPanel />
          <ProjectDetailPanel />
        </div>
          </ProjectDetailProvider>
        </TaskDetailProvider>
      </AddTaskProvider>
    </WatsonProvider>
  );
}
