import { capColor } from "@/lib/billing/helpers";
import { cn } from "@/lib/utils";

/**
 * Agent-cap usage progress bar.
 *
 *   < 80%   green
 *   80-94%  amber
 *   >= 95%  red
 *
 * The bar is capped visually at 100% width even when the count exceeds the
 * cap (a brief transitional state during a paid-plan cancellation can leave
 * agentCount > cap until the owner archives some agents). The numeric label
 * still shows the true percentage so the owner sees they're over.
 */

const COLOR_BG = {
  green: "bg-emerald-400/80 shadow-[0_0_12px_hsl(160_60%_50%/0.5)]",
  amber: "bg-amber-300 shadow-[0_0_12px_hsl(38_92%_60%/0.5)]",
  red: "bg-red-400 shadow-[0_0_12px_hsl(0_70%_55%/0.55)]",
} as const;

export function CapUsageBar({ usagePct }: { usagePct: number }) {
  const color = capColor(usagePct);
  const width = Math.min(100, Math.max(0, usagePct));

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn("h-full transition-[width] duration-500", COLOR_BG[color])}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {usagePct}% of plan cap
      </p>
    </div>
  );
}
