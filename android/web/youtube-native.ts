/**
 * On-device YouTube audio resolution for the Android app.
 *
 * All network goes through the native bridge (window.AndroidNative.http), which
 * performs the request in Java on the phone's own connection — no CORS, and a
 * residential IP that YouTube does not bot-check the way it blocks datacenter
 * ranges. This is the same job lib/youtube.ts does on the server, reimplemented
 * minimally for the browser-bridge context.
 *
 * It asks the mobile Innertube clients first because those historically return
 * adaptiveFormats with a direct `url`, avoiding signature-cipher deciphering.
 */

export type NativeBridge = {
  /** Returns JSON: {status, headers, body} where body is base64 of the bytes. */
  http(url: string, method: string, headersJson: string, body: string): string;
  /** Writes a video to the phone's storage, returns the saved path. */
  saveVideo(name: string, dataB64: string): string;
};

declare global {
  interface Window {
    AndroidNative?: NativeBridge;
  }
}

export function hasNativeBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.AndroidNative?.http === 'function';
}

type NativeResponse = { status: number; headers: Record<string, string>; bodyB64: string };

function nativeHttp(
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: string,
): NativeResponse {
  if (!window.AndroidNative) throw new Error('Native bridge unavailable.');
  const raw = window.AndroidNative.http(url, method, JSON.stringify(headers), body ?? '');
  const parsed = JSON.parse(raw) as { status: number; headers?: Record<string, string>; body: string };
  return { status: parsed.status, headers: parsed.headers ?? {}, bodyB64: parsed.body };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64ToText(b64: string): string {
  return new TextDecoder().decode(b64ToBytes(b64));
}

/** Innertube clients that tend to hand back direct audio URLs. */
const CLIENTS = [
  {
    name: 'IOS',
    key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    version: '19.29.1',
    userAgent: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
    context: { deviceModel: 'iPhone16,2' },
  },
  {
    name: 'ANDROID',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    version: '19.29.37',
    userAgent: 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
    context: { androidSdkVersion: 34 },
  },
  {
    name: 'TVHTML5',
    key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    version: '7.20240724.13.00',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15',
    context: {},
  },
] as const;

export type ResolvedTrack = {
  title: string;
  author: string;
  durationSec: number;
  audioUrl: string;
  mimeType: string;
};

type Format = {
  mimeType?: string;
  url?: string;
  bitrate?: number;
  contentLength?: string;
  audioQuality?: string;
};

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
  if (host.endsWith('youtube.com')) {
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function pickAudio(formats: Format[]): Format | null {
  const audio = formats.filter((f) => f.mimeType?.startsWith('audio/') && f.url);
  if (!audio.length) return null;
  // Highest bitrate wins.
  return audio.reduce((best, f) => ((f.bitrate ?? 0) > (best.bitrate ?? 0) ? f : best));
}

export async function resolveTrack(videoId: string): Promise<ResolvedTrack> {
  const errors: string[] = [];

  for (const client of CLIENTS) {
    try {
      const body = JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: client.name,
            clientVersion: client.version,
            hl: 'en',
            gl: 'US',
            ...client.context,
          },
        },
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
        contentCheckOk: true,
        racyCheckOk: true,
      });

      const res = nativeHttp(
        `https://www.youtube.com/youtubei/v1/player?key=${client.key}&prettyPrint=false`,
        'POST',
        {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'X-Goog-Api-Format-Version': '2',
        },
        body,
      );

      if (res.status !== 200) {
        errors.push(`${client.name}: HTTP ${res.status}`);
        continue;
      }

      const data = JSON.parse(b64ToText(res.bodyB64)) as {
        playabilityStatus?: { status?: string; reason?: string };
        videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
        streamingData?: { adaptiveFormats?: Format[]; formats?: Format[] };
      };

      const status = data.playabilityStatus?.status;
      if (status && status !== 'OK') {
        errors.push(`${client.name}: ${data.playabilityStatus?.reason || status}`);
        continue;
      }

      const formats = [
        ...(data.streamingData?.adaptiveFormats ?? []),
        ...(data.streamingData?.formats ?? []),
      ];
      const audio = pickAudio(formats);
      if (!audio?.url) {
        errors.push(`${client.name}: no direct audio URL (likely needs a PO token)`);
        continue;
      }

      return {
        title: data.videoDetails?.title ?? 'YouTube track',
        author: data.videoDetails?.author ?? 'Unknown',
        durationSec: Number(data.videoDetails?.lengthSeconds ?? 0),
        audioUrl: audio.url,
        mimeType: audio.mimeType?.split(';')[0] ?? 'audio/webm',
      };
    } catch (err) {
      errors.push(`${client.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Could not resolve audio on-device. Tried: ${errors.join(' | ')}`);
}

/** Fetches the audio bytes through the native bridge. */
export async function fetchAudio(track: ResolvedTrack): Promise<ArrayBuffer> {
  const res = nativeHttp(track.audioUrl, 'GET', {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile',
    Range: 'bytes=0-',
  });
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(`Audio download failed: HTTP ${res.status}`);
  }
  const bytes = b64ToBytes(res.bodyB64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
