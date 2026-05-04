import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAssignAgentToPosition,
  type OverridesAction,
} from "@/hooks/useAssignAgentToPosition";
import type { GridPosition } from "@/hooks/useCompGridPositions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlastRadiusBanner } from "./BlastRadiusBanner";

type Props = {
  agentId: string;
  agentName: string;
  position: GridPosition | null;
  onClose: () => void;
  onApplied: () => void;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function AssignPositionModal({
  agentId,
  agentName,
  position,
  onClose,
  onApplied,
}: Props) {
  const { currentAgent } = useAuth();
  const { assign, submitting } = useAssignAgentToPosition();

  const [action, setAction] = useState<OverridesAction>("keep");
  const [startDate, setStartDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  const open = position !== null;

  async function handleSubmit() {
    if (!position) return;
    setError(null);
    const result = await assign({
      agentId,
      positionId: position.id,
      startDate,
      overridesAction: action,
      assignedBy: currentAgent?.id ?? null,
    });
    if (!result.ok) {
      setError(result.errorMessage);
      return;
    }
    onApplied();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change position</DialogTitle>
          <DialogDescription>
            Assign <span className="font-medium text-foreground">{agentName}</span> to{" "}
            <span className="font-medium text-foreground">
              {position?.position_code} {position?.position_name}
            </span>
            . Default rates for this position will be templated onto the agent.
          </DialogDescription>
        </DialogHeader>

        {position && (
          <div className="space-y-4">
            <BlastRadiusBanner agentId={agentId} positionId={position.id} />

            <div className="space-y-2">
              <label htmlFor="start-date" className="text-sm font-medium">
                Effective date
              </label>
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Existing overrides</legend>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                <input
                  type="radio"
                  name="overrides_action"
                  value="keep"
                  checked={action === "keep"}
                  onChange={() => setAction("keep")}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Keep all overrides</span>
                  <span className="block text-xs text-muted-foreground">
                    Existing overrides stay; only products without an override get the new
                    position default.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                <input
                  type="radio"
                  name="overrides_action"
                  value="clear"
                  checked={action === "clear"}
                  onChange={() => setAction("clear")}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Clear all overrides</span>
                  <span className="block text-xs text-muted-foreground">
                    All overrides are closed; every product takes the new position default.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                <input
                  type="radio"
                  name="overrides_action"
                  value="review"
                  checked={action === "review"}
                  onChange={() => setAction("review")}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Review each individually</span>
                  <span className="block text-xs text-muted-foreground">
                    Existing overrides are kept during templating. After the change applies,
                    you can adjust each override on this page.
                  </span>
                </span>
              </label>
            </fieldset>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !position}>
            {submitting ? "Applying…" : "Apply change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
