import { BANDS, sampleSeries, type Analysis } from './analyze';
import type { Chart, Note } from './chart';
import type { Move } from './moves';
import {
  clamp,
  createCanvas,
  drawCover,
  easeOut,
  get2d,
  lerp,
  mulberry32,
  roundedPolygon,
  withAlpha,
  type AnyCanvas,
  type Ctx2D,
} from './canvas-utils';

export type SceneOptions = {
  width: number;
  height: number;
  /** Seconds of countdown before the audio starts. */
  leadIn: number;
  /** Seconds a note takes to travel from the top to the hit line. */
  approach: number;
  moves: Move[];
  title: string;
  artist: string;
  background: CanvasImageSource | null;
  /** Per-lane icon overrides; null entries fall back to the move glyph. */
  icons: (CanvasImageSource | null)[];
  showHud: boolean;
};

const FONT = '"Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif';

/**
 * Draws one frame of the gameplay scene.
 *
 * Every visual is a pure function of the timestamp: nothing accumulates
 * between frames. That lets the offline exporter render frame 4000 without
 * having rendered frames 0..3999, and guarantees the preview and the exported
 * file look identical.
 */
export class Scene {
  private readonly W: number;
  private readonly H: number;
  private readonly cx: number;
  private readonly hitY: number;
  private readonly topY: number;
  private readonly spacing: number;
  private readonly iconCY: number;
  /**
   * Scale unit for type and widget sizes. Anchors stay fractions of height,
   * but anything with an intrinsic size keys off the narrow dimension —
   * otherwise a 1080x1920 export renders 65px titles and stretched buttons.
   */
  private readonly U: number;
  private readonly topSpread = 0.83;

  private readonly notes: Note[];
  /** Cumulative score after each note, for O(log n) HUD lookup. */
  private readonly scoreAt: Int32Array;
  private background: AnyCanvas | null = null;
  private crowd: { x: number; y: number; r: number; phase: number; hue: number }[] = [];

  constructor(
    private readonly chart: Chart,
    private readonly analysis: Analysis,
    private readonly opts: SceneOptions,
  ) {
    this.W = opts.width;
    this.H = opts.height;
    this.cx = this.W / 2;
    this.hitY = this.H * 0.72;
    this.topY = -this.H * 0.06;
    this.spacing = this.W * 0.19;
    this.iconCY = this.H * 0.855;
    this.U = Math.min(this.W, this.H);

    this.notes = chart.notes;
    this.scoreAt = new Int32Array(this.notes.length);
    let score = 0;
    for (let i = 0; i < this.notes.length; i++) {
      score += 100 + Math.min(900, i * 10);
      this.scoreAt[i] = score;
    }

    this.buildCrowd();
    this.buildBackground();
  }

  get totalDuration(): number {
    return this.opts.leadIn + this.analysis.duration + 2.5;
  }

  // ---------------------------------------------------------------- geometry

  private laneXAt(lane: number, y: number): number {
    const t = clamp((y - this.topY) / (this.hitY - this.topY), 0, 1.3);
    const spread = this.topSpread + (1 - this.topSpread) * t;
    return this.cx + (lane - (BANDS - 1) / 2) * this.spacing * spread;
  }

  private depthAt(y: number): number {
    return clamp((y - this.topY) / (this.hitY - this.topY), 0, 1.3);
  }

  // ------------------------------------------------------------- static art

  private buildCrowd(): void {
    const rand = mulberry32(1337);
    const rows = 26;
    const perRow = 90;
    for (let r = 0; r < rows; r++) {
      const ry = this.H * (0.325 + (r / rows) * 0.185);
      for (let i = 0; i < perRow; i++) {
        const x = rand() * this.W;
        // Thin out the middle so the pitch stays readable.
        const mid = Math.abs(x - this.cx) / this.cx;
        if (mid < 0.28 && rand() < 0.55) continue;
        this.crowd.push({
          x,
          y: ry + (rand() - 0.5) * this.U * 0.012,
          r: this.U * (0.0016 + rand() * 0.0022),
          phase: rand() * Math.PI * 2,
          hue: rand() < 0.5 ? 48 : 210,
        });
      }
    }
  }

  /** Renders the parts of the scene that never move into an offscreen canvas. */
  private buildBackground(): void {
    const canvas = createCanvas(this.W, this.H);
    const ctx = get2d(canvas);
    const { W, H } = this;

    if (this.opts.background) {
      drawCover(ctx, this.opts.background, W, H);
    } else {
      this.paintArena(ctx);
    }

    // Darken the lower third so the lanes and buttons read clearly on top.
    const shade = ctx.createLinearGradient(0, H * 0.45, 0, H);
    shade.addColorStop(0, 'rgba(6, 4, 20, 0)');
    shade.addColorStop(0.6, 'rgba(6, 4, 20, 0.45)');
    shade.addColorStop(1, 'rgba(4, 2, 14, 0.82)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);

    // Vignette.
    const vig = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.25, W / 2, H * 0.5, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    this.background = canvas;
  }

  /** An original sunset-stadium backdrop drawn from scratch. */
  private paintArena(ctx: Ctx2D): void {
    const { W, H } = this;
    const horizon = H * 0.52;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0.0, '#2B1A5E');
    sky.addColorStop(0.35, '#6A2E86');
    sky.addColorStop(0.68, '#C04A86');
    sky.addColorStop(0.88, '#F0825F');
    sky.addColorStop(1.0, '#FFC06A');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    // Sun glow sitting on the horizon.
    const sun = ctx.createRadialGradient(W * 0.62, horizon, 0, W * 0.62, horizon, H * 0.34);
    sun.addColorStop(0, 'rgba(255, 226, 150, 0.95)');
    sun.addColorStop(0.35, 'rgba(255, 160, 96, 0.40)');
    sun.addColorStop(1, 'rgba(255, 120, 80, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, horizon + H * 0.1);

    // Soft clouds.
    const rand = mulberry32(99);
    ctx.save();
    for (let i = 0; i < 14; i++) {
      const y = H * (0.08 + rand() * 0.34);
      const x = rand() * W;
      const w = W * (0.10 + rand() * 0.22);
      const h = H * (0.012 + rand() * 0.022);
      ctx.globalAlpha = 0.10 + rand() * 0.16;
      ctx.fillStyle = i % 3 === 0 ? '#FFD9A8' : '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Distant skyline.
    ctx.fillStyle = 'rgba(38, 20, 62, 0.85)';
    let x = -W * 0.05;
    const rand2 = mulberry32(7);
    while (x < W * 1.05) {
      const bw = W * (0.015 + rand2() * 0.035);
      const bh = H * (0.03 + rand2() * 0.075);
      ctx.fillRect(x, horizon - bh, bw, bh);
      x += bw * (1.05 + rand2() * 0.5);
    }

    // Stand decks sweeping up on both sides.
    const deck = ctx.createLinearGradient(0, horizon - H * 0.22, 0, horizon + H * 0.06);
    deck.addColorStop(0, 'rgba(26, 18, 60, 0.55)');
    deck.addColorStop(1, 'rgba(14, 10, 38, 0.92)');
    ctx.fillStyle = deck;
    ctx.beginPath();
    ctx.moveTo(0, horizon - H * 0.26);
    ctx.lineTo(W * 0.22, horizon - H * 0.10);
    ctx.lineTo(W * 0.78, horizon - H * 0.10);
    ctx.lineTo(W, horizon - H * 0.26);
    ctx.lineTo(W, horizon + H * 0.04);
    ctx.lineTo(0, horizon + H * 0.04);
    ctx.closePath();
    ctx.fill();

    // Pitch.
    const pitch = ctx.createLinearGradient(0, horizon, 0, H * 0.80);
    pitch.addColorStop(0, '#1C5533');
    pitch.addColorStop(0.55, '#154227');
    pitch.addColorStop(1, '#0D2B1B');
    ctx.fillStyle = pitch;
    ctx.fillRect(0, horizon, W, H * 0.80 - horizon);

    // Soften the seam where the stands meet the pitch.
    const seam = ctx.createLinearGradient(0, horizon - H * 0.02, 0, horizon + H * 0.07);
    seam.addColorStop(0, 'rgba(8, 5, 24, 0.75)');
    seam.addColorStop(1, 'rgba(8, 5, 24, 0)');
    ctx.fillStyle = seam;
    ctx.fillRect(0, horizon - H * 0.02, W, H * 0.09);

    // Mowing stripes, widening toward the camera.
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 9; i++) {
      const t0 = i / 9;
      const t1 = (i + 0.5) / 9;
      ctx.beginPath();
      ctx.moveTo(lerp(W * 0.30, -W * 0.5, t0), H * 0.80);
      ctx.lineTo(lerp(W * 0.30, -W * 0.5, t1), H * 0.80);
      ctx.lineTo(lerp(W * 0.42, W * 0.58, t1), horizon);
      ctx.lineTo(lerp(W * 0.42, W * 0.58, t0), horizon);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Goal, centred on the horizon.
    ctx.strokeStyle = 'rgba(225, 235, 255, 0.40)';
    ctx.lineWidth = Math.max(1.5, H * 0.003);
    const gw = W * 0.145;
    const gh = H * 0.062;
    ctx.strokeRect(this.cx - gw / 2, horizon + H * 0.01, gw, gh);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 1;
    for (let i = 1; i < 14; i++) {
      const gx = this.cx - gw / 2 + (gw * i) / 14;
      ctx.beginPath();
      ctx.moveTo(gx, horizon + H * 0.01);
      ctx.lineTo(gx, horizon + H * 0.01 + gh);
      ctx.stroke();
    }
    ctx.restore();

    // Foreground court the lanes stand on.
    const floor = ctx.createLinearGradient(0, H * 0.78, 0, H);
    floor.addColorStop(0, '#2A2550');
    floor.addColorStop(1, '#120E2C');
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.78, W, H * 0.22);

    // Floodlight pylons.
    for (const px of [W * 0.12, W * 0.88]) {
      ctx.fillStyle = 'rgba(18, 12, 44, 0.9)';
      ctx.fillRect(px - W * 0.004, horizon - H * 0.30, W * 0.008, H * 0.22);
      const lampW = W * 0.055;
      const lampH = H * 0.045;
      ctx.fillStyle = 'rgba(30, 22, 66, 0.95)';
      ctx.fillRect(px - lampW / 2, horizon - H * 0.34, lampW, lampH);
      const flare = ctx.createRadialGradient(px, horizon - H * 0.32, 0, px, horizon - H * 0.32, H * 0.14);
      flare.addColorStop(0, 'rgba(255,255,230,0.55)');
      flare.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = flare;
      ctx.beginPath();
      ctx.arc(px, horizon - H * 0.32, H * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------- frame

  /** `videoTime` is seconds from the start of the exported video. */
  draw(ctx: Ctx2D, videoTime: number): void {
    const { W, H } = this;
    const audioTime = videoTime - this.opts.leadIn;

    const level = this.sample('level', audioTime);
    const bass = this.band(0, audioTime);

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (this.background) ctx.drawImage(this.background, 0, 0);

    this.drawCrowd(ctx, audioTime, level);
    this.drawSweeps(ctx, videoTime, level);

    for (let lane = 0; lane < BANDS; lane++) this.drawBeam(ctx, lane, videoTime);
    for (let lane = 0; lane < BANDS; lane++) this.drawPad(ctx, lane, videoTime, bass);

    this.drawNotes(ctx, videoTime);
    this.drawHitBursts(ctx, videoTime);

    for (let lane = 0; lane < BANDS; lane++) this.drawButton(ctx, lane, videoTime);

    if (this.opts.showHud) this.drawHud(ctx, videoTime, audioTime);
    if (audioTime < 0) this.drawCountdown(ctx, audioTime);

    ctx.restore();
  }

  private sample(which: 'level' | 'envelope', t: number): number {
    if (t < 0 || t > this.analysis.duration) return 0;
    const a = this.analysis;
    return sampleSeries(a[which], a.hops, 0, t, a.hopSec);
  }

  private band(b: number, t: number): number {
    if (t < 0 || t > this.analysis.duration) return 0;
    const a = this.analysis;
    return sampleSeries(a.bandEnergy, a.hops, b, t, a.hopSec);
  }

  private drawCrowd(ctx: Ctx2D, audioTime: number, level: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.35 + level * 0.9;
    for (const c of this.crowd) {
      const tw = 0.5 + 0.5 * Math.sin(audioTime * 7 + c.phase);
      ctx.globalAlpha = clamp(0.10 + tw * pulse * 0.55, 0, 0.85);
      ctx.fillStyle = c.hue === 48 ? '#FFE9A8' : '#A9D8FF';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * (0.8 + tw * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Slow coloured searchlights across the sky, nudged by the music. */
  private drawSweeps(ctx: Ctx2D, videoTime: number, level: number): void {
    const { W, H } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const phase = videoTime * 0.22 + i * 2.1;
      const x = this.cx + Math.sin(phase) * W * 0.42;
      const grad = ctx.createLinearGradient(x, 0, this.cx, H * 0.55);
      const col = ['#6AC8FF', '#FF8AD8', '#FFD97A'][i];
      grad.addColorStop(0, withAlpha(col, 0.16 + level * 0.14));
      grad.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - W * 0.012, 0);
      ctx.lineTo(x + W * 0.012, 0);
      ctx.lineTo(this.cx + W * 0.10, H * 0.55);
      ctx.lineTo(this.cx - W * 0.10, H * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private laneHitGlow(lane: number, videoTime: number): number {
    // Brightest right on the beat, decaying over ~0.35s.
    let glow = 0;
    for (const n of this.notesNear(videoTime, 0.4, 0)) {
      if (n.lane !== lane) continue;
      const dt = videoTime - (n.t + this.opts.leadIn);
      if (dt < 0 || dt > 0.35) continue;
      glow = Math.max(glow, 1 - dt / 0.35);
    }
    return glow;
  }

  private drawBeam(ctx: Ctx2D, lane: number, videoTime: number): void {
    const move = this.opts.moves[lane];
    const glow = this.laneHitGlow(lane, videoTime);

    const topX = this.laneXAt(lane, this.topY);
    const botX = this.laneXAt(lane, this.hitY);
    const topW = this.spacing * 0.10;
    const botW = this.spacing * 0.26;

    const grad = ctx.createLinearGradient(0, this.topY, 0, this.hitY);
    grad.addColorStop(0, withAlpha(move.beam, 0.05));
    grad.addColorStop(0.45, withAlpha(move.beam, 0.30 + glow * 0.25));
    grad.addColorStop(1, withAlpha(move.beam, 0.75 + glow * 0.25));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(topX - topW / 2, this.topY);
    ctx.lineTo(topX + topW / 2, this.topY);
    ctx.lineTo(botX + botW / 2, this.hitY);
    ctx.lineTo(botX - botW / 2, this.hitY);
    ctx.closePath();
    ctx.fill();

    // Bright core line.
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.25 + glow * 0.5);
    ctx.lineWidth = Math.max(1, this.spacing * 0.018);
    ctx.beginPath();
    ctx.moveTo(topX, this.topY);
    ctx.lineTo(botX, this.hitY);
    ctx.stroke();
    ctx.restore();
  }

  private drawPad(ctx: Ctx2D, lane: number, videoTime: number, bass: number): void {
    const move = this.opts.moves[lane];
    const glow = this.laneHitGlow(lane, videoTime);
    const x = this.laneXAt(lane, this.hitY);
    const y = this.hitY;
    const rx = this.spacing * 0.40 * (1 + glow * 0.12 + bass * 0.03);
    const ry = rx * 0.34;

    ctx.save();

    // Ground glow.
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y, 0, x, y, rx * 2.2);
    halo.addColorStop(0, withAlpha(move.beam, 0.35 + glow * 0.45));
    halo.addColorStop(1, withAlpha(move.beam, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 2.2, ry * 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Pad body: a shallow disc seen at an angle.
    const body = ctx.createLinearGradient(x, y - ry, x, y + ry);
    body.addColorStop(0, '#F2F4FA');
    body.addColorStop(0.42, move.beam);
    body.addColorStop(1, move.pad);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rim.
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.55 + glow * 0.4);
    ctx.lineWidth = Math.max(1.5, rx * 0.045);
    ctx.stroke();

    // Inner dome.
    const dome = ctx.createRadialGradient(x, y - ry * 0.5, 0, x, y, rx * 0.72);
    dome.addColorStop(0, withAlpha('#FFFFFF', 0.85));
    dome.addColorStop(1, withAlpha(move.pad, 0.1));
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.ellipse(x, y - ry * 0.22, rx * 0.66, ry * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Notes whose hit time falls within [t - past, t + future]. */
  private notesNear(videoTime: number, past: number, future: number): Note[] {
    const lead = this.opts.leadIn;
    const lo = videoTime - lead - past;
    const hi = videoTime - lead + future;
    const out: Note[] = [];
    // Linear scan over a bounded window via binary search for the start.
    let a = 0;
    let b = this.notes.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (this.notes[m].t < lo) a = m + 1;
      else b = m;
    }
    for (let i = a; i < this.notes.length && this.notes[i].t <= hi; i++) out.push(this.notes[i]);
    return out;
  }

  private drawNotes(ctx: Ctx2D, videoTime: number): void {
    const approach = this.opts.approach;
    const upcoming = this.notesNear(videoTime, 0, approach);

    // Far notes first so near ones overlap them.
    for (let i = upcoming.length - 1; i >= 0; i--) {
      const n = upcoming[i];
      const hitTime = n.t + this.opts.leadIn;
      const p = 1 - (hitTime - videoTime) / approach;
      if (p < 0 || p > 1) continue;

      const y = lerp(this.topY, this.hitY, p);
      const x = this.laneXAt(n.lane, y);
      const d = this.depthAt(y);
      const w = this.spacing * lerp(0.26, 0.70, d);
      const h = w * 0.42;
      const move = this.opts.moves[n.lane];
      const alpha = clamp(p * 4, 0, 1);

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(x, y, 0, x, y, w * 0.9);
      halo.addColorStop(0, withAlpha(move.beam, 0.55));
      halo.addColorStop(1, withAlpha(move.beam, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.9, h * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      const body = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
      body.addColorStop(0, '#FFFFFF');
      body.addColorStop(0.35, move.beam);
      body.addColorStop(1, move.pad);
      ctx.fillStyle = body;
      roundedPolygon(
        ctx,
        [
          [x - w / 2, y - h / 2],
          [x + w / 2, y - h / 2],
          [x + w / 2, y + h / 2],
          [x - w / 2, y + h / 2],
        ],
        h * 0.42,
      );
      ctx.fill();
      ctx.strokeStyle = withAlpha('#FFFFFF', 0.75);
      ctx.lineWidth = Math.max(1, h * 0.09);
      ctx.stroke();

      ctx.restore();
    }
  }

  /** Expanding ring plus sparks at the moment a note lands. */
  private drawHitBursts(ctx: Ctx2D, videoTime: number): void {
    const hits = this.notesNear(videoTime, 0.5, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const n of hits) {
      const dt = videoTime - (n.t + this.opts.leadIn);
      if (dt < 0 || dt > 0.45) continue;
      const k = dt / 0.45;
      const e = easeOut(k);
      const move = this.opts.moves[n.lane];
      const x = this.laneXAt(n.lane, this.hitY);
      const y = this.hitY;

      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = move.beam;
      ctx.lineWidth = Math.max(2, this.spacing * 0.05 * (1 - k));
      ctx.beginPath();
      ctx.ellipse(x, y, this.spacing * (0.36 + e * 0.28), this.spacing * (0.12 + e * 0.10), 0, 0, Math.PI * 2);
      ctx.stroke();

      const rand = mulberry32(Math.round(n.t * 1000) + n.lane * 977);
      const count = 10;
      for (let i = 0; i < count; i++) {
        const ang = rand() * Math.PI * 2;
        const speed = this.spacing * (0.34 + rand() * 0.52);
        const px = x + Math.cos(ang) * speed * e;
        const py = y + Math.sin(ang) * speed * e * 0.42 - e * this.spacing * 0.28;
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.fillStyle = i % 3 === 0 ? '#FFFFFF' : move.beam;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, this.spacing * 0.035 * (1 - k)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawButton(ctx: Ctx2D, lane: number, videoTime: number): void {
    const move = this.opts.moves[lane];
    const glow = this.laneHitGlow(lane, videoTime);
    const x = this.laneXAt(lane, this.hitY);
    const press = glow * this.U * 0.008;
    const cy = this.iconCY + press;

    const w = this.spacing * 0.84 * (1 + glow * 0.04);
    const h = this.U * 0.155 * (1 + glow * 0.04);

    // Rounded triangle pointing down.
    const pts: [number, number][] = [
      [x - w / 2, cy - h / 2],
      [x + w / 2, cy - h / 2],
      [x, cy + h / 2],
    ];

    ctx.save();

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + glow * 0.55;
    ctx.fillStyle = move.beam;
    roundedPolygon(ctx, pts.map(([px, py]) => [x + (px - x) * 1.16, cy + (py - cy) * 1.16]), w * 0.2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const face = ctx.createLinearGradient(x, cy - h / 2, x, cy + h / 2);
    face.addColorStop(0, move.beam);
    face.addColorStop(1, move.pad);
    ctx.fillStyle = face;
    roundedPolygon(ctx, pts, w * 0.17);
    ctx.fill();

    ctx.strokeStyle = withAlpha('#FFFFFF', 0.8);
    ctx.lineWidth = Math.max(2, w * 0.035);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Icon sits in the wide upper half; the apex is too narrow to hold it.
    const icon = this.opts.icons[lane];
    const iconSize = w * 0.46;
    const iconCy = cy - h * 0.10;
    if (icon) {
      const iw = (icon as { width: number }).width;
      const ih = (icon as { height: number }).height;
      if (iw && ih) {
        const s = Math.min(iconSize / iw, iconSize / ih);
        ctx.drawImage(icon, x - (iw * s) / 2, iconCy - (ih * s) / 2, iw * s, ih * s);
      }
    } else {
      ctx.font = `${Math.round(iconSize)}px ${FONT}`;
      ctx.fillText(move.glyph, x, iconCy);
    }

    // Label goes below the apex, on the floor, so any word length fits.
    ctx.font = `800 ${Math.round(this.U * 0.019)}px ${FONT}`;
    ctx.fillStyle = withAlpha('#FFFFFF', 0.95);
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = this.U * 0.008;
    ctx.fillText(move.label, x, cy + h * 0.5 + this.U * 0.026);
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  private scoreAndCombo(audioTime: number): { score: number; combo: number } {
    let a = 0;
    let b = this.notes.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (this.notes[m].t <= audioTime) a = m + 1;
      else b = m;
    }
    return { score: a > 0 ? this.scoreAt[a - 1] : 0, combo: a };
  }

  private drawHud(ctx: Ctx2D, videoTime: number, audioTime: number): void {
    const { W, H, U } = this;
    const pad = Math.min(W, H) * 0.030;
    const { score, combo } = this.scoreAndCombo(audioTime);

    ctx.save();
    ctx.textBaseline = 'top';

    // Title block, top left.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `800 ${Math.round(U * 0.034)}px ${FONT}`;
    ctx.fillText(truncate(this.opts.title, 42), pad, pad);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `600 ${Math.round(U * 0.022)}px ${FONT}`;
    ctx.fillText(truncate(this.opts.artist, 46), pad, pad + U * 0.042);

    // Score, top right.
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `800 ${Math.round(U * 0.040)}px ${FONT}`;
    ctx.fillText(score.toLocaleString('en-US'), W - pad, pad);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `700 ${Math.round(U * 0.019)}px ${FONT}`;
    ctx.fillText(`${Math.round(this.chart.bpm)} BPM`, W - pad, pad + U * 0.050);

    // Combo counter, centre.
    if (combo >= 5) {
      const last = this.notes[combo - 1];
      const since = videoTime - (last.t + this.opts.leadIn);
      const pop = 1 + Math.max(0, 0.25 - since) * 1.2;
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(this.cx, H * 0.13);
      ctx.scale(pop, pop);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = `900 ${Math.round(U * 0.055)}px ${FONT}`;
      ctx.fillText(String(combo), 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `800 ${Math.round(U * 0.018)}px ${FONT}`;
      ctx.fillText('COMBO', 0, U * 0.058);
      ctx.restore();
    }

    // Progress bar.
    const frac = clamp(audioTime / Math.max(0.001, this.analysis.duration), 0, 1);
    const barY = H - U * 0.018;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(pad, barY, W - pad * 2, U * 0.006);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(pad, barY, (W - pad * 2) * frac, U * 0.006);

    ctx.restore();
  }

  private drawCountdown(ctx: Ctx2D, audioTime: number): void {
    const { W, H, U } = this;
    const remaining = -audioTime;
    const n = Math.ceil(remaining);
    const frac = n - remaining;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 2, 16, 0.45)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const label = n <= 1 ? 'GO!' : String(n - 1);
    const scale = 1 + (1 - easeOut(frac)) * 0.6;
    ctx.save();
    ctx.translate(this.cx, H * 0.34);
    ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(1 - frac * 0.25, 0, 1);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 ${Math.round(U * 0.17)}px ${FONT}`;
    ctx.fillText(label, 0, 0);
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `800 ${Math.round(U * 0.030)}px ${FONT}`;
    ctx.fillText('FOLLOW THE MOVES', this.cx, H * 0.50);
    ctx.restore();
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
