/**
 * Phase 18.1 — useHasPassword
 *
 * Returns whether the current authenticated user has set a password on their
 * auth.users row. Used by:
 *   - <PasswordSetupBanner /> on /home (renders only when hasPassword === false).
 *   - <AccountSection /> in /settings (switches between "Set Your Password"
 *     and "Change Password" forms; the change branch keeps the manual
 *     current-password re-auth check from Phase 16.0).
 *
 * Backed by the public.auth_user_has_password(uuid) RPC (SECURITY DEFINER,
 * GRANT to authenticated, returns boolean only). The hook gates the call on
 * useAuth().session?.user.id being truthy so we never fire before AuthContext
 * has bootstrapped.
 *
 * Cache is a module-level Map keyed by user.id. refetch() evicts the entry
 * and re-queries — used by AccountSection after a successful password set so
 * the banner disappears and the form title flips to "Change Password" mode.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";

const hasPasswordCache: Map<string, boolean> = new Map();

/**
 * Test-only: clear the entire cache. Not exported from the package barrel.
 * Useful for unit tests that exercise the cache eviction path without
 * mounting the React tree.
 */
export function __resetHasPasswordCacheForTests(): void {
  hasPasswordCache.clear();
}

export type UseHasPasswordResult = {
  hasPassword: boolean | null;
  isLoading: boolean;
  refetch: () => void;
};

export function useHasPassword(): UseHasPasswordResult {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [hasPassword, setHasPassword] = useState<boolean | null>(() => {
    if (!userId) return null;
    return hasPasswordCache.has(userId) ? hasPasswordCache.get(userId)! : null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchValue = useCallback(async () => {
    if (!userId) {
      setHasPassword(null);
      return;
    }
    if (hasPasswordCache.has(userId)) {
      setHasPassword(hasPasswordCache.get(userId)!);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase.rpc("auth_user_has_password", {
      p_user_id: userId,
    });
    setIsLoading(false);
    if (error) {
      // Silent fallback: don't render the banner, don't flip the form title.
      // The user can still operate the existing change-password flow.
      setHasPassword(null);
      return;
    }
    const value = data === true;
    hasPasswordCache.set(userId, value);
    setHasPassword(value);
  }, [userId]);

  useEffect(() => {
    void fetchValue();
  }, [fetchValue]);

  const refetch = useCallback(() => {
    if (userId) {
      hasPasswordCache.delete(userId);
    }
    void fetchValue();
  }, [userId, fetchValue]);

  return { hasPassword, isLoading, refetch };
}
