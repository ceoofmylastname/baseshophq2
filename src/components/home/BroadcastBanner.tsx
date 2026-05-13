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
    <div className="overflow-hidden rounded-lg border bg-gradient-to-br from-primary/10 via-card to-card">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        {broadcast.image_url && (
          <img
            src={broadcast.image_url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-md object-cover sm:h-24 sm:w-24"
          />
        )}
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-primary">Broadcast</p>
          <h2 className="mt-0.5 text-lg font-semibold">{broadcast.title}</h2>
          {broadcast.body && (
            <p className="mt-1 text-sm text-muted-foreground">{broadcast.body}</p>
          )}
        </div>
        {broadcast.cta_url && broadcast.cta_text && (
          <Button asChild>
            <a href={broadcast.cta_url}>{broadcast.cta_text}</a>
          </Button>
        )}
      </div>
    </div>
  );
}
