export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function get2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('Could not get a 2D canvas context.');
  return ctx;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smooth 0→1 ramp, used for every pop and fade in the scene. */
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** Draw an image scaled to cover the whole target box, centred. */
export function drawCover(
  ctx: Ctx2D,
  img: CanvasImageSource,
  w: number,
  h: number,
): void {
  const iw = (img as { width: number }).width;
  const ih = (img as { height: number }).height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Polygon with rounded corners — used for the move buttons. */
export function roundedPolygon(
  ctx: Ctx2D,
  points: [number, number][],
  radius: number,
): void {
  const n = points.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];

    const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const r = Math.min(radius, d1 / 2, d2 / 2);

    const a: [number, number] = [
      cur[0] + ((prev[0] - cur[0]) / d1) * r,
      cur[1] + ((prev[1] - cur[1]) / d1) * r,
    ];
    const b: [number, number] = [
      cur[0] + ((next[0] - cur[0]) / d2) * r,
      cur[1] + ((next[1] - cur[1]) / d2) * r,
    ];

    if (i === 0) ctx.moveTo(a[0], a[1]);
    else ctx.lineTo(a[0], a[1]);
    ctx.quadraticCurveTo(cur[0], cur[1], b[0], b[1]);
  }
  ctx.closePath();
}

/** '#rrggbb' + alpha → 'rgba(...)'. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deterministic PRNG, so the crowd and particles look identical every render. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
