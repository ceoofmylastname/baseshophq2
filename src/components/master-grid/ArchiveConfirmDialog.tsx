import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase-browser";

type Props = {
  open: boolean;
  onClose: () => void;
  kind: "carrier" | "product";
  targetId: string;
  targetLabel: string;
  onArchived: () => Promise<void>;
};

export function ArchiveConfirmDialog({ open, onClose, kind, targetId, targetLabel, onArchived }: Props) {
  const [counts, setCounts] = useState<{ products?: number; rates?: number; policies?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setCounts(null);
      if (kind === "carrier") {
        const [{ count: products }, { count: rates }, { count: policies }] = await Promise.all([
          supabase.from("comp_grid_products").select("id", { count: "exact", head: true }).eq("carrier_id", targetId).eq("is_active", true),
          supabase
            .from("comp_grid_rates")
            .select("id, comp_grid_products!inner(carrier_id)", { count: "exact", head: true })
            .eq("comp_grid_products.carrier_id", targetId)
            .is("end_date", null),
          supabase
            .from("policies")
            .select("id", { count: "exact", head: true })
            .eq("carrier", targetLabel),
        ]);
        if (!cancelled) setCounts({ products: products ?? 0, rates: rates ?? 0, policies: policies ?? 0 });
      } else {
        const [{ count: rates }, { count: policies }] = await Promise.all([
          supabase.from("comp_grid_rates").select("id", { count: "exact", head: true }).eq("product_id", targetId).is("end_date", null),
          supabase.from("policies").select("id", { count: "exact", head: true }).eq("product_id", targetId),
        ]);
        if (!cancelled) setCounts({ rates: rates ?? 0, policies: policies ?? 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [open, kind, targetId, targetLabel]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onArchived();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {kind}</DialogTitle>
          <DialogDescription>
            Marks <span className="font-medium text-foreground">{targetLabel}</span> as inactive.
            History is preserved (existing rates, policies, and agent rates still resolve).
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          {counts === null ? (
            <p className="text-xs text-muted-foreground">Counting downstream usage…</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {kind === "carrier" && (
                <li>{counts.products ?? 0} active product(s) under this carrier</li>
              )}
              <li>{counts.rates ?? 0} active master grid rate(s)</li>
              <li>{counts.policies ?? 0} historical policy/policies referencing it</li>
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? "Archiving…" : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
