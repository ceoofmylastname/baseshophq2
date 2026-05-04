import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { POLICY_BUCKETS, POLICY_STATUS_VALUES, type PolicyBucket, type PolicyStatus } from "@/lib/policy-bucket";
import type { Filters } from "@/hooks/useBookOfBusiness";

type CarrierOption = { id: string; carrier_name: string };

type Props = { value: Filters; onChange: (next: Filters) => void };

export function BookOfBusinessFilters({ value, onChange }: Props) {
  const tenant = useTenant();
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("comp_grid_carriers")
        .select("id, carrier_name")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("carrier_name");
      if (cancelled) return;
      setCarriers((data ?? []) as CarrierOption[]);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input
        type="search"
        placeholder="Search by client name or policy #…"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        className="h-9 max-w-xs"
      />
      <select
        value={value.status ?? ""}
        onChange={(e) => onChange({ ...value, status: (e.target.value || null) as PolicyStatus | null })}
        className="h-9 rounded-md border border-input bg-background px-2"
      >
        <option value="">All Statuses</option>
        {POLICY_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        value={value.bucket ?? ""}
        onChange={(e) => onChange({ ...value, bucket: (e.target.value || null) as PolicyBucket | null })}
        className="h-9 rounded-md border border-input bg-background px-2"
      >
        <option value="">All Buckets</option>
        {POLICY_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select
        value={value.carrierId ?? ""}
        onChange={(e) => onChange({ ...value, carrierId: e.target.value || null })}
        className="h-9 rounded-md border border-input bg-background px-2"
      >
        <option value="">All Carriers</option>
        {carriers.map((c) => <option key={c.id} value={c.id}>{c.carrier_name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox" checked={value.unassignedOnly}
          onChange={(e) => onChange({ ...value, unassignedOnly: e.target.checked })}
        />
        Show unassigned only
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox" checked={value.hasRisk}
          onChange={(e) => onChange({ ...value, hasRisk: e.target.checked })}
          disabled={value.unassignedOnly}
        />
        Has Risk
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox" checked={value.needsReview}
          onChange={(e) => onChange({ ...value, needsReview: e.target.checked })}
          disabled={value.unassignedOnly}
        />
        Needs Review
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="LOA Only ships when the carrier ingest pipeline populates policies.is_loa_at_writing">
        <input type="checkbox" disabled />
        LOA Only (coming soon)
      </label>
    </div>
  );
}
