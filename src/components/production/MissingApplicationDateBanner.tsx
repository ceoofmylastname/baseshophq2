/**
 * Phase 10D polish: surface policies excluded from production aggregations.
 *
 * Production cards/charts/tables filter on policies.application_date. Rows
 * with NULL application_date silently disappear from the math, which makes
 * the page look wrong if Book of Business shows them anyway. This banner
 * makes the gap visible and points the user at the fix.
 */

import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useExcludedPolicyCount } from "@/hooks/useExcludedPolicyCount";

export function MissingApplicationDateBanner() {
  const { count, loading } = useExcludedPolicyCount();
  if (loading || count === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 text-sm">
        <span className="font-medium">
          {count === 1
            ? "1 policy excluded from these numbers."
            : `${count} policies excluded from these numbers.`}
        </span>{" "}
        <span className="text-amber-800/90 dark:text-amber-200/80">
          They have no application date, so they can't be bucketed into a time window.
        </span>{" "}
        <Link to="/book-of-business" className="font-medium underline-offset-2 hover:underline">
          Open Book of Business
        </Link>{" "}
        to add the missing dates.
      </div>
    </div>
  );
}
