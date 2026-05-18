/**
 * Phase 19.2 -- tests for filterAnnouncements.
 *
 * Pure-module tests, no DOM. Backs the Settings Announcements filter row
 * (pinned-only checkbox + search-by-title input). Verifies the predicate
 * obeys the locked filter shape without re-ordering input.
 */

import { describe, expect, test } from "bun:test";
import {
  filterAnnouncements,
  type AnnouncementFilter,
} from "../src/lib/announcements-filter";

type Row = { id: string; title: string; pinned: boolean };

const FIXTURES: Row[] = [
  { id: "1", title: "Welcome aboard, agents",   pinned: true  },
  { id: "2", title: "Vegas conference Friday",  pinned: false },
  { id: "3", title: "April Madness contest",    pinned: true  },
  { id: "4", title: "April newsletter sent",    pinned: false },
  { id: "5", title: "New product launch",       pinned: false },
];

const NONE: AnnouncementFilter = { pinnedOnly: false, searchTerm: "" };

describe("filterAnnouncements", () => {
  test("empty filter returns every row in input order", () => {
    expect(filterAnnouncements(FIXTURES, NONE).map((r) => r.id)).toEqual([
      "1", "2", "3", "4", "5",
    ]);
  });

  test("pinnedOnly returns only pinned rows", () => {
    const out = filterAnnouncements(FIXTURES, { pinnedOnly: true, searchTerm: "" });
    expect(out.map((r) => r.id)).toEqual(["1", "3"]);
  });

  test("searchTerm filters by case-insensitive title substring", () => {
    const out = filterAnnouncements(FIXTURES, { pinnedOnly: false, searchTerm: "april" });
    expect(out.map((r) => r.id)).toEqual(["3", "4"]);
  });

  test("searchTerm is trimmed before matching", () => {
    const out = filterAnnouncements(FIXTURES, { pinnedOnly: false, searchTerm: "  vegas  " });
    expect(out.map((r) => r.id)).toEqual(["2"]);
  });

  test("pinnedOnly + searchTerm composes as logical AND", () => {
    const out = filterAnnouncements(FIXTURES, { pinnedOnly: true, searchTerm: "april" });
    expect(out.map((r) => r.id)).toEqual(["3"]);
  });

  test("empty input returns empty output", () => {
    expect(filterAnnouncements([], NONE)).toEqual([]);
  });

  test("searchTerm with no matches returns empty array", () => {
    expect(
      filterAnnouncements(FIXTURES, { pinnedOnly: false, searchTerm: "no-such-title-zzz" }),
    ).toEqual([]);
  });

  test("whitespace-only searchTerm behaves like empty (filter disabled)", () => {
    const out = filterAnnouncements(FIXTURES, { pinnedOnly: false, searchTerm: "   " });
    expect(out.length).toBe(FIXTURES.length);
  });

  test("does not reorder rows -- preserves caller-provided ordering", () => {
    // Server is expected to pinned-first the list; filter must not reshuffle.
    const reversed = [...FIXTURES].reverse();
    const out = filterAnnouncements(reversed, NONE);
    expect(out.map((r) => r.id)).toEqual(["5", "4", "3", "2", "1"]);
  });
});
