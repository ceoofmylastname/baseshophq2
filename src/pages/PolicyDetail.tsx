/**
 * Phase 10B: single-policy drill-down page.
 *
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies              - status, premium, client edits to THIS policy
 *   policy_status_history - new audit rows on status change
 *   policy_commissions    - engine recalc results
 *   activity_events       - audit log filtered by metadata.policy_id
 */

import { Link, useParams } from "react-router-dom";
import { usePolicyDetail } from "@/hooks/usePolicyDetail";
import { PolicyDetailHeader } from "@/components/policy-detail/PolicyDetailHeader";
import { PolicyClientInfo } from "@/components/policy-detail/PolicyClientInfo";
import { PolicyFinancialSummary } from "@/components/policy-detail/PolicyFinancialSummary";
import { PolicyCommissionSplit } from "@/components/policy-detail/PolicyCommissionSplit";
import { PolicyStatusHistoryTimeline } from "@/components/policy-detail/PolicyStatusHistoryTimeline";
import { PolicyAuditLog } from "@/components/policy-detail/PolicyAuditLog";

export function PolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const { policy, commissions, history, activity, loading, error } = usePolicyDetail(policyId);

  if (loading) return <p className="text-sm text-muted-foreground">Loading policy…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!policy) {
    return (
      <div className="space-y-2">
        <Link to="/book-of-business" className="text-sm text-muted-foreground hover:underline">
          ← Back to Book of Business
        </Link>
        <p className="text-sm text-destructive">Policy not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link to="/book-of-business" className="text-sm text-muted-foreground hover:underline">
        ← Back to Book of Business
      </Link>

      <PolicyDetailHeader policy={policy} />
      <PolicyClientInfo policy={policy} />
      <PolicyFinancialSummary policy={policy} />
      <PolicyCommissionSplit rows={commissions} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PolicyStatusHistoryTimeline rows={history} />
        <PolicyAuditLog rows={activity} />
      </div>
    </div>
  );
}
