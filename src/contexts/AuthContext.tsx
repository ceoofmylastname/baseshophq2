/**
 * AuthProvider + hooks.
 *
 * On mount: hydrates session from Supabase, then queries the calling user's
 * agents row (joined with their tenant). Subscribes to onAuthStateChange so
 * sign-in / sign-out flows trigger a re-fetch.
 *
 * The agents query relies on the agents_select_self RLS policy added in the
 * Phase 5 migration (`id = auth.uid()`), which is OR'd with the standard
 * agents_select_visible policy. Either path grants visibility — the self
 * policy is the defensive fallback if the user is in a broken intermediate
 * state (e.g. signup edge function failed mid-transaction).
 *
 * If the agents row is missing despite the user being authenticated, the
 * provider sets `error` and the UI shows a "your account is missing" state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";

export type Agent = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_owner: boolean;
  status: "active" | "inactive" | "archived";
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "cancelled";
};

type AuthState = {
  session: Session | null;
  currentAgent: Agent | null;
  tenant: Tenant | null;
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgentAndTenant = useCallback(async (userId: string) => {
    const { data, error: err } = await supabase
      .from("agents")
      .select(
        "id, tenant_id, email, first_name, last_name, is_owner, status, tenants(id, name, slug, status)",
      )
      .eq("id", userId)
      .maybeSingle();

    if (err) {
      setError(err.message);
      setCurrentAgent(null);
      setTenant(null);
      return;
    }
    if (!data) {
      setError("No agent record found for the signed-in user.");
      setCurrentAgent(null);
      setTenant(null);
      return;
    }

    setError(null);
    const { tenants, ...agent } = data as Agent & { tenants: Tenant | Tenant[] | null };
    setCurrentAgent(agent);
    // PostgREST returns the joined row as either an object or a single-item array.
    const tenantRow = Array.isArray(tenants) ? tenants[0] ?? null : tenants;
    setTenant(tenantRow);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
    if (s?.user.id) {
      await loadAgentAndTenant(s.user.id);
    } else {
      setCurrentAgent(null);
      setTenant(null);
      setError(null);
    }
    setLoading(false);
  }, [loadAgentAndTenant]);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user.id) {
        void loadAgentAndTenant(s.user.id);
      } else {
        setCurrentAgent(null);
        setTenant(null);
        setError(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh, loadAgentAndTenant]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      currentAgent,
      tenant,
      isOwner: !!currentAgent?.is_owner,
      loading,
      error,
      signOut,
      refresh,
    }),
    [session, currentAgent, tenant, loading, error, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useCurrentAgent(): Agent | null {
  return useAuth().currentAgent;
}

export function useTenant(): Tenant | null {
  return useAuth().tenant;
}

export function useIsOwner(): boolean {
  return useAuth().isOwner;
}
