import { useAuth } from "@/contexts/AuthContext";
import { AccountSection } from "@/components/settings/AccountSection";
import { AgencyProfileSection } from "@/components/settings/AgencyProfileSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { BroadcastEditor } from "@/components/settings/BroadcastEditor";
import { PromotionTargetEditor } from "@/components/settings/PromotionTargetEditor";
import { PositionEditor } from "@/components/settings/PositionEditor";

/**
 * Settings page hosts BOTH every-user account management (email + password)
 * AND owner-only tenant configuration. The Account section is always
 * visible; the owner-only sections are gated on isOwner.
 *
 * Phase 10F.6: Home page content (broadcasts + promotion ladder).
 * Phase 10F.7: Position ladder editor — owner controls the rungs themselves.
 * Phase 16.0:  Account section — email + password change for every user.
 * Phase 15.3:  Agency profile — owner edits tenant name + slug.
 * Phase 13.3:  Profile section — every user edits photo + name + bio.
 *
 * Section-based scroll layout; sub-routes can come later if the page grows.
 */
export function SettingsPage() {
  const { isOwner } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-shadow-soft">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account credentials.{isOwner ? " Owner-only sections cover tenant configuration." : ""}
        </p>
      </div>

      {/* Profile section — available to every authenticated user */}
      <section className="rounded-2xl glass p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Profile
          </h2>
        </div>
        <ProfileSection />
      </section>

      {/* Account section — available to every authenticated user */}
      <section className="rounded-2xl glass p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Account
          </h2>
        </div>
        <AccountSection />
      </section>

      {/* Owner-only sections */}
      {isOwner ? (
        <>
          <section className="rounded-2xl glass p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Agency profile
              </h2>
            </div>
            <AgencyProfileSection />
          </section>

          <section className="rounded-2xl glass p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Position ladder
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The rungs your agency uses. Each new agent gets assigned to one;
                rungs drive commission rates via the master grid and the promotion gauge on /home.
              </p>
            </div>
            <PositionEditor />
          </section>

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
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-sm text-muted-foreground">
          Additional settings (position ladder, home page broadcasts, promotion criteria) are owner-only.
          Ask your agency owner to configure them.
        </div>
      )}
    </div>
  );
}
