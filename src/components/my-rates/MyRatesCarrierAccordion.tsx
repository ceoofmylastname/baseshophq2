import { useState } from "react";
import type { AgentRateRow } from "@/hooks/useAgentRates";
import { Badge } from "@/components/ui/badge";

type Props = {
  carrierName: string;
  rows: AgentRateRow[];   // already sorted by parent
};

export function MyRatesCarrierAccordion({ carrierName, rows }: Props) {
  const [open, setOpen] = useState(true);
  const overrideCount = rows.filter((r) => r.source === "override").length;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
      >
        <span>{carrierName}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {overrideCount > 0 && (
            <span>
              {overrideCount} override{overrideCount === 1 ? "" : "s"}
            </span>
          )}
          <span>{rows.length} product{rows.length === 1 ? "" : "s"}</span>
          <span>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <ul className="divide-y">
          {rows.map((r) => {
            const productLabel = r.product_variant
              ? `${r.product_name} (${r.product_variant})`
              : r.product_name;
            return (
              <li key={r.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                <span className="flex-1">{productLabel}</span>
                <span className="font-medium tabular-nums">{Number(r.rate).toFixed(2)}%</span>
                {r.schedule_code && (
                  <span className="text-xs text-muted-foreground">({r.schedule_code})</span>
                )}
                {r.source === "override" ? (
                  <Badge variant="warning">Override</Badge>
                ) : (
                  <Badge variant="muted">Default</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
