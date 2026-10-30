import { get2d } from '../canvas-utils';
import { throwIfAborted, type RenderRequest, type RenderResult } from './common';
import { videoBitrate } from './common';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
];

export function pickWebmMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function canRenderWebm(): boolean {
  return pickWebmMime() !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/**
 * Fallback path for browsers without WebCodecs.
 *
 * MediaRecorder can only capture in real time, so a four-minute track takes
 * four minutes. The AudioContext clock drives the draw loop rather than
 * requestAnimationFrame's timestamp, which keeps the visuals locked to the
 * audio even if a frame or two is dropped.
 */
export async function renderWebm(req: RenderRequest): Promise<RenderResult> {
  const { scene, audioBuffer, width, height, fps, leadIn, totalDuration, onProgress, signal } = req;

  const mime = pickWebmMime();
  if (!mime) throw new Error('This browser cannot record WebM.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = get2d(canvas);

  const audioCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);

  const stream = new MediaStream([
    ...canvas.captureStream(fps).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: videoBitrate(width, height, fps),
    audioBitsPerSecond: 192_000,
  });

  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };

  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  recorder.start(1000);
  const t0 = audioCtx.currentTime + 0.15;
  source.start(t0 + leadIn);

  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) {
          reject(new DOMException('Render cancelled', 'AbortError'));
          return;
        }
        const t = audioCtx.currentTime - t0;
        if (t >= totalDuration) { resolve(); return; }
        if (t >= 0) {
          scene.draw(ctx, t);
          onProgress?.(Math.min(1, t / totalDuration), `Recording ${t.toFixed(1)}s of ${totalDuration.toFixed(0)}s`);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    try { source.stop(); } catch { /* may have ended already */ }
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    await audioCtx.close();
  }

  throwIfAborted(signal);
  onProgress?.(1, 'Done');
  return { blob: new Blob(parts, { type: mime }), format: 'webm', extension: 'webm' };
}
