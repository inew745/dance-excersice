import { BANDS, type Analysis } from './analyze';

export type Note = { t: number; lane: number; strength: number };
export type Chart = { notes: Note[]; bpm: number; beatOffset: number; lanes: number };

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

type Rules = {
  /** Grid step as a fraction of a beat. */
  step: number;
  /** Minimum onset strength for a grid slot to earn a note. */
  threshold: number;
  /** Chance of a second simultaneous note on an accented beat. */
  doubleChance: number;
};

const RULES: Record<Difficulty, Rules> = {
  easy:   { step: 2,   threshold: 0.16, doubleChance: 0 },
  normal: { step: 1,   threshold: 0.11, doubleChance: 0 },
  hard:   { step: 0.5, threshold: 0.13, doubleChance: 0.08 },
  expert: { step: 0.5, threshold: 0.07, doubleChance: 0.2 },
};

/** Deterministic PRNG so the same track always charts the same way. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bandEnergiesAt(analysis: Analysis, t: number): number[] {
  const h = Math.min(analysis.hops - 1, Math.max(0, Math.round(t / analysis.hopSec)));
  const out: number[] = [];
  for (let b = 0; b < BANDS; b++) out.push(analysis.bandEnergy[b * analysis.hops + h]);
  return out;
}

export function buildChart(analysis: Analysis, difficulty: Difficulty): Chart {
  const rules = RULES[difficulty];
  const rand = mulberry32(Math.round(analysis.bpm * 1000) ^ analysis.hops);

  const beat = 60 / analysis.bpm;
  const stepSec = beat * rules.step;
  const tolerance = Math.min(0.14, stepSec * 0.45);

  // Index onsets by time so each grid slot can look up nearby energy cheaply.
  const onsets = analysis.onsets;
  let cursor = 0;

  const notes: Note[] = [];
  let lastLane = -1;
  let sameLaneRun = 0;

  // Start on the first beat at or after t=0.
  let t = analysis.beatOffset;
  while (t < 0) t += stepSec;

  let slot = 0;
  for (; t < analysis.duration; t += stepSec, slot++) {
    while (cursor < onsets.length && onsets[cursor].t < t - tolerance) cursor++;

    let strength = 0;
    for (let i = cursor; i < onsets.length && onsets[i].t <= t + tolerance; i++) {
      if (onsets[i].strength > strength) strength = onsets[i].strength;
    }

    const isDownbeat = rules.step <= 1 && slot % Math.round(4 / rules.step) === 0;
    if (strength < rules.threshold && !(isDownbeat && strength > rules.threshold * 0.45)) continue;

    const energies = bandEnergiesAt(analysis, t);
    const order = energies
      .map((e, lane) => ({ e, lane }))
      .sort((a, b) => b.e - a.e);

    let lane = order[0].lane;
    if (lane === lastLane) {
      sameLaneRun++;
      // Three identical moves in a row is boring to dance and boring to watch.
      if (sameLaneRun >= 2) {
        lane = order[1]?.lane ?? (lane + 1) % BANDS;
        sameLaneRun = 0;
      }
    } else {
      sameLaneRun = 0;
    }
    lastLane = lane;

    notes.push({ t, lane, strength });

    if (rules.doubleChance > 0 && strength > 0.45 && rand() < rules.doubleChance) {
      const partner = order.find((o) => Math.abs(o.lane - lane) >= 2)?.lane;
      if (partner !== undefined) notes.push({ t, lane: partner, strength });
    }
  }

  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return { notes, bpm: analysis.bpm, beatOffset: analysis.beatOffset, lanes: BANDS };
}
