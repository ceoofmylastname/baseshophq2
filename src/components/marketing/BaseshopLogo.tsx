import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  variant?: "full" | "icon";
};

/**
 * Custom wordmark for Baseshop HQ.
 *
 * The "Baseshop" word renders in a light/transparent fill with strong
 * letter-spacing so it reads as the muted secondary mark. "HQ" pops in
 * warm gold with a subtle dual-tone gradient and a small rim glow to
 * draw the eye. A geometric monogram glyph (a stacked diamond + base
 * triangle) sits before the wordmark, hinting at "tier ladder" — the
 * core mental model of the product (positions, hierarchy, levels).
 */
export function BaseshopLogo({ className, variant = "full" }: Props) {
  return (
    <svg
      viewBox={variant === "full" ? "0 0 240 56" : "0 0 56 56"}
      className={cn("select-none", className)}
      role="img"
      aria-label="Baseshop HQ"
    >
      <defs>
        <linearGradient id="bsh-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="hsl(45 100% 75%)" />
          <stop offset="55%"  stopColor="hsl(38 92% 60%)" />
          <stop offset="100%" stopColor="hsl(30 88% 50%)" />
        </linearGradient>
        <linearGradient id="bsh-icon-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="hsl(45 100% 75%)" />
          <stop offset="100%" stopColor="hsl(30 88% 50%)" />
        </linearGradient>
        <filter id="bsh-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" />
          <feComposite in2="SourceGraphic" operator="atop" />
        </filter>
      </defs>

      {/* Monogram: three stacked tiers narrowing upward (the position ladder). */}
      <g transform="translate(8, 12)">
        <path
          d="M 0 28 L 16 28 L 14 22 L 2 22 Z"
          fill="url(#bsh-icon-fill)"
          opacity="0.45"
        />
        <path
          d="M 3 20 L 13 20 L 12 14 L 4 14 Z"
          fill="url(#bsh-icon-fill)"
          opacity="0.75"
        />
        <path
          d="M 5.5 12 L 10.5 12 L 10 4 L 6 4 Z"
          fill="url(#bsh-icon-fill)"
        />
        <circle cx="8" cy="2" r="1.4" fill="hsl(45 100% 80%)" />
      </g>

      {variant === "full" && (
        <>
          {/* Baseshop wordmark — light, muted, wide tracking */}
          <text
            x="34"
            y="36"
            fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
            fontWeight="500"
            fontSize="22"
            letterSpacing="-0.5"
            fill="hsl(0 0% 96%)"
          >
            Baseshop
          </text>

          {/* HQ — gold + glow */}
          <text
            x="156"
            y="36"
            fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
            fontWeight="700"
            fontSize="22"
            letterSpacing="-0.5"
            fill="url(#bsh-gold)"
            filter="url(#bsh-glow)"
          >
            HQ
          </text>

          {/* Underline accent below HQ */}
          <rect
            x="156"
            y="40"
            width="34"
            height="2"
            rx="1"
            fill="url(#bsh-gold)"
            opacity="0.6"
          />
        </>
      )}
    </svg>
  );
}
