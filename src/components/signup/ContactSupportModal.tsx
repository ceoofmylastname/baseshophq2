/**
 * Phase 18.1 — ContactSupportModal (rewritten)
 *
 * Lightweight modal opened from /signup/success (and reusable from anywhere
 * else that wants a "contact support" surface). Captures email + message,
 * builds the canonical payload via `buildSupportTicketPayload`, and INSERTs
 * into the new `public.support_tickets` table.
 *
 * The legacy implementation INSERTed into `demo_bookings` with synthetic
 * `name` / `requested_slot` fields. Phase 18.1 replaces that with a
 * purpose-built support_tickets table; no reference to demo_bookings remains.
 *
 * Subject is server-side defaulted to "Contact request from ${source}" by
 * buildSupportTicketPayload and is intentionally NOT surfaced as a form
 * field (locked D11). The `source` prop is required so every ticket carries
 * its mount point for triage.
 */

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildSupportTicketPayload } from "@/lib/support-tickets/payload";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  source: string;
  defaultEmail?: string;
};

export function ContactSupportModal({ open, onClose, source, defaultEmail = "" }: Props) {
  const { tenant } = useAuth();
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setMessage("");
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultEmail]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }
    if (!trimmedMessage) {
      setError("Message is required.");
      return;
    }
    setSubmitting(true);
    const payload = buildSupportTicketPayload({
      email: trimmedEmail,
      message: trimmedMessage,
      source,
      tenant_id: tenant?.id ?? null,
    });
    const { error: insertErr } = await supabase.from("support_tickets").insert(payload);
    setSubmitting(false);
    if (insertErr) {
      setError(insertErr.message || "Submission failed. Try again.");
      return;
    }
    toast.success(
      `Thanks. We will get back to you within one business day at ${payload.email}.`,
    );
    onClose();
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Contact support"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[0.06] bg-background p-5 shadow-2xl transition-all duration-200 sm:p-6",
          open ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95",
        )}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              Need a hand?
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-shadow-soft">
              Tell support what happened
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cs-email">
              Your email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cs-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cs-message">
              Message <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="cs-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              required
              placeholder="Tell us what's going on. The more detail the better."
              className="flex w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Send"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
