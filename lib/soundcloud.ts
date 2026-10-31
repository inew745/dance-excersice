/**
 * SoundCloud track resolution.
 *
 * SoundCloud's api-v2 (the one the web player uses) requires a client_id, and
 * official app registration has been closed for years — so this reads
 * SOUNDCLOUD_CLIENT_ID from the environment rather than embedding anything. No
 * bot-check or anti-fraud control is involved; this is an ordinary API call
 * with a credential the operator supplies.
 */
const API_BASE = process.env.SOUNDCLOUD_API_BASE || 'https://api-v2.soundcloud.com';

export class SoundCloudError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'SoundCloudError';
  }
}

export function hasClientId(): boolean {
  return Boolean(process.env.SOUNDCLOUD_CLIENT_ID);
}

function requireClientId(): string {
  const id = process.env.SOUNDCLOUD_CLIENT_ID;
  if (!id) {
    throw new SoundCloudError(
      'SoundCloud needs a client_id. Set SOUNDCLOUD_CLIENT_ID in the project environment ' +
        'variables (see the README). Official app registration is currently closed, so this ' +
        'works if you already have one.',
      503,
    );
  }
  return id;
}

/** A SoundCloud track or set link, with or without the mobile m. subdomain. */
export function isTrackUrl(input: string): boolean {
  const raw = input.trim();
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return /(^|\.)soundcloud\.com$/.test(u.hostname.replace(/^m\./, ''));
  } catch {
    return false;
  }
}

function normalizeUrl(input: string): string {
  const raw = input.trim();
  const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  u.hostname = u.hostname.replace(/^m\./, '');
  u.search = '';
  u.hash = '';
  return u.toString();
}

type Transcoding = {
  url?: string;
  format?: { protocol?: string; mime_type?: string };
  quality?: string;
};

type RawTrack = {
  id?: number;
  kind?: string;
  title?: string;
  duration?: number; // ms
  user?: { username?: string };
  artwork_url?: string | null;
  media?: { transcodings?: Transcoding[] };
  streamable?: boolean;
  policy?: string;
};

export type SoundCloudTrack = {
  id: number;
  title: string;
  artist: string;
  durationSec: number;
  artwork: string | null;
};

async function resolveRaw(trackUrl: string): Promise<RawTrack> {
  const clientId = requireClientId();
  const url = `${API_BASE}/resolve?url=${encodeURIComponent(normalizeUrl(trackUrl))}&client_id=${clientId}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401 || res.status === 403) {
    throw new SoundCloudError(
      'SoundCloud rejected the client_id (expired or invalid). Update SOUNDCLOUD_CLIENT_ID.',
      401,
    );
  }
  if (res.status === 404) throw new SoundCloudError('No SoundCloud track at that link.', 404);
  if (!res.ok) throw new SoundCloudError(`SoundCloud returned HTTP ${res.status}.`);

  const data = (await res.json()) as RawTrack;
  if (data.kind && data.kind !== 'track') {
    throw new SoundCloudError('That link is not a single track (playlists are not supported).', 400);
  }
  if (!data.id) throw new SoundCloudError('SoundCloud returned no track data.', 502);
  return data;
}

export async function fetchTrack(trackUrl: string): Promise<SoundCloudTrack> {
  const raw = await resolveRaw(trackUrl);
  return {
    id: raw.id!,
    title: raw.title ?? 'SoundCloud track',
    artist: raw.user?.username ?? 'Unknown artist',
    durationSec: Math.round((raw.duration ?? 0) / 1000),
    // Request the larger artwork size SoundCloud offers.
    artwork: raw.artwork_url ? raw.artwork_url.replace('-large.', '-t500x500.') : null,
  };
}

export type AudioSource = { url: string; mimeType: string };

/**
 * Returns a direct, time-limited audio URL. Prefers the single-file
 * `progressive` (MP3) transcoding; HLS is segmented and not supported here.
 */
export async function resolveAudio(trackUrl: string): Promise<AudioSource> {
  const clientId = requireClientId();
  const raw = await resolveRaw(trackUrl);

  if (raw.policy === 'BLOCK') {
    throw new SoundCloudError('This track is region-blocked.', 403);
  }
  const transcodings = raw.media?.transcodings ?? [];
  const progressive = transcodings.find((t) => t.format?.protocol === 'progressive');

  if (!progressive?.url) {
    const hasHls = transcodings.some((t) => t.format?.protocol === 'hls');
    throw new SoundCloudError(
      hasHls
        ? 'This track is only offered as a segmented (HLS) stream, which this app cannot download. ' +
          'Try a different track, or use the "Use my own audio" tab.'
        : 'This track exposes no downloadable audio stream.',
      422,
    );
  }

  const res = await fetch(`${progressive.url}?client_id=${clientId}`, { cache: 'no-store' });
  if (!res.ok) throw new SoundCloudError(`Could not resolve the stream URL (HTTP ${res.status}).`);
  const body = (await res.json()) as { url?: string };
  if (!body.url) throw new SoundCloudError('SoundCloud returned no stream URL.');

  return { url: body.url, mimeType: progressive.format?.mime_type ?? 'audio/mpeg' };
}
