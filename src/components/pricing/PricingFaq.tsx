/**
 * Phase 18 PR 1: FAQ accordion for the public /pricing page.
 *
 * Lightweight `useState<string | null>` for open-item tracking. Only one
 * item is open at a time; clicking the open one closes it. No Radix
 * Accordion dependency.
 *
 * NOTE on animation: the S-1 plan called for the existing
 * `accordion-down` / `accordion-up` keyframes from tailwind.config.js.
 * Those keyframes animate to `var(--radix-accordion-content-height)`,
 * which is set by Radix's Accordion primitive at runtime. Without Radix
 * the variable is undefined, so the animation degrades to instant.
 *
 * To preserve a smooth expand/collapse without adding Radix Accordion as
 * a dependency, this component uses a CSS `grid-template-rows` transition
 * (the modern Tailwind/CSS trick for content-height animation without
 * known heights). The header still rotates its chevron via the simple
 * `rotate-180` utility. See "Deviations from spec" in the PR report.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQ_ITEMS } from "@/lib/pricing/pricing-math";
import { cn } from "@/lib/utils";

export function PricingFaq() {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Questions
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl text-shadow-soft">
          Frequently asked
        </h2>
      </div>

      <ul className="mt-8 space-y-3">
        {FAQ_ITEMS.map((item) => {
          const isOpen = openId === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                "overflow-hidden rounded-2xl glass",
                isOpen && "ring-1 ring-primary/20",
              )}
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : item.id)}
                aria-expanded={isOpen}
                aria-controls={`faq-body-${item.id}`}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-sm font-semibold tracking-tight sm:text-base">
                  {item.q}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-180 text-primary",
                  )}
                />
              </button>

              {/* grid-rows trick for content-height animation without
                  known heights. The outer grid animates between
                  grid-template-rows: 0fr (closed) and 1fr (open); the
                  inner overflow-hidden wrapper carries the actual body. */}
              <div
                id={`faq-body-${item.id}`}
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                    {item.a}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
