import { useMemo, useState } from "react";
import { useCarriersAndProducts, type Carrier, type Product } from "@/hooks/useCarriersAndProducts";
import { useCarrierProductMutations } from "@/hooks/useCarrierProductMutations";
import { useMasterGrid } from "@/hooks/useMasterGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddCarrierDialog } from "./AddCarrierDialog";
import { AddProductDialog } from "./AddProductDialog";
import { ArchiveConfirmDialog } from "./ArchiveConfirmDialog";

type ArchiveTarget =
  | { kind: "carrier"; id: string; label: string }
  | { kind: "product"; id: string; label: string };

export function CarriersProductsTab() {
  const { carriers, products, refresh } = useCarriersAndProducts();
  const { archiveCarrier, archiveProduct } = useCarrierProductMutations();
  // Need positions for the AddProductDialog "set across all" prompt
  const { positions: lifePositions } = useMasterGrid("life");

  const [openAddCarrier, setOpenAddCarrier] = useState(false);
  const [openAddProduct, setOpenAddProduct] = useState<{
    carrierId: string; carrierName: string; productType: "life" | "annuity";
  } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byCarrier = new Map<string, Product[]>();
    for (const p of products) {
      const arr = byCarrier.get(p.carrier_id) ?? [];
      arr.push(p);
      byCarrier.set(p.carrier_id, arr);
    }
    const lifeCarriers = carriers.filter((c) => c.product_type === "life");
    const annuityCarriers = carriers.filter((c) => c.product_type === "annuity");
    return { lifeCarriers, annuityCarriers, byCarrier };
  }, [carriers, products]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Carriers &amp; products</h2>
        <Button size="sm" onClick={() => setOpenAddCarrier(true)}>+ Add carrier</Button>
      </div>

      <CarrierSection
        title="Life carriers"
        carriers={groups.lifeCarriers}
        byCarrier={groups.byCarrier}
        expanded={expanded}
        onToggle={toggle}
        onAddProduct={(c) => setOpenAddProduct({ carrierId: c.id, carrierName: c.carrier_name, productType: "life" })}
        onArchiveCarrier={(c) => setArchiveTarget({ kind: "carrier", id: c.id, label: c.carrier_name })}
        onArchiveProduct={(p) => setArchiveTarget({
          kind: "product", id: p.id,
          label: `${p.product_name}${p.product_variant ? ` (${p.product_variant})` : ""}`,
        })}
      />

      <CarrierSection
        title="Annuity carriers"
        carriers={groups.annuityCarriers}
        byCarrier={groups.byCarrier}
        expanded={expanded}
        onToggle={toggle}
        onAddProduct={(c) => setOpenAddProduct({ carrierId: c.id, carrierName: c.carrier_name, productType: "annuity" })}
        onArchiveCarrier={(c) => setArchiveTarget({ kind: "carrier", id: c.id, label: c.carrier_name })}
        onArchiveProduct={(p) => setArchiveTarget({
          kind: "product", id: p.id,
          label: `${p.product_name}${p.product_variant ? ` (${p.product_variant})` : ""}`,
        })}
      />

      <AddCarrierDialog
        open={openAddCarrier}
        onClose={() => setOpenAddCarrier(false)}
        onCreated={() => void refresh()}
      />

      {openAddProduct && (
        <AddProductDialog
          open={!!openAddProduct}
          onClose={() => setOpenAddProduct(null)}
          carrierId={openAddProduct.carrierId}
          carrierName={openAddProduct.carrierName}
          productType={openAddProduct.productType}
          positions={lifePositions /* same set; positions are tenant-wide */}
          onCreated={() => void refresh()}
        />
      )}

      {archiveTarget && (
        <ArchiveConfirmDialog
          open={!!archiveTarget}
          onClose={() => setArchiveTarget(null)}
          kind={archiveTarget.kind}
          targetId={archiveTarget.id}
          targetLabel={archiveTarget.label}
          onArchived={async () => {
            const fn = archiveTarget.kind === "carrier" ? archiveCarrier : archiveProduct;
            const result = await fn(archiveTarget.id);
            if (!result.ok) throw new Error(result.errorMessage ?? "archive failed");
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function CarrierSection({
  title, carriers, byCarrier, expanded, onToggle, onAddProduct, onArchiveCarrier, onArchiveProduct,
}: {
  title: string;
  carriers: Carrier[];
  byCarrier: Map<string, Product[]>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onAddProduct: (c: Carrier) => void;
  onArchiveCarrier: (c: Carrier) => void;
  onArchiveProduct: (p: Product) => void;
}) {
  return (
    <div className="rounded-md border">
      <div className="border-b p-3 text-sm font-medium">{title}</div>
      {carriers.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No carriers yet.</p>
      ) : (
        <ul className="divide-y">
          {carriers.map((c) => {
            const carrierProducts = byCarrier.get(c.id) ?? [];
            const activeProducts = carrierProducts.filter((p) => p.is_active);
            const isExpanded = expanded.has(c.id);
            return (
              <li key={c.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => onToggle(c.id)} className="flex-1 text-left text-sm">
                    <span className="mr-2">{isExpanded ? "▾" : "▸"}</span>
                    {c.carrier_name}
                    {!c.is_active && <Badge variant="muted" className="ml-2">archived</Badge>}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({activeProducts.length} active product{activeProducts.length === 1 ? "" : "s"})
                    </span>
                  </button>
                  <Button size="sm" variant="outline" onClick={() => onAddProduct(c)} disabled={!c.is_active}>
                    + product
                  </Button>
                  {c.is_active && (
                    <Button size="sm" variant="ghost" onClick={() => onArchiveCarrier(c)}>
                      archive
                    </Button>
                  )}
                </div>
                {isExpanded && (
                  <ul className="mt-2 space-y-1 pl-6">
                    {carrierProducts.length === 0 && (
                      <li className="text-xs text-muted-foreground">No products under this carrier yet.</li>
                    )}
                    {carrierProducts.map((p) => (
                      <li key={p.id} className="flex items-center justify-between text-sm">
                        <span>
                          {p.product_name}
                          {p.product_variant && (
                            <span className="ml-1 text-xs text-muted-foreground">({p.product_variant})</span>
                          )}
                          {!p.is_active && <Badge variant="muted" className="ml-2">archived</Badge>}
                        </span>
                        {p.is_active && (
                          <Button size="sm" variant="ghost" onClick={() => onArchiveProduct(p)}>
                            archive
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
