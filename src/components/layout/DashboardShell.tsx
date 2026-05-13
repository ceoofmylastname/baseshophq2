import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function DashboardShell() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr]">
      <div className="row-span-2 border-r border-white/[0.06] glass-strong">
        <Sidebar />
      </div>
      <div className="border-b border-white/[0.06] glass-strong">
        <TopBar />
      </div>
      <main className="overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
