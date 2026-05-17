/**
 * Phase 18.4 — pure-module tests for the WelcomeModal trigger gate and step
 * state machine. Mirrors the password-banner-dismissal.test.ts pattern: no
 * React, no DOM, no Supabase — just the eligibility logic and transitions in
 * isolation.
 *
 * The hook (useWelcomeModalTrigger) and component (WelcomeModal) compose
 * these helpers; they are exercised manually in /home smoke per locked test
 * scope.
 */

import { describe, expect, test } from "bun:test";
import {
  isWelcomeModalSeen,
  nextStep,
  setWelcomeModalSeen,
  shouldShowWelcomeModal,
  welcomeModalSeenKey,
} from "../src/lib/welcome-modal-state";

/** Minimal in-memory Storage stand-in for tests. Matches the Pick<Storage>
 *  surfaces the pure helpers consume. */
function makeStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

// ---------------------------------------------------------------------------
// shouldShowWelcomeModal — triple-gate eligibility
// ---------------------------------------------------------------------------

describe("shouldShowWelcomeModal", () => {
  const eligibleBase = {
    isOwner: true,
    hasPassword: false as boolean | null,
    userId: "u_001",
    storage: makeStorage(),
  };

  test("all gates satisfied → true (the typical first-sign-in case)", () => {
    expect(shouldShowWelcomeModal(eligibleBase)).toBe(true);
  });

  test("not owner → false (agent invitees never see the modal)", () => {
    expect(shouldShowWelcomeModal({ ...eligibleBase, isOwner: false })).toBe(false);
  });

  test("hasPassword === true → false (user already finished setup)", () => {
    expect(shouldShowWelcomeModal({ ...eligibleBase, hasPassword: true })).toBe(false);
  });

  test("hasPassword === null (loading) → false (don't flash before resolution)", () => {
    expect(shouldShowWelcomeModal({ ...eligibleBase, hasPassword: null })).toBe(false);
  });

  test("no userId → false (pre-session bootstrap)", () => {
    expect(shouldShowWelcomeModal({ ...eligibleBase, userId: null })).toBe(false);
  });

  test("seen flag set in storage → false (dismissal persistence)", () => {
    const storage = makeStorage({ [welcomeModalSeenKey("u_001")]: "true" });
    expect(shouldShowWelcomeModal({ ...eligibleBase, storage })).toBe(false);
  });

  test("seen flag for a different user → still shows for current user", () => {
    const storage = makeStorage({ [welcomeModalSeenKey("u_other")]: "true" });
    expect(shouldShowWelcomeModal({ ...eligibleBase, storage })).toBe(true);
  });

  test("null storage (SSR / blocked) → treated as unseen, gate falls through", () => {
    expect(shouldShowWelcomeModal({ ...eligibleBase, storage: null })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// seen-flag round-trip
// ---------------------------------------------------------------------------

describe("welcome-modal seen persistence", () => {
  test("setWelcomeModalSeen + isWelcomeModalSeen round-trip", () => {
    const storage = makeStorage();
    expect(isWelcomeModalSeen("u_001", storage)).toBe(false);
    setWelcomeModalSeen("u_001", storage);
    expect(isWelcomeModalSeen("u_001", storage)).toBe(true);
  });

  test("seen flag is scoped per-user (shared device, multiple owners)", () => {
    const storage = makeStorage();
    setWelcomeModalSeen("u_001", storage);
    expect(isWelcomeModalSeen("u_001", storage)).toBe(true);
    expect(isWelcomeModalSeen("u_002", storage)).toBe(false);
  });

  test("storage throwing on getItem returns false (defensive, no crash)", () => {
    const throwing: Pick<Storage, "getItem"> = {
      getItem: () => { throw new Error("blocked by privacy mode"); },
    };
    expect(isWelcomeModalSeen("u_001", throwing)).toBe(false);
  });

  test("storage throwing on setItem is best-effort (no throw to caller)", () => {
    const throwing: Pick<Storage, "setItem"> = {
      setItem: () => { throw new Error("quota exceeded"); },
    };
    expect(() => setWelcomeModalSeen("u_001", throwing)).not.toThrow();
  });

  test("null storage is a noop (SSR / no-window)", () => {
    expect(isWelcomeModalSeen("u_001", null)).toBe(false);
    expect(() => setWelcomeModalSeen("u_001", null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// nextStep — three-step state machine
// ---------------------------------------------------------------------------

describe("nextStep state machine", () => {
  test("welcome + next → password (Get started CTA)", () => {
    expect(nextStep("welcome", "next")).toBe("password");
  });

  test("welcome + skip → close (Skip for now on step 1)", () => {
    expect(nextStep("welcome", "skip")).toBeNull();
  });

  test("password + next → done (called by onSuccess after save)", () => {
    expect(nextStep("password", "next")).toBe("done");
  });

  test("password + skip → close (Skip for now on step 2)", () => {
    expect(nextStep("password", "skip")).toBeNull();
  });

  test("done + next → close (Go to dashboard CTA)", () => {
    expect(nextStep("done", "next")).toBeNull();
  });

  test("close action from any step → close", () => {
    expect(nextStep("welcome", "close")).toBeNull();
    expect(nextStep("password", "close")).toBeNull();
    expect(nextStep("done", "close")).toBeNull();
  });
});
