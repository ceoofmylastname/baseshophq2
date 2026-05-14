/**
 * Phase 13.x polish: surface policies excluded from production aggregations
 * because their product mapping is missing (product_id IS NULL).
 *
 * Production aggregates payouts via comp grid joins, which require a mapped
 * product. Rows without a product_id silently disappear from the math. This
 * banner makes the gap visible and points the user at the fix.
 */

import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useMissingProductCount } from "@/hooks/useMissingProductCount";

export function MissingProductBanner() {
  const { missingProduct, totalInScope, loading } = useMissingProductCount();
  if (loading || missingProduct === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 text-sm">
        <span className="font-medium">
          {missingProduct} of {totalInScope} policies are missing a product mapping and are not counted in Production totals.
        </span>{" "}
        <Link
          to="/book-of-business?filter=missing_product"
          className="font-medium underline-offset-2 hover:underline"
        >
          Fix in Book of Business →
        </Link>
      </div>
    </div>
  );
}
