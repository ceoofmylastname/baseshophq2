import { useAuth } from "@/contexts/AuthContext";
import { BroadcastEditor } from "@/components/settings/BroadcastEditor";
import { PromotionTargetEditor } from "@/components/settings/PromotionTargetEditor";

/**
 * Phase 10F.6: Settings page now hosts the owner-side editors for /home
 * content (broadcasts + promotion ladder). Section-based scroll layout;
 * sub-routes can come later if the page grows.
 */
export function SettingsPage() {
  const { isOwner } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-shadow-soft">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenant configuration and home page content.
        </p>
      </div>

      {!isOwner ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-sm text-muted-foreground">
          Settings are owner-only. Ask your agency owner to configure home page content,
          promotion criteria, and tenant defaults.
        </div>
      ) : (
        <>
          <section className="rounded-2xl glass p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Home page content
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Broadcasts and promotion criteria that appear on every agent&apos;s /home.
              </p>
            </div>
            <div className="space-y-8">
              <BroadcastEditor />
              <div className="border-t border-white/[0.06]" />
              <PromotionTargetEditor />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
