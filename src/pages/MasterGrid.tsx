/**
 * Master Comp Grid management page (Phase 8). Three tabs:
 *   - Life Master Grid     positions × life products matrix
 *   - Annuity Master Grid  positions × annuity products matrix
 *   - Carriers & Products  CRUD for carriers + products (archive only, no delete)
 *
 * Owner-only route (gated in App.tsx via RequireOwner).
 *
 * Phase 8.6 follow-up tracked: positions editing surface (rename / sort_order /
 * archive / is_commissioned flip) is NOT in Phase 8 scope. Schema supports it
 * from Phase 1; no new RPCs needed; will land as a sibling tab or under
 * Settings.
 */

import { useState } from "react";
import { useMasterGrid } from "@/hooks/useMasterGrid";
import { MasterGridMatrix } from "@/components/master-grid/MasterGridMatrix";
import { MasterGridToolbar } from "@/components/master-grid/MasterGridToolbar";
import { CarriersProductsTab } from "@/components/master-grid/CarriersProductsTab";
import { cn } from "@/lib/utils";

type Tab = "life" | "annuity" | "carriers";

export function MasterGridPage() {
  const [tab, setTab] = useState<Tab>("life");

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Master Comp Grid</h1>
        <p className="text-sm text-muted-foreground">
          Tenant-wide commission rates by position × product. Edits propagate to all agents at the
          position who don't have an override on the product.
        </p>
      </header>

      <nav className="flex gap-1 border-b">
        <TabButton id="life" current={tab} onSelect={setTab}>Life</TabButton>
        <TabButton id="annuity" current={tab} onSelect={setTab}>Annuity</TabButton>
        <TabButton id="carriers" current={tab} onSelect={setTab}>Carriers &amp; products</TabButton>
      </nav>

      {tab === "life" && <GridTab type="life" />}
      {tab === "annuity" && <GridTab type="annuity" />}
      {tab === "carriers" && <CarriersProductsTab />}
    </div>
  );
}

function TabButton({
  id, current, onSelect, children,
}: {
  id: Tab; current: Tab; onSelect: (t: Tab) => void; children: React.ReactNode;
}) {
  const active = id === current;
  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        "border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function GridTab({ type }: { type: "life" | "annuity" }) {
  const { positions, carriers, products, rates, loading, error, refresh } = useMasterGrid(type);

  if (loading) return <p className="text-sm text-muted-foreground">Loading {type} grid…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-3">
      <MasterGridToolbar
        positions={positions}
        carriers={carriers}
        products={products}
        rates={rates}
        onAllCommitted={refresh}
      />
      <MasterGridMatrix
        positions={positions}
        carriers={carriers}
        products={products}
        rates={rates}
        onCommitted={refresh}
      />
      <p className="text-xs text-muted-foreground">
        {positions.length} position{positions.length === 1 ? "" : "s"} · {products.length} {type} product{products.length === 1 ? "" : "s"} ·{" "}
        {rates.length} active rate{rates.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
