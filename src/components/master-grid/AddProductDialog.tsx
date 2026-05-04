import { useState, type FormEvent } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCarrierProductMutations } from "@/hooks/useCarrierProductMutations";
import { useSetMasterGridRate } from "@/hooks/useSetMasterGridRate";
import type { GridPosition } from "@/hooks/useMasterGrid";

type Props = {
  open: boolean;
  onClose: () => void;
  carrierId: string;
  carrierName: string;
  productType: "life" | "annuity";
  positions: GridPosition[]; // commissioned positions in the tenant
  onCreated: () => void;
};

export function AddProductDialog({
  open, onClose, carrierId, carrierName, productType, positions, onCreated,
}: Props) {
  const { addProduct, submitting } = useCarrierProductMutations();
  const { setRate } = useSetMasterGridRate();
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("");
  const [hasBonus, setHasBonus] = useState(false);
  const [setAcrossMode, setSetAcrossMode] = useState<"none" | "flat">("none");
  const [flatRate, setFlatRate] = useState("");
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commissioned = positions.filter((p) => p.is_commissioned);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const created = await addProduct({
      carrierId,
      productName: name.trim(),
      productVariant: variant.trim() || null,
      productType,
      hasBonusColumn: hasBonus,
    });
    if (!created.ok) { setError(created.errorMessage); return; }

    if (setAcrossMode === "flat" && flatRate !== "") {
      const n = Number(flatRate);
      if (Number.isNaN(n) || n < 0 || n > 200) {
        setError("Set-across rate must be 0-200%. Product was created; rates not set.");
        onCreated();
        return;
      }
      setBusyMsg(`Setting rate across ${commissioned.length} positions…`);
      const today = new Date().toISOString().slice(0, 10);
      for (const pos of commissioned) {
        const r = await setRate({
          positionId: pos.id, productId: created.id, newRate: n, scheduleCode: null, effective: today,
        });
        if (!r.ok) {
          setError(`Failed to set rate at ${pos.position_code}: ${r.errorMessage}`);
          setBusyMsg(null);
          onCreated();
          return;
        }
      }
      setBusyMsg(null);
    }

    onCreated();
    reset();
    onClose();
  }

  function reset() {
    setName(""); setVariant(""); setHasBonus(false);
    setSetAcrossMode("none"); setFlatRate(""); setError(null); setBusyMsg(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add product under {carrierName}</DialogTitle>
          <DialogDescription>
            New {productType} product. You can optionally set a flat rate across all {commissioned.length}{" "}
            commissioned positions, or skip and edit individual cells in the matrix.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Product name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Variant (optional)</label>
            <Input
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              placeholder="e.g. Age 0-65"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasBonus} onChange={(e) => setHasBonus(e.target.checked)} />
            Has bonus column (renewal/persistency bonus paid as a separate line)
          </label>

          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-xs uppercase text-muted-foreground">Initial rates</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={setAcrossMode === "none"} onChange={() => setSetAcrossMode("none")} />
              Customize per position later
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={setAcrossMode === "flat"} onChange={() => setSetAcrossMode("flat")} />
              Set across all {commissioned.length} commissioned positions to
              <Input
                type="number" step="0.01" min="0" max="200"
                value={flatRate} onChange={(e) => setFlatRate(e.target.value)}
                disabled={setAcrossMode !== "flat"}
                className="ml-1 h-7 w-20"
              />
              <span className="text-muted-foreground">%</span>
            </label>
          </fieldset>

          {busyMsg && <p className="text-xs text-muted-foreground">{busyMsg}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Adding…" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
