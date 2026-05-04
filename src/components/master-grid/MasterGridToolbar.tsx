import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SetColumnDialog } from "./SetColumnDialog";
import type { GridProduct, GridPosition, GridRate, GridCarrier } from "@/hooks/useMasterGrid";

type Props = {
  positions: GridPosition[];
  carriers: GridCarrier[];
  products: GridProduct[];
  rates: GridRate[];
  onAllCommitted: () => void;
};

export function MasterGridToolbar({ positions, carriers, products, rates, onAllCommitted }: Props) {
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null);

  const productOptions = useMemo(() => {
    const carrierById = new Map(carriers.map((c) => [c.id, c]));
    return products.map((p) => ({
      id: p.id,
      label: `${carrierById.get(p.carrier_id)?.carrier_name ?? "?"} · ${p.product_name}${
        p.product_variant ? ` (${p.product_variant})` : ""
      }`,
    }));
  }, [carriers, products]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">Set column ▾</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {productOptions.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => setOpen({ id: p.id, label: p.label })}
            >
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size="sm"
        disabled
        title="Bulk CSV import is deferred to Phase 8.5 (replace-vs-extend semantics + preview-before-commit)."
      >
        Import CSV (Phase 8.5)
      </Button>

      {open && (
        <SetColumnDialog
          open={!!open}
          onClose={() => setOpen(null)}
          productId={open.id}
          productLabel={open.label}
          positions={positions}
          rates={rates}
          onAllCommitted={onAllCommitted}
        />
      )}
    </div>
  );
}
