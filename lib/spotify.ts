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

/**
 * Spotify explains its refusals in the response body. Discarding that leaves
 * a bare status code, which is never enough to act on.
 */
async function spotifyReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: string | { message?: string; reason?: string };
      error_description?: string;
    };
    if (typeof body.error === 'string') {
      return body.error_description ? `${body.error}: ${body.error_description}` : body.error;
    }
    const e = body.error;
    if (e?.message) return e.reason ? `${e.message} (${e.reason})` : e.message;
  } catch {
    // Not JSON — nothing to add beyond the status.
  }
  return '';
}

/** Base URL is overridable so the error paths can be tested against a mock. */
const API_BASE = process.env.SPOTIFY_API_BASE || 'https://api.spotify.com';

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

  const res = await fetch(`${process.env.SPOTIFY_ACCOUNTS_BASE || 'https://accounts.spotify.com'}/api/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!res.ok) {
    const reason = await spotifyReason(res);
    throw new SpotifyError(
      res.status === 400 || res.status === 401
        ? `Spotify rejected the client credentials${reason ? `: ${reason}` : ''} — check ` +
          `SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET for stray spaces or newlines.`
        : `Spotify token request failed with HTTP ${res.status}${reason ? `: ${reason}` : ''}.`,
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
  const res = await fetch(`${API_BASE}/v1/tracks/${trackId}`, {
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
  if (res.status === 403) {
    const reason = await spotifyReason(res);
    throw new SpotifyError(
      `Spotify refused this request${reason ? `: ${reason}` : ' (403)'}. The usual cause is the ` +
        `app still being in Development Mode — reports indicate Spotify's February 2026 migration ` +
        `moved Dev Mode apps off the Client Credentials flow for metadata, and now expects the ` +
        `app owner to have Premium. Check the app's mode in the Spotify dashboard. The ` +
        `"Use my own audio" tab needs no Spotify account at all.`,
      403,
    );
  }
  if (!res.ok) {
    const reason = await spotifyReason(res);
    throw new SpotifyError(`Spotify returned HTTP ${res.status}${reason ? `: ${reason}` : ''}.`);
  }

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
