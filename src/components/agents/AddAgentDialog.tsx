import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAddAgent, mapAddAgentErrorCode, type AddAgentResult } from "@/hooks/useAddAgent";
import type { DirectoryRow } from "@/hooks/useAgentsDirectory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  /** Existing agents in the tenant (used to populate the upline dropdown). */
  existingAgents: DirectoryRow[];
  onAdded: () => void;
};

export function AddAgentDialog({ existingAgents, onAdded }: Props) {
  const { currentAgent } = useAuth();
  const { addAgent, submitting } = useAddAgent();

  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [email, setEmail]         = useState("");
  const [uplineEmail, setUplineEmail] = useState(currentAgent?.email ?? "");
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<string | null>(null);

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setUplineEmail(currentAgent?.email ?? "");
    setError(null);
    setSuccess(null);
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 150); // after close animation
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const result: AddAgentResult = await addAgent({ firstName, lastName, email, uplineEmail });

    if (!result.ok) {
      setError(mapAddAgentErrorCode(result.errorCode, result.errorMessage));
      return;
    }

    setSuccess(`Invite sent to ${email}.`);
    onAdded();
    setTimeout(close, 1200);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTimeout(reset, 150);
      }}
    >
      <DialogTrigger asChild>
        <Button>Add agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an agent</DialogTitle>
          <DialogDescription>
            Sends an invite email. The agent sets their password via the link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uplineEmail">Upline</Label>
            <select
              id="uplineEmail"
              value={uplineEmail}
              onChange={(e) => setUplineEmail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {existingAgents.map((a) => (
                <option key={a.id} value={a.email}>
                  {[a.first_name, a.last_name].filter(Boolean).join(" ") || a.email}
                  {a.is_owner ? " — Owner" : ""}{" ("}{a.email}{")"}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The agent reports to this upline. View-down permissions cascade through this chain.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-emerald-700">{success}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending invite…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
