import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Phase 13.3: Unified avatar primitive.
 *
 * Renders the agent's profile photo if `avatarUrl` is set; otherwise falls
 * back to colored initials. The colored fallback (bg + text) is passed in
 * by the caller so the org chart can keep its activity-tier color coding
 * (emerald/gold/zinc/muted) on the initials placeholder.
 *
 * Once a real photo is uploaded the colored ring becomes a thin border
 * around the image — the activity-tier color still reads at a glance even
 * with a face in the center.
 *
 * Image failures fall through to initials silently: a 404 on a stored
 * avatar (rare — bucket is public-read) shouldn't break the layout.
 */

export type AgentAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<AgentAvatarSize, { box: string; text: string }> = {
  xs: { box: "h-6 w-6",   text: "text-[9px]"  },
  sm: { box: "h-8 w-8",   text: "text-[11px]" },
  md: { box: "h-10 w-10", text: "text-sm"     },
  lg: { box: "h-12 w-12", text: "text-base"   },
  xl: { box: "h-16 w-16", text: "text-lg"     },
};

export function initialsFor(
  firstName: string | null | undefined,
  lastName:  string | null | undefined,
  email:     string,
): string {
  const f = (firstName ?? "").trim();
  const l = (lastName  ?? "").trim();
  if (f || l) {
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase()
      || email.charAt(0).toUpperCase();
  }
  return email.charAt(0).toUpperCase();
}

type Props = {
  avatarUrl?: string | null;
  firstName?: string | null;
  lastName?:  string | null;
  email:      string;
  size?:      AgentAvatarSize;
  /** Tailwind classes for the initials fallback (bg + border). */
  fallbackBg?:   string;
  /** Tailwind classes for the initials text color. */
  fallbackText?: string;
  className?: string;
  /** When true, render a soft ring around the photo (used in org chart). */
  ring?: boolean;
};

export function AgentAvatar({
  avatarUrl,
  firstName,
  lastName,
  email,
  size = "md",
  fallbackBg   = "bg-white/[0.04] border-white/[0.10]",
  fallbackText = "text-muted-foreground",
  className,
  ring = false,
}: Props) {
  const [errored, setErrored] = useState(false);
  const initials = initialsFor(firstName, lastName, email);
  const sz = SIZE_CLASSES[size];
  const showPhoto = !!avatarUrl && !errored;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border",
        sz.box,
        showPhoto ? "border-white/10 bg-white/[0.02]" : fallbackBg,
        ring && "ring-2 ring-white/10",
        className,
      )}
      aria-label={`${[firstName, lastName].filter(Boolean).join(" ") || email} avatar`}
    >
      {showPhoto ? (
        <img
          src={avatarUrl!}
          alt=""
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className={cn(
          "flex h-full w-full items-center justify-center font-semibold",
          sz.text,
          fallbackText,
        )}>
          {initials}
        </div>
      )}
    </div>
  );
}
