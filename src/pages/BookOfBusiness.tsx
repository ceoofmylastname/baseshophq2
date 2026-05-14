/**
 * Phase 10B: Book of Business — central policy ledger.
 *
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies              - row inserts/updates/deletes (book table refresh)
 *   policy_deletions_audit - audit row appears post-delete; future restore UX
 *
 * Inline status edit cascade (the proof point):
 *   1. Owner clicks status pill -> direct UPDATE policies SET status (RLS-gated)
 *   2. Phase 4a trigger policies_record_status_change -> INSERT policy_status_history
 *   3. Phase 4a trigger policies_recalc_on_issued -> recalculate_policy_payouts
 *      if status moves to/from Issued
 *   4. Phase 10A.1 trigger activity_log_policy_status_changed -> INSERT activity_events
 *   5. Frontend cascade: BookOfBusiness refreshes via policies channel,
 *      Dashboard metrics recompute, Recent Activity Feed adds row,
 *      open PolicyDetail tab updates all 4 sections via its own channel.
 */

import { useMemo, useState } from "react";
import { Upload, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBookOfBusiness, type Filters, type SortKey } from "@/hooks/useBookOfBusiness";
import { BookOfBusinessTable } from "@/components/book/BookOfBusinessTable";
import { BookOfBusinessFilters } from "@/components/book/BookOfBusinessFilters";
import { ColumnChooserDropdown, loadVisibleColumns, type ColumnKey } from "@/components/book/ColumnChooserDropdown";
import { BulkActionsBar } from "@/components/book/BulkActionsBar";
import { DraftsTab } from "@/components/book/DraftsTab";
import { PostDealModal } from "@/components/dashboard/PostDealModal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tab = "all" | "drafts";

const DEFAULT_FILTERS: Filters = {
  search: "", status: null, bucket: null, carrierId: null,
  unassignedOnly: false, hasRisk: false, needsReview: false,
  missingProduct: false,
};

export function BookOfBusinessPage() {
  const { isOwner } = useAuth();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("all");
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    missingProduct: searchParams.get("filter") === "missing_product",
  }));
  const [sortKey, setSortKey] = useState<SortKey>("application_date");
  const [sortAsc, setSortAsc] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => loadVisibleColumns());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [postOpen, setPostOpen] = useState(false);

  const { rows, loading, hasMore, loadMore, loadingMore, refresh } = useBookOfBusiness({
    filters, sortKey, sortAsc,
  });

  function onSortChange(key: SortKey) {
    if (key === sortKey) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function onToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function onToggleSelectAll() {
    setSelectedIds((prev) => {
      if (rows.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Book of Business</h1>
          <p className="text-sm text-muted-foreground">Policy ledger, sortable + filterable + inline-editable.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/ingest"><Upload className="mr-1 h-4 w-4" /> Import</Link>
            </Button>
          )}
          {isOwner && (
            <Button size="sm" onClick={() => setPostOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Post a deal
            </Button>
          )}
          <ColumnChooserDropdown visible={visibleColumns} onChange={setVisibleColumns} />
        </div>
      </header>

      <nav className="flex gap-1 border-b">
        <TabBtn active={tab === "all"} onClick={() => setTab("all")}>All policies</TabBtn>
        <TabBtn active={tab === "drafts"} onClick={() => setTab("drafts")}>Drafts</TabBtn>
      </nav>

      {tab === "all" ? (
        <>
          <BookOfBusinessFilters value={filters} onChange={setFilters} />

          <BookOfBusinessTable
            rows={rows}
            visibleColumns={visibleColumns}
            sortKey={sortKey}
            sortAsc={sortAsc}
            onSortChange={onSortChange}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onToggleSelectAll={onToggleSelectAll}
            loading={loading}
          />

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {rows.length} polic{rows.length === 1 ? "y" : "ies"} loaded{selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
            </p>
            {hasMore && (
              <Button size="sm" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>

          <BulkActionsBar
            selectedIds={Array.from(selectedIds)}
            onClearSelection={() => setSelectedIds(new Set())}
            onChanged={refresh}
          />
        </>
      ) : (
        <DraftsTab />
      )}

      <PostDealModal
        open={postOpen}
        onClose={() => setPostOpen(false)}
        onPosted={() => { setPostOpen(false); void refresh(); }}
      />
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-2 text-sm transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
