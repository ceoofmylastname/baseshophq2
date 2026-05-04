import { useAuth } from "@/contexts/AuthContext";

export function DashboardPage() {
  const { currentAgent, tenant } = useAuth();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome back, {currentAgent?.first_name ?? currentAgent?.email}.
      </p>
      <p className="text-sm text-muted-foreground">
        Tenant: <span className="font-mono">{tenant?.slug}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        Phase 5 placeholder. Real dashboard ships in a later phase.
      </p>
    </div>
  );
}
