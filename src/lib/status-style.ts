import type { PolicyStatus } from "./policy-bucket";

/**
 * Single source of truth for status color treatment across the app.
 *
 * Each status gets a distinct hue band so an operator can tell them apart
 * at a glance on the Book of Business, the policy detail page, the
 * production split cards, the activity feed, and anywhere else a status
 * appears.
 *
 * The hue choices map to the lifecycle semantics:
 *   Draft           — neutral / muted (pre-lifecycle, no urgency)
 *   Submitted       — sky blue (cool, "out the door, awaiting first contact")
 *   Pending         — amber (warm, "carrier actively reviewing, needs attention")
 *   Issued          — warm gold (matches brand primary; "booked, mine")
 *   Issue Paid      — emerald (success; "cash in the door")
 *   Potential Lapse — orange-red (warning; "chargeback risk")
 *   Terminated      — red (destructive; "definitively gone")
 *
 * Each entry is a complete set of Tailwind classes that get composed onto a
 * pill: border, background, text. The hex / HSL backing the classes uses the
 * project's brand palette so it pairs with the dark luxury aesthetic.
 */

export type StatusStyle = {
  /** Tailwind classes for the pill chrome (border + bg + text). */
  pillClasses: string;
  /** Tailwind text-color class for icon/standalone label use. */
  textClass: string;
  /** Raw HSL string for charts, dots, glow shadows. */
  hsl: string;
};

const ZINC: StatusStyle = {
  pillClasses: "border-white/10 bg-white/[0.04] text-zinc-300",
  textClass:   "text-zinc-300",
  hsl:         "hsl(0 0% 70%)",
};

const SKY: StatusStyle = {
  pillClasses: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  textClass:   "text-sky-300",
  hsl:         "hsl(199 89% 60%)",
};

const AMBER: StatusStyle = {
  pillClasses: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  textClass:   "text-amber-300",
  hsl:         "hsl(38 92% 60%)",
};

const GOLD: StatusStyle = {
  // Distinct from amber on the spectrum: warmer, deeper, matches primary CTA.
  pillClasses: "border-primary/40 bg-primary/15 text-primary",
  textClass:   "text-primary",
  hsl:         "hsl(38 92% 60%)",
};

const EMERALD: StatusStyle = {
  pillClasses: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  textClass:   "text-emerald-300",
  hsl:         "hsl(150 70% 55%)",
};

const ORANGE_RED: StatusStyle = {
  pillClasses: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  textClass:   "text-orange-300",
  hsl:         "hsl(20 90% 55%)",
};

const RED: StatusStyle = {
  pillClasses: "border-red-500/30 bg-red-500/10 text-red-300",
  textClass:   "text-red-300",
  hsl:         "hsl(0 70% 55%)",
};

export const STATUS_STYLE: Record<PolicyStatus, StatusStyle> = {
  Draft:             ZINC,
  Submitted:         SKY,
  Pending:           AMBER,
  Issued:            GOLD,
  "Issue Paid":      EMERALD,
  "Potential Lapse": ORANGE_RED,
  Terminated:        RED,
};

export function statusStyle(status: PolicyStatus): StatusStyle {
  return STATUS_STYLE[status] ?? ZINC;
}
