import type { Scene } from '../scene';

export type ExportFormat = 'mp4' | 'webm';

export type RenderRequest = {
  scene: Scene;
  audioBuffer: AudioBuffer;
  width: number;
  height: number;
  fps: number;
  /** Seconds of countdown before the music starts. */
  leadIn: number;
  /** Total length of the output video, in seconds. */
  totalDuration: number;
  onProgress?: (fraction: number, note?: string) => void;
  signal?: AbortSignal;
};

export type RenderResult = { blob: Blob; format: ExportFormat; extension: string };

export const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
}

/**
 * Copy `frames` samples of planar audio starting at `destSample` on the video
 * timeline, reading from the track (which begins at `leadInSamples`).
 * Anything outside the track is silence, which is what fills the countdown.
 */
export function fillPlanarChunk(
  out: Float32Array,
  channels: number,
  frames: number,
  destSample: number,
  leadInSamples: number,
  audioBuffer: AudioBuffer,
): void {
  out.fill(0);
  const srcStart = destSample - leadInSamples;
  for (let c = 0; c < channels; c++) {
    const src = audioBuffer.getChannelData(Math.min(c, audioBuffer.numberOfChannels - 1));
    for (let i = 0; i < frames; i++) {
      const s = srcStart + i;
      if (s < 0 || s >= src.length) continue;
      out[c * frames + i] = src[s];
    }
  }
}

/** Rough but sane bitrate: enough for flat colour and glow without bloating. */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * 0.11);
}
