import { NextResponse } from 'next/server';
import { fetchArtUrl, parseTrackId, SpotifyError } from '@/lib/spotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxied rather than hot-linked, for the same reason as the YouTube art: an
 * image drawn from an origin that sends no CORS headers taints the canvas and
 * breaks both export paths.
 *
 * Takes a track id and resolves the URL server-side — never a caller-supplied
 * URL, which would make this an open proxy.
 */
export async function GET(req: Request) {
  const trackId = parseTrackId(new URL(req.url).searchParams.get('id') ?? '');
  if (!trackId) return NextResponse.json({ error: 'Missing or invalid ?id=' }, { status: 400 });

  try {
    const url = await fetchArtUrl(trackId);
    if (!url) return NextResponse.json({ error: 'That track has no cover art.' }, { status: 404 });

    const res = await fetch(url);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Cover art fetch failed (${res.status}).` }, { status: 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'image/jpeg',
        'cache-control': 'public, max-age=86400',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    const status = err instanceof SpotifyError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}
