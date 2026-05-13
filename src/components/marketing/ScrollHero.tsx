import { useEffect, useRef, useState } from "react";

/**
 * Cinematic scroll-driven video hero.
 *
 * The 32 WebP frames extracted from the source MP4 live in
 * /public/marketing/frames/. We preload them, then on every scroll
 * event compute which frame should be visible based on the user's
 * progress through the hero section's height (200vh tall to give the
 * animation room to breathe). The frame is drawn to a canvas using
 * requestAnimationFrame for smoothness.
 *
 * Below 768px the mobile frame set (960x540) is used to keep mobile
 * download weight reasonable.
 */
const FRAME_COUNT = 32;

function framePath(i: number, mobile: boolean): string {
  const padded = String(i + 1).padStart(3, "0");
  return mobile ? `/marketing/frames/mobile_${padded}.webp`
                : `/marketing/frames/desktop_${padded}.webp`;
}

function useFrames(mobile: boolean) {
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const arr: HTMLImageElement[] = new Array(FRAME_COUNT);
    let done = 0;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.decoding = "async";
      img.src = framePath(i, mobile);
      img.onload = () => {
        if (cancelled) return;
        done += 1;
        setLoadedCount(done);
        if (done === FRAME_COUNT) setImages(arr.slice());
      };
      img.onerror = () => {
        if (cancelled) return;
        done += 1;
        setLoadedCount(done);
        if (done === FRAME_COUNT) setImages(arr.slice());
      };
      arr[i] = img;
    }
    return () => { cancelled = true; };
  }, [mobile]);

  return { images, loadedCount };
}

type Props = {
  children: React.ReactNode;
};

export function ScrollHero({ children }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mobile, setMobile] = useState(false);
  const { images, loadedCount } = useFrames(mobile);

  // Track mobile breakpoint.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setMobile(e.matches);
    onChange(mq);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Set canvas size to match viewport, redraw on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Scroll-driven frame playback.
  useEffect(() => {
    if (images.length === 0) return;
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const rect = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      const progress = total > 0 ? scrolled / total : 0;
      const idx = Math.min(FRAME_COUNT - 1, Math.floor(progress * (FRAME_COUNT - 1)));
      const img = images[idx];
      if (img && img.complete && img.naturalWidth > 0) {
        // Cover-fit: scale to fill canvas while preserving aspect ratio.
        const cw = canvas.width, ch = canvas.height;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const scale = Math.max(cw / iw, ch / ih);
        const w = iw * scale, h = ih * scale;
        const x = (cw - w) / 2, y = (ch - h) / 2;
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, x, y, w, h);
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    onScroll(); // initial paint
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [images]);

  const loadingPct = Math.round((loadedCount / FRAME_COUNT) * 100);
  const ready = images.length > 0;

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: "220vh" }}
    >
      {/* Sticky stage that holds the canvas + foreground content. */}
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        {/* Canvas plays the video frames */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: ready ? 1 : 0, transition: "opacity 700ms ease-out" }}
        />

        {/* Dark vignette + gradient wash over the video for legibility */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(at 50% 30%, transparent 0%, hsl(0 0% 4.7% / 0.55) 65%, hsl(0 0% 4.7%) 100%), " +
              "linear-gradient(to bottom, hsl(0 0% 4.7% / 0.5) 0%, transparent 30%, hsl(0 0% 4.7% / 0.85) 100%)",
          }}
        />

        {/* Pre-load progress indicator */}
        {!ready && (
          <div className="absolute inset-x-0 bottom-12 mx-auto w-64 text-center">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Loading the room · {loadingPct}%
            </div>
            <div className="h-px w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full bg-gradient-to-r from-amber-300 via-primary to-amber-300 transition-[width] duration-300"
                style={{ width: `${loadingPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Foreground content (hero text, CTAs) */}
        <div className="relative z-10 flex h-full flex-col">
          {children}
        </div>
      </div>
    </section>
  );
}
