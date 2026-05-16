/**
 * Phase 18 PR 1: agent-count slider for the public /pricing page.
 *
 * Uses the Radix Slider primitive (`@radix-ui/react-slider`). The slider
 * runs 1..200 with step=1. Five preset chips (5 / 10 / 25 / 50 / 100) snap
 * the slider to common shop sizes. The current value is shown prominently
 * with the recommended tier name below it, sourced from
 * `tierForAgentCount`. The parent owns the value; this component is
 * stateless beyond the slider's intrinsic interaction.
 */

import * as Slider from "@radix-ui/react-slider";
import {
  TIER_CONFIG,
  tierForAgentCount,
  type PricingTier,
} from "@/lib/pricing/pricing-math";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onChange: (n: number) => void;
};

const PRESETS = [5, 10, 25, 50, 100] as const;

function tierLabel(tier: PricingTier): string {
  return TIER_CONFIG[tier].label;
}

export function AgentCountSlider({ value, onChange }: Props) {
  const tier = tierForAgentCount(value);
  const label = tierLabel(tier);

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl glass p-6">
      <div className="text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          How many agents do you have?
        </p>
        <div className="mt-2 text-3xl font-semibold tracking-tight text-shadow-soft tabular-nums">
          {value} {value === 1 ? "agent" : "agents"}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          We recommend{" "}
          <span className="font-semibold text-primary">{label}</span>
          {" "}for your team size.
        </p>
      </div>

      <div className="mt-6 px-2">
        <Slider.Root
          className="relative flex h-5 w-full touch-none select-none items-center"
          min={1}
          max={200}
          step={1}
          value={[value]}
          onValueChange={(next) => {
            const n = next[0];
            if (typeof n === "number") onChange(n);
          }}
          aria-label="Number of agents"
        >
          <Slider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/[0.08]">
            <Slider.Range className="absolute h-full bg-primary" />
          </Slider.Track>
          <Slider.Thumb
            className="block h-5 w-5 rounded-full border-2 border-primary bg-background shadow-[0_0_16px_hsl(38_92%_60%/0.45)] outline-none ring-offset-background transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
          />
        </Slider.Root>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>1</span>
          <span>200</span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value === p
                ? "border-primary/50 bg-primary/[0.10] text-primary"
                : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
