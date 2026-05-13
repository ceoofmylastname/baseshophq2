import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = { children: React.ReactNode };

/**
 * Public route guard.
 *
 * If the user is logged in, redirect them to /home (the app entry point).
 * If they are not logged in, render the children (the public marketing page).
 *
 * Used to route "/" so authenticated visitors don't see the marketing
 * landing on every reload, but anonymous visitors see the public homepage.
 *
 * While the auth check is loading, render nothing — avoids a flash of the
 * marketing page for logged-in users on slow connections.
 */
export function PublicOrRedirect({ children }: Props) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/home" replace />;
  return <>{children}</>;
}
