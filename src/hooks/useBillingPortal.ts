import { useState } from "react";
import { toast } from "sonner";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";

/**
 * Wraps the billing-portal Edge Function. Owner-only.
 *
 * On success: opens the returned Stripe portal URL in a new tab via
 *   window.open(url, '_blank', 'noopener,noreferrer')
 *
 * On failure: surfaces the structured error_code via a sonner toast so the
 * owner sees something specific (missing customer, network failure, etc.)
 * rather than a silent no-op.
 */
export function useBillingPortal() {
  const [opening, setOpening] = useState(false);

  async function openPortal(): Promise<void> {
    setOpening(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be signed in to open the billing portal.");
        return;
      }

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/billing-portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        const code = json.error_code ?? "unknown";
        if (code === "no_stripe_customer") {
          toast.error("No Stripe customer on file yet. Subscribe to a paid tier first.");
        } else {
          toast.error(`Could not open billing portal (${code}).`);
        }
        return;
      }

      window.open(json.url as string, "_blank", "noopener,noreferrer");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Network error: ${msg}`);
    } finally {
      setOpening(false);
    }
  }

  return { openPortal, opening };
}
