import { useState, type FormEvent } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIngestCommit } from "@/hooks/useIngestCommit";
import { POLICY_STATUS_VALUES } from "@/lib/ingest-row-canonicalize";

type Props = {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function PostDealModal({ open, onClose, onPosted }: Props) {
  const { commit, submitting } = useIngestCommit();
  const [policyNumber, setPolicyNumber] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [carrier, setCarrier] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState<string>("Submitted");
  const [annualPremium, setAnnualPremium] = useState("");
  const [clientFirst, setClientFirst] = useState("");
  const [clientLast, setClientLast] = useState("");
  const [applicationDate, setApplicationDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPolicyNumber(""); setAgentEmail(""); setCarrier(""); setProduct("");
    setStatus("Submitted"); setAnnualPremium("");
    setClientFirst(""); setClientLast(""); setApplicationDate(todayIso());
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await commit([{
      row_index: 0,
      payload: {
        policy_number: policyNumber.trim(),
        agent_email:   agentEmail.trim() || undefined,
        carrier:       carrier.trim() || undefined,
        product:       product.trim() || undefined,
        status,
        annual_premium: annualPremium ? Number(annualPremium) : undefined,
        client_first_name: clientFirst.trim() || undefined,
        client_last_name:  clientLast.trim() || undefined,
        application_date:  applicationDate,
      },
    }]);
    if (!result.ok) { setError(result.errorMessage); return; }
    const r = result.results[0];
    if (r?.error_code) { setError(r.error_message ?? r.error_code); return; }
    onPosted();
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setTimeout(reset, 150); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Post a deal</DialogTitle>
          <DialogDescription>
            Add a single policy. Goes through the same matching + canonicalization as a CSV import,
            and shows up in Last Import Summary.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <Field label="Policy number *" required value={policyNumber} onChange={setPolicyNumber} />
          <Field label="Agent email" value={agentEmail} onChange={setAgentEmail}
                 hint="If left blank, the policy will land as orphan." />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Carrier" value={carrier} onChange={setCarrier} />
            <Field label="Product" value={product} onChange={setProduct} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client first name" value={clientFirst} onChange={setClientFirst} />
            <Field label="Client last name" value={clientLast} onChange={setClientLast} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Annual premium</label>
              <Input type="number" step="0.01" min="0" value={annualPremium} onChange={(e) => setAnnualPremium(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Application date</label>
              <Input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {POLICY_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !policyNumber.trim()}>
              {submitting ? "Posting…" : "Post deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, value, onChange, required, hint,
}: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
