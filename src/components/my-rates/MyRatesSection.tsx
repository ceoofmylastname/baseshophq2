import { useMemo, useState } from "react";
import type { AgentRateRow } from "@/hooks/useAgentRates";
import type { SortMode } from "./MyRatesSearchSort";
import { MyRatesCarrierAccordion } from "./MyRatesCarrierAccordion";

type Props = {
  title: string;
  rows: AgentRateRow[];   // already filtered to one product_type
  sort: SortMode;
};

type CarrierGroup = { carrier_id: string; carrier_name: string; rows: AgentRateRow[] };

export function MyRatesSection({ title, rows, sort }: Props) {
  const [open, setOpen] = useState(true);

  const groups = useMemo<CarrierGroup[]>(() => {
    const m = new Map<string, CarrierGroup>();
    for (const r of rows) {
      const existing = m.get(r.carrier_id);
      if (existing) existing.rows.push(r);
      else m.set(r.carrier_id, { carrier_id: r.carrier_id, carrier_name: r.carrier_name, rows: [r] });
    }
    const list = Array.from(m.values());
    // Sort rows within each carrier
    for (const g of list) {
      if (sort === "rate_desc") g.rows.sort((a, b) => Number(b.rate) - Number(a.rate));
      else if (sort === "rate_asc") g.rows.sort((a, b) => Number(a.rate) - Number(b.rate));
      else g.rows.sort((a, b) => a.product_name.localeCompare(b.product_name));
    }
    // Sort carriers
    if (sort === "rate_desc") {
      list.sort((a, b) => Math.max(...b.rows.map((r) => Number(r.rate))) - Math.max(...a.rows.map((r) => Number(r.rate))));
    } else if (sort === "rate_asc") {
      list.sort((a, b) => Math.min(...a.rows.map((r) => Number(r.rate))) - Math.min(...b.rows.map((r) => Number(r.rate))));
    } else {
      list.sort((a, b) => a.carrier_name.localeCompare(b.carrier_name));
    }
    return list;
  }, [rows, sort]);

  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">
          ({rows.length} rate{rows.length === 1 ? "" : "s"} across {groups.length} carrier{groups.length === 1 ? "" : "s"})
        </span>
        <span className="ml-auto text-sm text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2">
          {groups.map((g) => (
            <MyRatesCarrierAccordion key={g.carrier_id} carrierName={g.carrier_name} rows={g.rows} />
          ))}
        </div>
      )}
    </section>
  );
}
