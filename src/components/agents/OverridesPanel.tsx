import { useMemo, useState } from "react";
import type { AgentRateRow } from "@/hooks/useAgentRates";
import { RateRow } from "./RateRow";

type Props = {
  rows: AgentRateRow[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  onChanged: () => void;
};

type CarrierGroup = {
  carrier_id: string;
  carrier_name: string;
  product_type: "life" | "annuity";
  rows: AgentRateRow[];
};

export function OverridesPanel({ rows, loading, error, canEdit, onChanged }: Props) {
  const groups = useMemo<CarrierGroup[]>(() => {
    const map = new Map<string, CarrierGroup>();
    for (const r of rows) {
      const key = `${r.carrier_id}:${r.product_type}`;
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(r);
      } else {
        map.set(key, {
          carrier_id: r.carrier_id,
          carrier_name: r.carrier_name,
          product_type: r.product_type,
          rows: [r],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.product_type !== b.product_type) {
        return a.product_type === "life" ? -1 : 1;
      }
      return a.carrier_name.localeCompare(b.carrier_name);
    });
  }, [rows]);

  if (loading) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        Loading rates…
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No rates yet. Assign this agent to a position to template the master grid.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <CarrierAccordion key={`${g.carrier_id}-${g.product_type}`} group={g}>
          {g.rows.map((row) => (
            <RateRow key={row.id} row={row} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </CarrierAccordion>
      ))}
    </div>
  );
}

function CarrierAccordion({
  group,
  children,
}: {
  group: CarrierGroup;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const overrideCount = (group.rows as AgentRateRow[]).filter(
    (r) => r.source === "override",
  ).length;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
      >
        <span className="flex items-center gap-2">
          <span>{group.carrier_name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {group.product_type}
          </span>
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {overrideCount > 0 && <span>{overrideCount} override{overrideCount === 1 ? "" : "s"}</span>}
          <span>{group.rows.length} product{group.rows.length === 1 ? "" : "s"}</span>
          <span>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && <div className="px-4 pb-2">{children}</div>}
    </div>
  );
}
