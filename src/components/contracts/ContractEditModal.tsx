/**
 * Phase 10E: Add/Edit a single agent contract.
 *
 * Mode is implicit from the `contract` prop:
 *   - null      → "Add Contract" (caller can prefill agentId for self-edit flow)
 *   - non-null  → "Edit Contract"
 *
 * Calls the upsert_agent_contract RPC. Surfaces structured error_codes from
 * the RPC envelope as user-readable messages. On success, closes the dialog
 * and the parent's realtime subscription refreshes the table.
 */

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOAUplinePicker } from "./LOAUplinePicker";
import type { ContractRow, ContractStatus } from "@/hooks/useContracts";

type Props = {
  open:        boolean;
  onClose:     () => void;
  /** null = add mode; otherwise the row to edit. */
  contract:    ContractRow | null;
  /** When opening in add mode, default agent_id (e.g. self for non-owners). */
  defaultAgentId?: string | null;
  onSaved:     () => void;
  /** Optional callback when the user clicks Delete (owner only). */
  onDelete?:   (id: string) => Promise<void>;
};

type Carrier = { id: string; carrier_name: string };
type AgentOpt = { id: string; first_name: string | null; last_name: string | null; email: string };

const STATUSES: ContractStatus[] = ["Active", "Pending", "Terminated"];

const ERROR_MESSAGES: Record<string, string> = {
  no_tenant:                "Session expired. Please log in again.",
  writing_number_required:  "Writing number can't be blank.",
  bad_status:               "Invalid status.",
  loa_self_reference:       "An agent can't be their own LOA upline.",
  writing_number_taken:     "That writing number already exists for this carrier.",
  forbidden:                "You don't have permission to save this contract.",
  not_found_or_forbidden:   "Contract not found or you can't edit it.",
  check_violation:          "One of the values violates a constraint.",
};

function nameOf(a: AgentOpt): string {
  const n = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
  return n || a.email;
}

export function ContractEditModal({ open, onClose, contract, defaultAgentId, onSaved, onDelete }: Props) {
  const { isOwner, currentAgent } = useAuth();
  const isEdit = contract !== null;

  // Form state
  const [agentId,        setAgentId]        = useState<string | null>(null);
  const [carrierId,      setCarrierId]      = useState<string | null>(null);
  const [writingNumber,  setWritingNumber]  = useState("");
  const [status,         setStatus]         = useState<ContractStatus>("Active");
  const [effectiveDate,  setEffectiveDate]  = useState<string>("");
  const [endDate,        setEndDate]        = useState<string>("");
  const [loaUplineId,    setLoaUplineId]    = useState<string | null>(null);
  const [referralCode,   setReferralCode]   = useState("");
  const [notes,          setNotes]          = useState("");

  // Lookup options
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [agents,   setAgents]   = useState<AgentOpt[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Reset form on open / contract change
  useEffect(() => {
    if (!open) return;
    if (contract) {
      setAgentId(contract.agent_id);
      setCarrierId(contract.carrier_id);
      setWritingNumber(contract.writing_number);
      setStatus(contract.status);
      setEffectiveDate(contract.effective_date ?? "");
      setEndDate(contract.end_date ?? "");
      setLoaUplineId(contract.loa_upline_agent_id);
      setReferralCode(contract.referral_code ?? "");
      setNotes(contract.notes ?? "");
    } else {
      setAgentId(defaultAgentId ?? (isOwner ? null : (currentAgent?.id ?? null)));
      setCarrierId(null);
      setWritingNumber("");
      setStatus("Active");
      setEffectiveDate("");
      setEndDate("");
      setLoaUplineId(null);
      setReferralCode("");
      setNotes("");
    }
    setError(null);
  }, [open, contract, defaultAgentId, isOwner, currentAgent?.id]);

  // Load lookups on first open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [{ data: cs }, { data: as }] = await Promise.all([
        supabase.from("comp_grid_carriers").select("id, carrier_name").eq("is_active", true).order("carrier_name"),
        supabase.from("agents").select("id, first_name, last_name, email").neq("status", "archived").order("email"),
      ]);
      if (cancelled) return;
      setCarriers((cs ?? []) as Carrier[]);
      setAgents((as ?? []) as AgentOpt[]);
    })();
    return () => { cancelled = true; };
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agentId)   { setError("Pick an agent."); return; }
    if (!carrierId) { setError("Pick a carrier."); return; }
    if (!writingNumber.trim()) { setError(ERROR_MESSAGES.writing_number_required); return; }

    setSubmitting(true);
    const { data, error: err } = await supabase.rpc("upsert_agent_contract", {
      p_id:                  contract?.id ?? null,
      p_agent_id:            agentId,
      p_carrier_id:          carrierId,
      p_writing_number:      writingNumber.trim(),
      p_status:              status,
      p_effective_date:      effectiveDate || null,
      p_end_date:            endDate       || null,
      p_loa_upline_agent_id: loaUplineId,
      p_referral_code:       referralCode.trim() || null,
      p_notes:               notes.trim()        || null,
    });
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    const r = data as { success?: boolean; error_code?: string };
    if (!r?.success) {
      setError(ERROR_MESSAGES[r?.error_code ?? ""] ?? `Save failed (${r?.error_code ?? "unknown"})`);
      return;
    }
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!contract || !onDelete) return;
    if (!confirm("Delete this contract? Existing policies stay but the writing-number link breaks.")) return;
    setDeleting(true);
    setError(null);
    try { await onDelete(contract.id); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
    finally { setDeleting(false); }
  }

  const agentPickerLocked = !isOwner;   // non-owners can only contract themselves

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contract" : "Add contract"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the carrier writing number, LOA upline, status, or dates."
              : "Link an agent to a carrier with their writing number. Required for ingest matching."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Agent">
            <select
              value={agentId ?? ""}
              onChange={(e) => setAgentId(e.target.value || null)}
              disabled={agentPickerLocked}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
            >
              <option value="">Pick an agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{nameOf(a)}</option>)}
            </select>
          </Field>

          <Field label="Carrier">
            <select
              value={carrierId ?? ""}
              onChange={(e) => { setCarrierId(e.target.value || null); setLoaUplineId(null); }}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Pick a carrier…</option>
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.carrier_name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Writing number">
              <Input value={writingNumber} onChange={(e) => setWritingNumber(e.target.value)} required />
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ContractStatus)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective date">
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </Field>
            <Field label="End date">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <Field label="LOA upline">
            <LOAUplinePicker agentId={agentId} carrierId={carrierId} value={loaUplineId} onChange={setLoaUplineId} />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave as "None" if this agent has a direct contract with the carrier. Cycles are blocked.
            </p>
          </Field>

          <Field label="Referral code (optional)">
            <Input value={referralCode} onChange={(e) => setReferralCode(e.target.value)} />
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit && isOwner && onDelete ? (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={submitting || deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting || deleting}>Cancel</Button>
              <Button type="submit" disabled={submitting || deleting}>
                {submitting ? "Saving…" : isEdit ? "Save" : "Add contract"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
