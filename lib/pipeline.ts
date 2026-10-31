import type { TrackInfo } from './youtube';

export type SourceMeta = { title: string; artist: string; videoId: string | null };

let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext();
  return sharedCtx;
}

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = audioContext();
  // decodeAudioData detaches the buffer, so hand it a copy we own.
  return ctx.decodeAudioData(data.slice(0));
}

async function readError(res: Response): Promise<string> {
  // Read as text so a non-JSON body (a framework error page, a crash) is not
  // discarded — an opaque "HTTP 500" with no detail is impossible to diagnose
  // remotely, which matters most in the packaged desktop app.
  let text = '';
  try {
    text = await res.text();
  } catch {
    return `Request failed with HTTP ${res.status}.`;
  }

  try {
    const body = JSON.parse(text) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON — fall through to the snippet */
  }

  const snippet = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return snippet
    ? `HTTP ${res.status}: ${snippet}`
    : `Request failed with HTTP ${res.status}.`;
}

export async function resolveYouTube(url: string): Promise<TrackInfo> {
  const res = await fetch('/api/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchYouTubeAudio(
  videoId: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(`/api/audio?v=${encodeURIComponent(videoId)}`);
  if (!res.ok) throw new Error(await readError(res));

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;

  if (!res.body) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

export async function fetchYouTubeArt(videoId: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(`/api/art?v=${encodeURIComponent(videoId)}`);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

export async function bitmapFromFile(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/** Strip the usual "(Official Video)" noise so the on-screen title reads well. */
export function splitTitle(info: TrackInfo): SourceMeta {
  const cleaned = info.title
    .replace(/[([][^)\]]*(official|video|audio|lyric|hd|4k|mv)[^)\]]*[)\]]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const dash = cleaned.match(/^(.*?)\s+[-–—]\s+(.*)$/);
  if (dash) return { title: dash[2].trim(), artist: dash[1].trim(), videoId: info.id };
  return { title: cleaned || info.title, artist: info.author, videoId: info.id };
}

// ---- SoundCloud ----

export type SoundCloudMeta = { id: number; title: string; artist: string; durationSec: number; artwork: string | null };

export async function probeSoundCloud(): Promise<boolean> {
  try {
    const res = await fetch('/api/soundcloud', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { enabled?: boolean };
    return Boolean(body.enabled);
  } catch {
    return false;
  }
}

export async function resolveSoundCloud(url: string): Promise<SoundCloudMeta> {
  const res = await fetch('/api/soundcloud', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchSoundCloudAudio(
  url: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(`/api/soundcloud/audio?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(await readError(res));
  const total = res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out.buffer;
}

export async function fetchSoundCloudArt(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(`/api/soundcloud/art?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}
