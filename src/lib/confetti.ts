/**
 * Custom canvas confetti — no library, ~80 lines.
 *
 * `fireSideBursts()` creates a full-viewport canvas, spawns particles
 * from the left and right edges in synchronized bursts, animates them
 * with gravity + drag + rotation, fades them out, then tears down the
 * canvas. Self-contained; safe to call multiple times.
 *
 * Brand palette: warm gold, amber, emerald, rose, violet, cream. Mixed
 * so the screen reads as confetti rather than a single-color sweep.
 */

const COLORS = [
  "#F0B330", // primary gold
  "#FFE07A", // light amber
  "#FFC857", // mid amber
  "#5EE0AC", // emerald
  "#FF6F91", // rose
  "#B084CC", // violet
  "#FFFFFF", // cream highlight
];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  shape: "rect" | "circle";
  life: number;     // frames remaining
  maxLife: number;
};

function makeParticle(originX: number, originY: number, baseAngle: number, speedMin: number, speedMax: number): Particle {
  const angle = baseAngle + (Math.random() - 0.5) * 0.7; // ±20° spread
  const speed = speedMin + Math.random() * (speedMax - speedMin);
  const life = 80 + Math.floor(Math.random() * 60); // 80-140 frames (~1.3-2.3s @ 60fps)
  return {
    x: originX,
    y: originY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.4,
    size: 6 + Math.random() * 8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    shape: Math.random() < 0.65 ? "rect" : "circle",
    life,
    maxLife: life,
  };
}

export function fireSideBursts(opts?: { bursts?: number; perSide?: number }) {
  const bursts = opts?.bursts ?? 3;
  const perSide = opts?.perSide ?? 60;

  if (typeof window === "undefined") return;

  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  };
  resize();
  window.addEventListener("resize", resize);

  const ctx = canvas.getContext("2d")!;
  const particles: Particle[] = [];

  // Stagger bursts so confetti reads as cascading celebration, not a single flash.
  for (let b = 0; b < bursts; b++) {
    setTimeout(() => {
      // Origin Y centered slightly above middle (eye-level focus)
      const oy = canvas.height * 0.55;
      // Left side: shoot up-right (negative-y, positive-x). Angle in radians: -π/3.
      for (let i = 0; i < perSide; i++) {
        particles.push(makeParticle(0, oy, -Math.PI / 3.2, 22 * dpr, 38 * dpr));
      }
      // Right side: shoot up-left. Angle: -2π/3.
      for (let i = 0; i < perSide; i++) {
        particles.push(makeParticle(canvas.width, oy, -Math.PI + Math.PI / 3.2, 22 * dpr, 38 * dpr));
      }
    }, b * 180);
  }

  const gravity = 0.5 * dpr;
  const drag = 0.985;

  let raf = 0;
  const frame = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += gravity;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life -= 1;

      if (p.life <= 0 || p.y > canvas.height + 80 * dpr) {
        particles.splice(i, 1);
        continue;
      }

      const alpha = Math.min(1, p.life / 30);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (particles.length > 0) {
      raf = requestAnimationFrame(frame);
    } else {
      // All particles done — clean up.
      window.removeEventListener("resize", resize);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(frame);

  // Hard cap: tear down after 6 seconds even if particles are stuck.
  setTimeout(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    if (canvas.isConnected) canvas.remove();
  }, 6000);
}
