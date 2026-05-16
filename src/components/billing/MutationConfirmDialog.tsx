import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Shared confirmation Dialog for billing mutations (Phase 17 PR 3c).
 *
 * Used by the WL toggle CTA and the interval toggle. The TierChangeDrawer
 * has its own inline confirm CTA so it can co-locate the proration preview
 * block; non-drawer mutations route through this dialog for a uniform UX.
 *
 * Caller-supplied `prorationLabel` is the human-readable line beneath the
 * dialog body — typically a string like "+$97.00 prorated today" or
 * "$0 due today, change takes effect Nov 14".
 */
type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  body: string;
  prorationLabel?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
};

export function MutationConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  prorationLabel,
  confirmLabel = "Confirm",
  onConfirm,
  loading = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {prorationLabel && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-sm">
            <p className="text-muted-foreground">{prorationLabel}</p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
