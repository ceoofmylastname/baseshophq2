import { useNavigate } from "react-router-dom";
import { useBookOfBusiness } from "@/hooks/useBookOfBusiness";
import { useUpdatePolicyStatus } from "@/hooks/useUpdatePolicyStatus";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const fmtMoney = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function DraftsTab() {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const { update, submitting } = useUpdatePolicyStatus();
  const { rows, loading, refresh } = useBookOfBusiness({
    filters: {
      search: "", status: "Draft", bucket: null, carrierId: null,
      unassignedOnly: false, hasRisk: false, needsReview: false,
    },
    sortKey: "application_date",
    sortAsc: false,
  });

  async function promote(id: string) {
    await update(id, "Submitted");
    void refresh();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading drafts…</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No drafts. Use Post a Deal to create one.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {rows.map((r) => {
        const client = [r.client_first_name, r.client_last_name].filter(Boolean).join(" ") || "—";
        return (
          <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <button onClick={() => navigate(`/policy/${r.id}`)} className="flex-1 text-left">
              <p className="text-sm font-medium">{client}</p>
              <p className="text-xs text-muted-foreground">
                {r.carrier ?? "—"} · {r.product ?? "—"} · {r.policy_number} · {fmtMoney(r.annual_premium)}
              </p>
            </button>
            {isOwner && (
              <Button size="sm" onClick={() => void promote(r.id)} disabled={submitting}>
                Promote to Submitted
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
