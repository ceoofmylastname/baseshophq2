/**
 * Phase 18.4 — useWelcomeModalTrigger
 *
 * React adapter around the pure shouldShowWelcomeModal gate. Wires up the
 * three input sources (useAuth for isOwner + userId, useHasPassword for the
 * loading/false/true tristate, localStorage for dismissal persistence) and
 * exposes a markSeen() callback that writes the flag and forces a re-render.
 *
 * The pure helpers (welcome-modal-state.ts) carry the eligibility logic so
 * this hook stays a thin composition layer. Tests cover the pure module
 * directly; this hook is exercised manually in /home smoke.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPassword } from "@/hooks/useHasPassword";
import {
  isWelcomeModalSeen,
  setWelcomeModalSeen,
  shouldShowWelcomeModal,
} from "@/lib/welcome-modal-state";

export type UseWelcomeModalTriggerResult = {
  shouldShow: boolean;
  markSeen: () => void;
};

export function useWelcomeModalTrigger(): UseWelcomeModalTriggerResult {
  const { isOwner, session } = useAuth();
  const { hasPassword } = useHasPassword();
  const userId = session?.user?.id ?? null;

  // React mirror of the storage flag. The pure helper would re-read storage
  // on every render, but React won't re-render after a side-effect write
  // unless state changes — so we track the flag locally and bump it in
  // markSeen alongside the storage write.
  const [seen, setSeen] = useState<boolean>(() => {
    if (!userId) return false;
    if (typeof window === "undefined") return false;
    return isWelcomeModalSeen(userId, window.localStorage);
  });

  // Re-sync when the signed-in user changes (sign-out + sign-in to a
  // different account on the same device).
  useEffect(() => {
    if (!userId || typeof window === "undefined") {
      setSeen(false);
      return;
    }
    setSeen(isWelcomeModalSeen(userId, window.localStorage));
  }, [userId]);

  // Pass storage: null so the pure helper skips its own seen-flag check;
  // the React-mirrored `seen` below is the source of truth at render time.
  const baseEligible = shouldShowWelcomeModal({
    isOwner,
    hasPassword,
    userId,
    storage: null,
  });
  const shouldShow = baseEligible && !seen;

  const markSeen = useCallback(() => {
    if (!userId) return;
    if (typeof window !== "undefined") {
      setWelcomeModalSeen(userId, window.localStorage);
    }
    setSeen(true);
  }, [userId]);

  return { shouldShow, markSeen };
}
