import { FFT, hannWindow } from './fft';

export const WIN = 2048;
export const HOP = 512;
/** One band per lane, so a lane can be picked from what the music is doing. */
export const BANDS = 5;
/** Log-spaced bins kept per hop for the on-screen EQ. */
export const SPECTRUM_BINS = 48;

/** Hz edges: kick / low-mid / mid / snare-clap / hats. */
const BAND_EDGES = [20, 120, 400, 1200, 4000, 16000];

export type Onset = { t: number; strength: number; band: number };

export type Analysis = {
  duration: number;
  sampleRate: number;
  hopSec: number;
  hops: number;
  bpm: number;
  /** Seconds from t=0 to the first beat of the grid. */
  beatOffset: number;
  /** Onset strength per hop, normalized to 0..1. */
  envelope: Float32Array;
  /** RMS per hop, normalized to 0..1. */
  level: Float32Array;
  /** BANDS rows of `hops` values, normalized to 0..1. */
  bandEnergy: Float32Array;
  /** SPECTRUM_BINS rows of `hops` values, normalized to 0..1. */
  spectrum: Float32Array;
  onsets: Onset[];
};

function toMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const scale = 1 / Math.max(1, buffer.numberOfChannels);
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export async function analyzeAudio(
  buffer: AudioBuffer,
  onProgress?: (fraction: number) => void,
): Promise<Analysis> {
  const sampleRate = buffer.sampleRate;
  const samples = toMono(buffer);
  const hops = Math.max(1, Math.floor((samples.length - WIN) / HOP) + 1);
  const hopSec = HOP / sampleRate;

  const fft = new FFT(WIN);
  const window = hannWindow(WIN);
  const re = new Float32Array(WIN);
  const im = new Float32Array(WIN);
  const half = WIN >>> 1;

  const mag = new Float32Array(half);
  const prevMag = new Float32Array(half);

  const envelope = new Float32Array(hops);
  const level = new Float32Array(hops);
  const bandEnergy = new Float32Array(BANDS * hops);
  const spectrum = new Float32Array(SPECTRUM_BINS * hops);

  // Precompute which FFT bin belongs to which band / spectrum bin.
  const binHz = sampleRate / WIN;
  const bandOfBin = new Int8Array(half);
  const specOfBin = new Int16Array(half);
  const minHz = 30;
  const maxHz = Math.min(16000, sampleRate / 2);
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);

  for (let k = 1; k < half; k++) {
    const hz = k * binHz;

    let band = -1;
    for (let b = 0; b < BANDS; b++) {
      if (hz >= BAND_EDGES[b] && hz < BAND_EDGES[b + 1]) { band = b; break; }
    }
    bandOfBin[k] = band;

    if (hz < minHz || hz > maxHz) {
      specOfBin[k] = -1;
    } else {
      const f = (Math.log(hz) - logMin) / (logMax - logMin);
      specOfBin[k] = Math.min(SPECTRUM_BINS - 1, Math.floor(f * SPECTRUM_BINS));
    }
  }

  const specCount = new Float32Array(SPECTRUM_BINS);
  const bandCount = new Float32Array(BANDS);
  for (let k = 1; k < half; k++) {
    if (specOfBin[k] >= 0) specCount[specOfBin[k]]++;
    if (bandOfBin[k] >= 0) bandCount[bandOfBin[k]]++;
  }

  const specAcc = new Float32Array(SPECTRUM_BINS);
  const bandAcc = new Float32Array(BANDS);
  // Log compression keeps a loud chorus from swamping a quiet verse.
  const LAMBDA = 20;

  for (let h = 0; h < hops; h++) {
    const start = h * HOP;

    let sumSq = 0;
    for (let i = 0; i < WIN; i++) {
      const s = samples[start + i] ?? 0;
      sumSq += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    level[h] = Math.sqrt(sumSq / WIN);

    fft.transform(re, im);

    specAcc.fill(0);
    bandAcc.fill(0);
    let flux = 0;

    for (let k = 1; k < half; k++) {
      const m = Math.log1p(LAMBDA * Math.hypot(re[k], im[k]));
      mag[k] = m;

      const d = m - prevMag[k];
      if (d > 0) flux += d;

      const sb = specOfBin[k];
      if (sb >= 0) specAcc[sb] += m;
      const bb = bandOfBin[k];
      if (bb >= 0) bandAcc[bb] += m;
    }

    envelope[h] = flux;
    for (let b = 0; b < SPECTRUM_BINS; b++) {
      spectrum[b * hops + h] = specCount[b] > 0 ? specAcc[b] / specCount[b] : 0;
    }
    for (let b = 0; b < BANDS; b++) {
      bandEnergy[b * hops + h] = bandCount[b] > 0 ? bandAcc[b] / bandCount[b] : 0;
    }

    prevMag.set(mag);

    if ((h & 255) === 0) {
      onProgress?.(h / hops);
      await nextFrame();
    }
  }

  normalize(envelope);
  normalize(level);
  normalizeRows(spectrum, SPECTRUM_BINS, hops);
  normalizeRows(bandEnergy, BANDS, hops);

  const onsets = pickOnsets(envelope, bandEnergy, hops, hopSec);
  const { bpm, beatOffset } = estimateTempo(envelope, hopSec);

  onProgress?.(1);

  return {
    duration: buffer.duration,
    sampleRate,
    hopSec,
    hops,
    bpm,
    beatOffset,
    envelope,
    level,
    bandEnergy,
    spectrum,
    onsets,
  };
}

function normalize(a: Float32Array): void {
  let max = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
  if (max <= 0) return;
  for (let i = 0; i < a.length; i++) a[i] /= max;
}

/** Normalize each row against a shared max so relative band balance survives. */
function normalizeRows(a: Float32Array, rows: number, cols: number): void {
  let max = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
  if (max <= 0) return;
  for (let i = 0; i < a.length; i++) a[i] /= max;
  void rows; void cols;
}

/**
 * Peak picking with a moving-average threshold (Dixon, "Onset Detection
 * Revisited"): a peak must be a local max and stand above the local mean.
 */
function pickOnsets(
  envelope: Float32Array,
  bandEnergy: Float32Array,
  hops: number,
  hopSec: number,
): Onset[] {
  const localMax = 3;
  const meanSpan = Math.max(4, Math.round(0.12 / hopSec));
  const delta = 1.45;
  const floor = 0.02;
  const minGapHops = Math.max(1, Math.round(0.06 / hopSec));

  const out: Onset[] = [];
  let lastHop = -minGapHops;

  for (let h = 1; h < hops - 1; h++) {
    const v = envelope[h];
    if (v < floor) continue;

    let isPeak = true;
    for (let d = -localMax; d <= localMax; d++) {
      const j = h + d;
      if (j < 0 || j >= hops || j === h) continue;
      if (envelope[j] > v) { isPeak = false; break; }
    }
    if (!isPeak) continue;

    let sum = 0;
    let count = 0;
    for (let j = h - meanSpan; j <= h + meanSpan; j++) {
      if (j < 0 || j >= hops) continue;
      sum += envelope[j];
      count++;
    }
    if (v < (sum / count) * delta + floor) continue;
    if (h - lastHop < minGapHops) continue;

    let band = 0;
    let best = -1;
    for (let b = 0; b < BANDS; b++) {
      const e = bandEnergy[b * hops + h];
      if (e > best) { best = e; band = b; }
    }

    out.push({ t: h * hopSec, strength: v, band });
    lastHop = h;
  }

  return out;
}

/**
 * Autocorrelate the onset envelope to find the beat period, then slide a
 * beat grid across the track to find the phase that lands on most energy.
 */
function estimateTempo(envelope: Float32Array, hopSec: number): { bpm: number; beatOffset: number } {
  const n = envelope.length;
  if (n < 32) return { bpm: 120, beatOffset: 0 };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= n;

  const centered = new Float32Array(n);
  for (let i = 0; i < n; i++) centered[i] = envelope[i] - mean;

  const minLag = Math.max(2, Math.round(60 / 200 / hopSec)); // 200 BPM
  const maxLag = Math.min(n - 1, Math.round(60 / 55 / hopSec)); // 55 BPM

  const score = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += centered[i] * centered[i + lag];
    score[lag] = s / (n - lag);
  }

  // Reward lags whose multiples also score well, so we lock onto the beat
  // rather than an eighth-note subdivision.
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = score[lag];
    for (const mult of [2, 3, 4]) {
      const l = lag * mult;
      if (l <= maxLag) s += score[l] / mult;
    }
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }

  let bpm = 60 / (bestLag * hopSec);
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  const periodHops = 60 / bpm / hopSec;
  let bestOffset = 0;
  let bestEnergy = -Infinity;
  const steps = Math.max(1, Math.round(periodHops));
  for (let off = 0; off < steps; off++) {
    let e = 0;
    for (let b = 0; ; b++) {
      const h = Math.round(off + b * periodHops);
      if (h >= n) break;
      e += envelope[h];
    }
    if (e > bestEnergy) { bestEnergy = e; bestOffset = off; }
  }

  return { bpm, beatOffset: bestOffset * hopSec };
}

/** Sample a per-hop series at an arbitrary time, with linear interpolation. */
export function sampleSeries(series: Float32Array, hops: number, row: number, t: number, hopSec: number): number {
  const x = t / hopSec;
  const i = Math.floor(x);
  if (i < 0) return series[row * hops];
  if (i >= hops - 1) return series[row * hops + hops - 1];
  const f = x - i;
  const a = series[row * hops + i];
  const b = series[row * hops + i + 1];
  return a + (b - a) * f;
}
