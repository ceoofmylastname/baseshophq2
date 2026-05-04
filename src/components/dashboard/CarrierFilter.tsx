import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

type Props = { value: string | null; onChange: (id: string | null) => void };

type CarrierOption = { id: string; carrier_name: string; product_type: string };

export function CarrierFilter({ value, onChange }: Props) {
  const tenant = useTenant();
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("comp_grid_carriers")
        .select("id, carrier_name, product_type")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("carrier_name");
      if (cancelled) return;
      setCarriers((data ?? []) as CarrierOption[]);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-xs uppercase text-muted-foreground">Carrier</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">All carriers</option>
        {carriers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.carrier_name} ({c.product_type})
          </option>
        ))}
      </select>
    </div>
  );
}
