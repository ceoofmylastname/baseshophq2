/**
 * Phase 18 PR 2 — ContactSupportModal
 *
 * Lightweight modal opened from /signup/success when the user reports they
 * didn't receive the magic link. Captures email (pre-filled from
 * sessionStorage if present) + optional note, inserts a row into
 * demo_bookings with source='signup-success-no-email'.
 *
 * Per locked D8: demo_bookings already has a `source` column, so we use it.
 * Required columns on demo_bookings: name, email, requested_slot. We use a
 * placeholder name ("Magic-link issue") and the current timestamp as the
 * requested_slot since we are not booking a time — just opening a support
 * ticket. The owner triages on Settings → Demo bookings.
 */

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  defaultEmail?: string;
};

export function ContactSupportModal({ open, onClose, defaultEmail = "" }: Props) {
  const [email, setEmail] = useState(defaultEmail);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setNote("");
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
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setSubmitting(true);
    const { error: insertErr } = await supabase.from("demo_bookings").insert({
      name: "Magic-link issue",
      email: email.trim().toLowerCase(),
      requested_slot: new Date().toISOString(),
      message: note.trim() || null,
      source: "signup-success-no-email",
      user_agent: navigator.userAgent.slice(0, 500),
      referrer: document.referrer || null,
    });
    setSubmitting(false);
    if (insertErr) {
      setError(insertErr.message || "Submission failed. Try again.");
      return;
    }
    toast.success("Got it. Support will reach out within one business day.");
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
            <Label htmlFor="cs-note">Anything support should know (optional)</Label>
            <textarea
              id="cs-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. the magic link never arrived, or my inbox is bouncing it"
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
