import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { createCanvas, get2d } from '../canvas-utils';
import {
  fillPlanarChunk,
  nextTick,
  throwIfAborted,
  videoBitrate,
  type RenderRequest,
  type RenderResult,
} from './common';

const AVC_CANDIDATES = ['avc1.640029', 'avc1.64002A', 'avc1.4D0029', 'avc1.42E01E'];

export function hasWebCodecs(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioData !== 'undefined'
  );
}

async function pickVideoCodec(width: number, height: number, fps: number): Promise<string | null> {
  for (const codec of AVC_CANDIDATES) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate: fps,
        bitrate: videoBitrate(width, height, fps),
      });
      if (supported) return codec;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function pickAudioCodec(
  sampleRate: number,
  channels: number,
): Promise<{ encoderCodec: string; muxerCodec: 'aac' | 'opus' } | null> {
  const options: { encoderCodec: string; muxerCodec: 'aac' | 'opus' }[] = [
    { encoderCodec: 'mp4a.40.2', muxerCodec: 'aac' },
    { encoderCodec: 'opus', muxerCodec: 'opus' },
  ];
  for (const opt of options) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec: opt.encoderCodec,
        sampleRate,
        numberOfChannels: channels,
        bitrate: 192_000,
      });
      if (supported) return opt;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * True if this browser can produce a *widely playable* MP4 at these settings.
 *
 * Deliberately also requires AAC. Some Chromium builds ship an H.264 encoder
 * but no AAC encoder, and MP4-with-Opus plays in Chrome and VLC but not in
 * QuickTime or most phone galleries — so auto mode should pick WebM there
 * instead. Choosing MP4 explicitly still falls back to Opus.
 */
export async function canRenderMp4(width: number, height: number, fps: number): Promise<boolean> {
  if (!(await canRenderMp4AnyAudio(width, height, fps))) return false;
  return hasAacEncoder();
}

/** H.264 is available, even if the audio has to fall back to Opus. */
export async function canRenderMp4AnyAudio(
  width: number,
  height: number,
  fps: number,
): Promise<boolean> {
  if (!hasWebCodecs()) return false;
  return (await pickVideoCodec(width, height, fps)) !== null;
}

export async function hasAacEncoder(): Promise<boolean> {
  if (!hasWebCodecs()) return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    return Boolean(supported);
  } catch {
    return false;
  }
}

export async function renderMp4(req: RenderRequest): Promise<RenderResult> {
  const { scene, audioBuffer, width, height, fps, leadIn, totalDuration, onProgress, signal } = req;

  if (!hasWebCodecs()) throw new Error('This browser has no WebCodecs support.');

  const videoCodec = await pickVideoCodec(width, height, fps);
  if (!videoCodec) throw new Error('No supported H.264 encoder configuration.');

  const sampleRate = audioBuffer.sampleRate;
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const audio = await pickAudioCodec(sampleRate, channels);
  if (!audio) throw new Error('No supported audio encoder configuration.');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: audio.muxerCodec, numberOfChannels: channels, sampleRate },
    fastStart: 'in-memory',
  });

  let encodeError: unknown = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  videoEncoder.configure({
    codec: videoCodec,
    width,
    height,
    framerate: fps,
    bitrate: videoBitrate(width, height, fps),
    latencyMode: 'quality',
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  audioEncoder.configure({
    codec: audio.encoderCodec,
    sampleRate,
    numberOfChannels: channels,
    bitrate: 192_000,
  });

  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);

  try {
    // ---- audio first: it is cheap and gets the track into the muxer early.
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const leadInSamples = Math.round(leadIn * sampleRate);
    const CHUNK = 4800;
    const planar = new Float32Array(CHUNK * channels);

    for (let s = 0; s < totalSamples; s += CHUNK) {
      throwIfAborted(signal);
      if (encodeError) throw encodeError;

      const frames = Math.min(CHUNK, totalSamples - s);
      const view = frames === CHUNK ? planar : new Float32Array(frames * channels);
      fillPlanarChunk(view, channels, frames, s, leadInSamples, audioBuffer);

      const data = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((s / sampleRate) * 1e6),
        data: view,
      });
      audioEncoder.encode(data);
      data.close();

      if ((s / CHUNK) % 40 === 0) {
        onProgress?.(0.02 * (s / totalSamples), 'Encoding audio');
        await nextTick();
      }
    }
    await audioEncoder.flush();

    // ---- then every video frame.
    const totalFrames = Math.ceil(totalDuration * fps);
    const keyEvery = fps * 2;

    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal);
      if (encodeError) throw encodeError;

      scene.draw(ctx, i / fps);

      const frame = new VideoFrame(canvas as unknown as CanvasImageSource, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();

      // Keep the encoder queue short so memory stays bounded.
      while (videoEncoder.encodeQueueSize > 8) {
        throwIfAborted(signal);
        await new Promise((r) => setTimeout(r, 2));
      }

      if (i % 10 === 0) {
        onProgress?.(0.02 + 0.94 * (i / totalFrames), `Rendering frame ${i + 1} of ${totalFrames}`);
        await nextTick();
      }
    }

    onProgress?.(0.97, 'Finalizing');
    await videoEncoder.flush();
    if (encodeError) throw encodeError;

    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;
    onProgress?.(1, 'Done');

    return { blob: new Blob([buffer], { type: 'video/mp4' }), format: 'mp4', extension: 'mp4' };
  } finally {
    for (const enc of [videoEncoder, audioEncoder]) {
      if (enc.state !== 'closed') {
        try { enc.close(); } catch { /* already torn down */ }
      }
    }
  }
}
