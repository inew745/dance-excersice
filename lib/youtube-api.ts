/**
 * Official YouTube Data API v3.
 *
 * Metadata and search only — the Data API has no endpoint that returns a
 * media stream, so audio still goes through lib/youtube.ts (Innertube).
 * This exists because metadata lookups are the half that *can* be done
 * officially, and an API key is not bot-checked the way a datacenter IP is.
 */
const API_BASE = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';

export class YouTubeApiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

export type ApiVideo = {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnail: string | null;
};

export function hasApiKey(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function requireKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new YouTubeApiError(
      'YOUTUBE_API_KEY is not set. Add it in the project environment variables to enable ' +
        'official metadata and search (see the README).',
      503,
    );
  }
  return key;
}

/** Google explains refusals in the body; a bare status is not actionable. */
async function googleReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    const message = body.error?.message;
    const reason = body.error?.errors?.[0]?.reason;
    if (message && reason) return `${message} (${reason})`;
    if (message) return message;
  } catch {
    // Not JSON.
  }
  return '';
}

async function call(path: string, params: Record<string, string>): Promise<unknown> {
  const key = requireKey();
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const reason = await googleReason(res);
    if (res.status === 403) {
      throw new YouTubeApiError(
        `YouTube API refused the request${reason ? `: ${reason}` : ''}. Usually the daily quota ` +
          `is spent (search costs 100 units of 10,000), the key is restricted to other ` +
          `referrers/IPs, or the YouTube Data API is not enabled for the project.`,
        403,
      );
    }
    if (res.status === 400) {
      throw new YouTubeApiError(`YouTube API rejected the request${reason ? `: ${reason}` : ''}.`, 400);
    }
    throw new YouTubeApiError(`YouTube API returned HTTP ${res.status}${reason ? `: ${reason}` : ''}.`);
  }
  return res.json();
}

/** ISO-8601 durations as the API returns them, e.g. PT4M13S or P1DT2H. */
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

type ThumbSet = Record<string, { url: string; width?: number } | undefined>;

function bestThumb(thumbs: ThumbSet | undefined): string | null {
  if (!thumbs) return null;
  const list = Object.values(thumbs).filter(Boolean) as { url: string; width?: number }[];
  if (!list.length) return null;
  return list.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a)).url;
}

type VideoItem = {
  id: string;
  snippet?: { title?: string; channelTitle?: string; thumbnails?: ThumbSet };
  contentDetails?: { duration?: string };
};

export async function fetchVideos(ids: string[]): Promise<ApiVideo[]> {
  if (!ids.length) return [];
  const data = (await call('videos', {
    part: 'snippet,contentDetails',
    id: ids.join(','),
    maxResults: String(Math.min(50, ids.length)),
  })) as { items?: VideoItem[] };

  return (data.items ?? []).map((item) => ({
    id: item.id,
    title: item.snippet?.title ?? 'Untitled',
    channel: item.snippet?.channelTitle ?? 'Unknown channel',
    durationSec: parseIsoDuration(item.contentDetails?.duration ?? ''),
    thumbnail: bestThumb(item.snippet?.thumbnails),
  }));
}

export async function fetchVideo(id: string): Promise<ApiVideo> {
  const [video] = await fetchVideos([id]);
  if (!video) throw new YouTubeApiError('No video with that id, or it is private.', 404);
  return video;
}

type SearchItem = { id?: { videoId?: string } };

/**
 * search.list costs 100 quota units and omits durations, so the ids are run
 * back through videos.list (1 unit) to fill them in.
 */
export async function searchVideos(query: string, max = 12): Promise<ApiVideo[]> {
  const data = (await call('search', {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(Math.min(25, Math.max(1, max))),
  })) as { items?: SearchItem[] };

  const ids = (data.items ?? []).map((i) => i.id?.videoId).filter(Boolean) as string[];
  if (!ids.length) return [];

  const detailed = await fetchVideos(ids);
  // Preserve relevance order from search.list.
  const byId = new Map(detailed.map((v) => [v.id, v]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as ApiVideo[];
}
