import { Innertube } from 'youtubei.js';
import { proxiedFetch, usingProxy } from './fetcher';

export type TrackInfo = {
  id: string;
  title: string;
  author: string;
  durationSec: number;
  thumbnail: string | null;
};

/** Innertube is expensive to construct, so keep one per warm lambda. */
let clientPromise: Promise<Innertube> | null = null;

function getClient(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      generate_session_locally: true,
      // Routes Innertube through YOUTUBE_PROXY_URL when one is configured.
      fetch: proxiedFetch,
      // Optional escape hatches for when YouTube bot-checks Vercel's IPs.
      // See README: set these in the Vercel project's environment variables.
      cookie: process.env.YOUTUBE_COOKIE || undefined,
      po_token: process.env.YOUTUBE_PO_TOKEN || undefined,
      visitor_data: process.env.YOUTUBE_VISITOR_DATA || undefined,
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/** Accepts a full URL, a youtu.be link, a /shorts/ link, or a bare 11-char id. */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;

  let u: URL;
  try {
    u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/**
 * YouTube serves datacenter IPs a bot check far more often than residential
 * ones, and which client gets through moves around. Try the clients that tend
 * to hand back unsigned URLs first, then fall back to the web player.
 */
type Client = 'IOS' | 'ANDROID_VR' | 'ANDROID' | 'TV_SIMPLY' | 'MWEB' | 'WEB';

const CLIENTS: Client[] = ['IOS', 'ANDROID_VR', 'ANDROID', 'TV_SIMPLY', 'MWEB', 'WEB'];

export class YouTubeError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'YouTubeError';
  }
}

/**
 * Node's fetch reports almost every network problem as a bare "fetch failed"
 * and hides the real reason on `cause`. Without this, a DNS failure, a refused
 * proxy connection and a TLS error are indistinguishable in the logs.
 */
function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as NodeJS.ErrnoException).code;
    const text = code && !current.message.includes(code)
      ? `${current.message} [${code}]`
      : current.message;
    if (text && !parts.includes(text)) parts.push(text);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' — ') || String(err);
}

async function getInfo(videoId: string) {
  let yt: Innertube;
  try {
    yt = await getClient();
  } catch (err) {
    // Session setup failing means YouTube was not reachable at all, which is a
    // different problem from a video being unavailable — say so plainly rather
    // than letting a bare "fetch failed" reach the user.
    const detail = describeError(err);
    throw new YouTubeError(
      `Could not reach YouTube from the server (${detail}). Check the deployment's outbound ` +
        `network access, or use the "Use my own audio" tab.`,
      502,
    );
  }

  let lastErr: unknown = null;

  for (const client of CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      if (info.playability_status?.status === 'OK') return { yt, info };
      lastErr = new Error(
        info.playability_status?.reason || `playability: ${info.playability_status?.status}`,
      );
    } catch (err) {
      lastErr = err;
    }
  }

  const detail = describeError(lastErr);
  if (/bot|sign in|consent|429/i.test(detail)) {
    throw new YouTubeError(
      `YouTube is bot-checking this server (${detail}).${
        usingProxy() ? ' The configured proxy did not get through either.' : ''
      } Fixes, most durable first: route through a non-datacenter IP with YOUTUBE_PROXY_URL, ` +
        `set YOUTUBE_COOKIE (use a throwaway Google account — Google can flag it), or use the ` +
        `"Use my own audio" tab, which never touches the server.`,
      429,
    );
  }
  throw new YouTubeError(`Could not read that video: ${detail}`);
}

export async function fetchTrackInfo(videoId: string): Promise<TrackInfo> {
  const { info } = await getInfo(videoId);
  const basic = info.basic_info;
  const thumbs = basic.thumbnail ?? [];
  const best = thumbs.reduce<{ url: string; width: number } | null>(
    (acc, t) => (!acc || (t.width ?? 0) > acc.width ? { url: t.url, width: t.width ?? 0 } : acc),
    null,
  );
  return {
    id: videoId,
    title: basic.title ?? 'Unknown title',
    author: basic.author ?? 'Unknown artist',
    durationSec: basic.duration ?? 0,
    thumbnail: best?.url ?? null,
  };
}

export type AudioSource = { url: string; mimeType: string; contentLength: number | null };

export async function resolveAudioSource(videoId: string): Promise<AudioSource> {
  const { yt, info } = await getInfo(videoId);

  const format = info.chooseFormat({ type: 'audio', quality: 'best' });
  if (!format) throw new YouTubeError('That video has no audio-only stream.');

  let url: string | undefined = format.url ?? undefined;
  if (!url || format.signature_cipher) {
    url = await format.decipher(yt.session.player);
  }
  if (!url) throw new YouTubeError('Could not resolve the audio stream URL.');

  return {
    url,
    mimeType: format.mime_type ?? 'audio/webm',
    contentLength: format.content_length ?? null,
  };
}
