import { Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { WriteRejectedToast } from "../components/WriteRejectedToast";
import { TaskDetailProvider } from "../lib/taskDetail";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <TaskDetailProvider>
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
      </div>
    </TaskDetailProvider>
  );
}
