export type SpotifyTrack = {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  album: string;
  hasArt: boolean;
};

export class SpotifyError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'SpotifyError';
  }
}

/**
 * Accepts an open.spotify.com link (with or without an /intl-xx/ locale
 * segment), a spotify:track: URI, or a bare 22-character base62 id.
 */
export function parseTrackId(input: string): string | null {
  const raw = input.trim();
  if (/^[A-Za-z0-9]{22}$/.test(raw)) return raw;

  const uri = raw.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];

  let u: URL;
  try {
    u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!u.hostname.replace(/^www\./, '').endsWith('spotify.com')) return null;

  const m = u.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

type Token = { value: string; expiresAt: number };
let cachedToken: Token | null = null;

/**
 * Client Credentials flow — this only ever reads public catalogue data, so
 * there is no user to send through an authorization code flow.
 */
async function getToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new SpotifyError(
      'Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the ' +
        "project's environment variables (see the README).",
      503,
    );
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new SpotifyError(
      res.status === 400 || res.status === 401
        ? 'Spotify rejected the client credentials — check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.'
        : `Spotify token request failed with HTTP ${res.status}.`,
      res.status === 400 || res.status === 401 ? 401 : 502,
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return cachedToken.value;
}

type RawTrack = {
  id: string;
  name: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string; width: number; height: number }[] };
};

async function getRawTrack(trackId: string): Promise<RawTrack> {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404) throw new SpotifyError('No Spotify track with that id.', 404);
  if (res.status === 401) {
    cachedToken = null;
    throw new SpotifyError('Spotify token was rejected. Try again.', 401);
  }
  if (res.status === 429) {
    throw new SpotifyError('Spotify is rate limiting this app. Wait a moment and retry.', 429);
  }
  if (!res.ok) throw new SpotifyError(`Spotify returned HTTP ${res.status}.`);

  return (await res.json()) as RawTrack;
}

export async function fetchTrack(trackId: string): Promise<SpotifyTrack> {
  const raw = await getRawTrack(trackId);
  return {
    id: raw.id,
    title: raw.name,
    artist: raw.artists?.map((a) => a.name).join(', ') || 'Unknown artist',
    album: raw.album?.name ?? '',
    durationSec: Math.round((raw.duration_ms ?? 0) / 1000),
    hasArt: Boolean(raw.album?.images?.length),
  };
}

/** Largest available cover image, or null. */
export async function fetchArtUrl(trackId: string): Promise<string | null> {
  const raw = await getRawTrack(trackId);
  const images = raw.album?.images ?? [];
  if (!images.length) return null;
  return images.reduce((best, img) => ((img.width ?? 0) > (best.width ?? 0) ? img : best)).url;
}
