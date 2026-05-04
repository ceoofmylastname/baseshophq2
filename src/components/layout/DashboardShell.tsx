import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function DashboardShell() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[60px_1fr]">
      <div className="row-span-2 border-r bg-card">
        <Sidebar />
      </div>
      <div className="border-b bg-card">
        <TopBar />
      </div>
      <main className="overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
