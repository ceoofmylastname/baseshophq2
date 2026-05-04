import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { BulkDeleteConfirmDialog } from "./BulkDeleteConfirmDialog";
import { BulkStatusChangeDialog } from "./BulkStatusChangeDialog";

type Props = {
  selectedIds: string[];
  onClearSelection: () => void;
  onChanged: () => void;
};

export function BulkActionsBar({ selectedIds, onClearSelection, onChanged }: Props) {
  const { isOwner } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  if (selectedIds.length === 0 || !isOwner) return null;

  return (
    <div className="sticky bottom-0 z-30 flex items-center justify-between rounded-md border bg-card p-3 shadow-md">
      <div className="text-sm">
        <span className="font-medium">{selectedIds.length}</span>
        {" "}selected
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setStatusOpen(true)}>
          Change status
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
          Delete…
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearSelection}>
          Clear
        </Button>
      </div>

      <BulkStatusChangeDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        policyIds={selectedIds}
        onComplete={() => { onChanged(); onClearSelection(); }}
      />
      <BulkDeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        policyIds={selectedIds}
        onComplete={() => { onChanged(); onClearSelection(); }}
      />
    </div>
  );
}
