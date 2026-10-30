import { canRenderMp4, canRenderMp4AnyAudio, renderMp4 } from './encode/mp4';
import { canRenderWebm, renderWebm } from './encode/webm';
import type { ExportFormat, RenderRequest, RenderResult } from './encode/common';

export type { ExportFormat, RenderRequest, RenderResult };

export type Capability = {
  /** H.264 + AAC: an MP4 that plays everywhere. Auto mode needs this. */
  mp4: boolean;
  /** H.264 available, but the audio would be Opus — playable in fewer apps. */
  mp4OpusOnly: boolean;
  webm: boolean;
};

export async function detectCapability(
  width: number,
  height: number,
  fps: number,
): Promise<Capability> {
  const [mp4, anyAudio] = await Promise.all([
    canRenderMp4(width, height, fps),
    canRenderMp4AnyAudio(width, height, fps),
  ]);
  return { mp4, mp4OpusOnly: anyAudio && !mp4, webm: canRenderWebm() };
}

/**
 * Prefer the WebCodecs MP4 path: it renders faster than real time and the
 * file plays everywhere. Fall back to real-time WebM recording only when the
 * browser cannot do it.
 */
export async function renderVideo(
  req: RenderRequest,
  preferred: ExportFormat | 'auto' = 'auto',
): Promise<RenderResult> {
  const caps = await detectCapability(req.width, req.height, req.fps);

  if (preferred === 'mp4' && !caps.mp4 && !caps.mp4OpusOnly) {
    throw new Error('This browser cannot export MP4.');
  }
  if (preferred === 'webm' && !caps.webm) throw new Error('This browser cannot record WebM.');

  const useMp4 = preferred === 'mp4' || (preferred === 'auto' && caps.mp4);
  if (useMp4) return renderMp4(req);
  if (caps.webm) return renderWebm(req);

  throw new Error('This browser supports neither WebCodecs nor WebM recording.');
}
