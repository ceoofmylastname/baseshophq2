import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

/**
 * Owner-only route guard. Silent redirect to /dashboard for non-owners.
 * Per Phase 5 design: nav doesn't show owner-only items to non-owners, so
 * the only path here is direct typing or a stale bookmark — no toast.
 */
export function RequireOwner({ children }: { children: ReactNode }) {
  const { isOwner, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isOwner) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
