import { useActionItems } from "@/hooks/useActionItems";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

/**
 * Stack of dismissible per-user banners. Shown above the hero card.
 * If no open items, renders nothing (no empty state — banners are noise
 * when there's nothing to act on).
 */
export function ActionBanner() {
  const { items, dismiss } = useActionItems();
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div
          key={item.id}
          className="flex items-start gap-3 rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-900/20 p-3"
        >
          <div className="flex-1">
            <p className="text-sm font-semibold">{item.title}</p>
            {item.body && (
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
            )}
            {item.cta_url && item.cta_text && (
              <Button asChild size="sm" className="mt-2">
                <a href={item.cta_url}>{item.cta_text}</a>
              </Button>
            )}
          </div>
          {item.is_dismissible && (
            <button
              type="button"
              onClick={() => void dismiss(item.id)}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
