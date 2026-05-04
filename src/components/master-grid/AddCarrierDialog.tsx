import { useState, type FormEvent } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCarrierProductMutations } from "@/hooks/useCarrierProductMutations";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddCarrierDialog({ open, onClose, onCreated }: Props) {
  const { addCarrier, submitting } = useCarrierProductMutations();
  const [name, setName] = useState("");
  const [productType, setProductType] = useState<"life" | "annuity">("life");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await addCarrier({ carrierName: name.trim(), productType });
    if (!result.ok) { setError(result.errorMessage); return; }
    onCreated();
    setName("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add carrier</DialogTitle>
          <DialogDescription>
            Add a new carrier. You'll need to add at least one product under it before agents can write business.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Carrier name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={productType === "life"} onChange={() => setProductType("life")} />
              Life
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={productType === "annuity"} onChange={() => setProductType("annuity")} />
              Annuity
            </label>
          </fieldset>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Adding…" : "Add carrier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
