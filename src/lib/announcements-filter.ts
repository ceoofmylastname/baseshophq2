/**
 * Phase 19.2 -- pure filter predicate for the Settings Announcements table.
 *
 * Backs the in-page filter row (pinned-only checkbox + search-by-title input).
 * Server-side ordering is already pinned-first via list_active_announcements();
 * this filter narrows that ordered list without reshuffling. Pure module, no
 * React or Supabase imports, so the predicate can be unit-tested in isolation.
 */

export type AnnouncementFilter = {
  /** Restrict to rows where pinned === true. */
  pinnedOnly: boolean;
  /** Case-insensitive substring match against title. Whitespace trimmed.
   *  Empty string disables the filter. */
  searchTerm: string;
};

export function filterAnnouncements<T extends { title: string; pinned: boolean }>(
  items: readonly T[],
  filter: AnnouncementFilter,
): T[] {
  const needle = filter.searchTerm.trim().toLowerCase();
  return items.filter((a) => {
    if (filter.pinnedOnly && !a.pinned) return false;
    if (needle.length > 0 && !a.title.toLowerCase().includes(needle)) return false;
    return true;
  });
}
