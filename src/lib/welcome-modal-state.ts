/**
 * Phase 18.4 — Pure trigger gate + step state machine for the WelcomeModal.
 *
 * Extracted from the component + hook so unit tests can exercise the
 * triple-gate eligibility logic and the step transitions without pulling in
 * React, supabase-browser, or window/localStorage. Keep this module
 * dependency-free.
 *
 * Mirrors the pattern of password-banner-dismissal.ts. Differences:
 *   - localStorage (not sessionStorage) — the welcome modal is a one-shot
 *     first-impression that should never reappear for the same user.
 *   - Per-user keying via the userId — different owners on a shared device
 *     each get their own first-run experience.
 */

export type WelcomeStep = "welcome" | "password" | "done";
export type WelcomeStepAction = "next" | "skip" | "close";

export function welcomeModalSeenKey(userId: string): string {
  return `welcome_modal_seen_${userId}`;
}

export function isWelcomeModalSeen(
  userId: string,
  storage: Pick<Storage, "getItem"> | null,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(welcomeModalSeenKey(userId)) === "true";
  } catch {
    return false;
  }
}

export function setWelcomeModalSeen(
  userId: string,
  storage: Pick<Storage, "setItem"> | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(welcomeModalSeenKey(userId), "true");
  } catch {
    // Best-effort: if storage is unavailable the modal will re-show on the
    // next page load. PasswordSetupBanner remains the safety net.
  }
}

export type ShouldShowArgs = {
  isOwner: boolean;
  hasPassword: boolean | null;
  userId: string | null;
  storage: Pick<Storage, "getItem"> | null;
};

/**
 * Triple-gate eligibility. All four conditions must hold:
 *   - signed-in user with an id (no session → never show)
 *   - isOwner (agent invitees never see this modal)
 *   - hasPassword === false (not loading, not already set)
 *   - storage flag absent (dismissal persistence)
 */
export function shouldShowWelcomeModal(args: ShouldShowArgs): boolean {
  if (!args.userId) return false;
  if (!args.isOwner) return false;
  if (args.hasPassword !== false) return false;
  if (isWelcomeModalSeen(args.userId, args.storage)) return false;
  return true;
}

/**
 * Three-step state machine. Returns the next step, or null to signal "close
 * the modal." The caller is responsible for setting the localStorage seen
 * flag at close time (regardless of which exit path was taken).
 */
export function nextStep(current: WelcomeStep, action: WelcomeStepAction): WelcomeStep | null {
  if (action === "skip" || action === "close") return null;
  if (current === "welcome") return "password";
  if (current === "password") return "done";
  return null;
}
