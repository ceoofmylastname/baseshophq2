/**
 * Phase 18.1 — Public /legal/privacy
 *
 * Skeleton page. Same shape as LegalTerms.tsx; the 12 section IDs + titles
 * are locked in `src/lib/legal/sections.ts`. Placeholder bodies will be
 * replaced with counsel-reviewed copy before paid customer signups open.
 */

import { PublicPageShell } from "@/components/marketing/PublicPageShell";
import {
  LEGAL_LAST_UPDATED,
  LEGAL_PLACEHOLDER_PARAGRAPH,
  LEGAL_PRIVACY_SECTIONS,
} from "@/lib/legal/sections";

export function LegalPrivacyPage() {
  return (
    <PublicPageShell>
      <article className="mx-auto max-w-3xl px-4 pb-20 sm:px-6 sm:pb-28">
        <header className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Legal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-shadow-hero sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-xs text-muted-foreground sm:text-sm">
            Last updated: {LEGAL_LAST_UPDATED}
          </p>
        </header>

        <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/[0.05] p-5">
          <p className="text-sm font-semibold text-amber-200">Draft notice</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            This Privacy Policy is currently in draft. Final version is being prepared with legal counsel and will be published before paid customer signups open. Contact support@baseshophq.com for questions.
          </p>
        </div>

        <div className="mt-12 space-y-10">
          {LEGAL_PRIVACY_SECTIONS.map((section) => (
            <section key={section.id}>
              <h2
                id={section.id}
                className="scroll-mt-24 text-lg font-semibold tracking-tight text-shadow-soft sm:text-xl"
              >
                {section.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {LEGAL_PLACEHOLDER_PARAGRAPH}
              </p>
            </section>
          ))}
        </div>
      </article>
    </PublicPageShell>
  );
}
