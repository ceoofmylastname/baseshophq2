/**
 * Phase 18.1 — Pure dismissal helper for PasswordSetupBanner.
 *
 * Extracted from the component module so unit tests can exercise the
 * sessionStorage contract without pulling in supabase-browser / Vite
 * env vars / React. Keep this module dependency-free.
 */

export const PASSWORD_BANNER_DISMISSED_KEY = "bsq_password_banner_dismissed_v1";

export function isPasswordBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(PASSWORD_BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPasswordBannerDismissed(): void {
  try {
    sessionStorage.setItem(PASSWORD_BANNER_DISMISSED_KEY, "1");
  } catch {
    // Best-effort: if sessionStorage is unavailable the banner just
    // won't remember the dismissal across reloads. The user can dismiss
    // it again on the next view.
  }
}
