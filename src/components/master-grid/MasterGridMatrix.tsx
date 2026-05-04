/**
 * Matrix renderer for the master grid.
 *
 * Layout: sticky position-code column on the left, scrollable carrier-grouped
 * product columns. Plain DOM, no virtualization.
 *
 * SCALE NOTE: current scale ~380 cells (Life: 10 positions × 38 products) renders
 * fine with plain DOM. If a tenant's grid grows past ~1500 cells (e.g., 3-5x the
 * Agora baseline of carriers/products), consider react-window for the body rows.
 */

import { useMemo } from "react";
import type {
  GridCarrier, GridPosition, GridProduct, GridRate,
} from "@/hooks/useMasterGrid";
import { RateCell } from "./RateCell";

type Props = {
  positions: GridPosition[];
  carriers: GridCarrier[];
  products: GridProduct[];
  rates: GridRate[];
  onCommitted: () => void;
};

export function MasterGridMatrix({ positions, carriers, products, rates, onCommitted }: Props) {
  // products grouped by carrier_id, in carrier order then product order
  const carrierGroups = useMemo(() => {
    const carrierById = new Map(carriers.map((c) => [c.id, c]));
    const byCarrier = new Map<string, GridProduct[]>();
    for (const p of products) {
      if (!carrierById.has(p.carrier_id)) continue;
      const arr = byCarrier.get(p.carrier_id) ?? [];
      arr.push(p);
      byCarrier.set(p.carrier_id, arr);
    }
    return carriers
      .map((c) => ({ carrier: c, products: byCarrier.get(c.id) ?? [] }))
      .filter((g) => g.products.length > 0);
  }, [carriers, products]);

  const rateMap = useMemo(() => {
    const m = new Map<string, GridRate>();
    for (const r of rates) m.set(`${r.position_id}:${r.product_id}`, r);
    return m;
  }, [rates]);

  if (positions.length === 0 || carrierGroups.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No positions or products to display. Add carriers and products in the Carriers &amp; Products tab.
      </div>
    );
  }

  const totalCols = carrierGroups.reduce((n, g) => n + g.products.length, 0);

  return (
    <div className="overflow-auto rounded-md border">
      <div
        className="grid text-xs"
        style={{
          gridTemplateColumns: `120px repeat(${totalCols}, minmax(80px, 1fr))`,
        }}
      >
        {/* Header row 1: empty + carrier names spanning their products */}
        <div className="sticky left-0 top-0 z-30 border-b border-r bg-card p-2"></div>
        {carrierGroups.map((g) => (
          <div
            key={`carrier-${g.carrier.id}`}
            className="sticky top-0 z-20 border-b border-l bg-card px-2 py-1 text-center font-medium"
            style={{ gridColumn: `span ${g.products.length}` }}
          >
            {g.carrier.carrier_name}
          </div>
        ))}

        {/* Header row 2: position-code label + product names */}
        <div className="sticky left-0 top-[33px] z-30 border-b border-r bg-card p-2 text-[10px] uppercase text-muted-foreground">
          Position
        </div>
        {carrierGroups.flatMap((g) =>
          g.products.map((p, pi) => (
            <div
              key={`prod-${p.id}`}
              className={`sticky top-[33px] z-20 border-b bg-card px-1 py-1 text-center text-[10px] ${
                pi === 0 ? "border-l" : ""
              }`}
              title={p.product_variant ? `${p.product_name} (${p.product_variant})` : p.product_name}
            >
              <div className="line-clamp-2">{p.product_name}</div>
              {p.product_variant && (
                <div className="text-muted-foreground">{p.product_variant}</div>
              )}
            </div>
          )),
        )}

        {/* Body */}
        {positions.map((pos) => (
          <RowFragment
            key={pos.id}
            position={pos}
            carrierGroups={carrierGroups}
            rateMap={rateMap}
            onCommitted={onCommitted}
          />
        ))}
      </div>
    </div>
  );
}

function RowFragment({
  position, carrierGroups, rateMap, onCommitted,
}: {
  position: GridPosition;
  carrierGroups: { carrier: GridCarrier; products: GridProduct[] }[];
  rateMap: Map<string, GridRate>;
  onCommitted: () => void;
}) {
  const positionLabel = `${position.position_code} ${position.position_name}`;
  return (
    <>
      <div className="sticky left-0 z-10 border-b border-r bg-card p-2">
        <div className="font-mono text-[10px] text-muted-foreground">{position.position_code}</div>
        <div className="text-xs">{position.position_name}</div>
        {!position.is_commissioned && (
          <div className="text-[9px] text-muted-foreground">non-commissioned</div>
        )}
      </div>
      {carrierGroups.flatMap((g) =>
        g.products.map((prod, pi) => {
          const r = rateMap.get(`${position.id}:${prod.id}`);
          return (
            <div
              key={`${position.id}-${prod.id}`}
              className={`border-b ${pi === 0 ? "border-l" : ""}`}
            >
              <RateCell
                positionId={position.id}
                positionLabel={positionLabel}
                productId={prod.id}
                productLabel={
                  prod.product_variant ? `${prod.product_name} (${prod.product_variant})` : prod.product_name
                }
                currentRate={r ? r.commission_pct : null}
                currentScheduleCode={r?.schedule_code ?? null}
                isCommissioned={position.is_commissioned}
                onCommitted={onCommitted}
              />
            </div>
          );
        }),
      )}
    </>
  );
}
