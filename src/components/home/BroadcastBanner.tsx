import { useCurrentBroadcast } from "@/hooks/useCurrentBroadcast";
import { Button } from "@/components/ui/button";

/**
 * Single hero broadcast slot. Server-side filtering already handles
 * scheduling + targeting, so this component just renders or hides.
 */
export function BroadcastBanner() {
  const { broadcast } = useCurrentBroadcast();
  if (!broadcast) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl glass">
      {/* Kinetic gradient backdrop. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 gradient-rim" />

      <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        {broadcast.image_url && (
          <img
            src={broadcast.image_url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl border border-white/10 object-cover shadow-lg sm:h-24 sm:w-24"
          />
        )}
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Broadcast
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-shadow-hero">
            {broadcast.title}
          </h2>
          {broadcast.body && (
            <p className="mt-1.5 text-sm text-muted-foreground">{broadcast.body}</p>
          )}
        </div>
        {broadcast.cta_url && broadcast.cta_text && (
          <Button
            asChild
            className="border border-primary/40 bg-primary/90 text-primary-foreground shadow-[0_0_24px_hsl(38_92%_60%/0.35)] hover:bg-primary"
          >
            <a href={broadcast.cta_url}>{broadcast.cta_text}</a>
          </Button>
        )}
      </div>
    </div>
  );
}
