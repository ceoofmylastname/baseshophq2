import { useEffect, useRef, useState } from "react";

/**
 * Framed product-showcase video. HTML5 video element (autoplay, muted,
 * loop) sitting inside a glass "browser window" chrome so the surrounding
 * marketing page text isn't competing with the video for attention.
 *
 * The frame uses traffic-light dots + a fake URL bar to read instantly
 * as "this is the actual product, recorded live." Soft gold glow under
 * the frame keeps it on-brand without dominating.
 */
export function VideoShowcase() {
  const ref = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);

  // Pause the video when off-screen to save GPU + CPU on long pages.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) void el.play().catch(() => { /* autoplay denied; user must click */ });
      else el.pause();
    }, { threshold: 0.25 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-6">
      {/* Soft ambient glow under the frame */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 -bottom-6 h-24 rounded-[50%] blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(38 92% 60% / 0.30), transparent)" }}
        />

        {/* Glass browser-frame */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] glass-strong shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]">
          {/* Top chrome — traffic-light dots + faux URL bar */}
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
            <div className="ml-3 flex flex-1 items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                baseshophq.com/dashboard
              </span>
            </div>
            <span
              className={
                "ml-2 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary"
              }
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Live
            </span>
          </div>

          {/* Video */}
          <video
            ref={ref}
            src="/marketing/hero.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="block aspect-video w-full bg-black object-cover"
            aria-label="Baseshop HQ in action"
          />

          {/* Subtle gradient overlay at bottom for legibility if we ever add caption text */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent"
          />
        </div>

        {/* Tiny status caption below the frame */}
        <p className="mt-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
          {inView ? "Recorded live from a real tenant" : "Scroll into view to play"}
        </p>
      </div>
    </div>
  );
}
