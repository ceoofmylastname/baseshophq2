/**
 * Phase 18.1 — PasswordSetupBanner dismissal helper tests.
 *
 * Exercises the pure `isPasswordBannerDismissed()` helper + the exported
 * sessionStorage key constant. We stub a minimal sessionStorage in
 * globalThis so the helper runs outside the browser.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PASSWORD_BANNER_DISMISSED_KEY,
  isPasswordBannerDismissed,
} from "../src/lib/password-banner-dismissal";

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } satisfies Storage;
}

const g = globalThis as unknown as { sessionStorage: Storage | undefined };
let originalSessionStorage: Storage | undefined;

beforeEach(() => {
  originalSessionStorage = g.sessionStorage;
  g.sessionStorage = makeStorage();
});

afterEach(() => {
  g.sessionStorage = originalSessionStorage;
});

describe("PASSWORD_BANNER_DISMISSED_KEY", () => {
  test("is the locked v1 key string", () => {
    expect(PASSWORD_BANNER_DISMISSED_KEY).toBe("bsq_password_banner_dismissed_v1");
  });

  test("includes a version suffix to enable forward-compat resets", () => {
    expect(PASSWORD_BANNER_DISMISSED_KEY).toMatch(/_v\d+$/);
  });
});

describe("isPasswordBannerDismissed", () => {
  test("returns false when sessionStorage is empty", () => {
    expect(isPasswordBannerDismissed()).toBe(false);
  });

  test('returns true when key is set to "1"', () => {
    g.sessionStorage!.setItem(PASSWORD_BANNER_DISMISSED_KEY, "1");
    expect(isPasswordBannerDismissed()).toBe(true);
  });

  test('returns false for any value other than "1"', () => {
    g.sessionStorage!.setItem(PASSWORD_BANNER_DISMISSED_KEY, "true");
    expect(isPasswordBannerDismissed()).toBe(false);
    g.sessionStorage!.setItem(PASSWORD_BANNER_DISMISSED_KEY, "0");
    expect(isPasswordBannerDismissed()).toBe(false);
    g.sessionStorage!.setItem(PASSWORD_BANNER_DISMISSED_KEY, "");
    expect(isPasswordBannerDismissed()).toBe(false);
  });

  test("returns false after removing the key", () => {
    g.sessionStorage!.setItem(PASSWORD_BANNER_DISMISSED_KEY, "1");
    expect(isPasswordBannerDismissed()).toBe(true);
    g.sessionStorage!.removeItem(PASSWORD_BANNER_DISMISSED_KEY);
    expect(isPasswordBannerDismissed()).toBe(false);
  });

  test("returns false after clear()", () => {
    g.sessionStorage!.setItem(PASSWORD_BANNER_DISMISSED_KEY, "1");
    g.sessionStorage!.clear();
    expect(isPasswordBannerDismissed()).toBe(false);
  });

  test("returns false (does not throw) when sessionStorage is undefined", () => {
    g.sessionStorage = undefined;
    expect(() => isPasswordBannerDismissed()).not.toThrow();
    expect(isPasswordBannerDismissed()).toBe(false);
  });

  test("does not leak the key value as a side effect of reading", () => {
    expect(isPasswordBannerDismissed()).toBe(false);
    expect(g.sessionStorage!.getItem(PASSWORD_BANNER_DISMISSED_KEY)).toBeNull();
  });
});
