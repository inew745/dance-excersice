import { NextResponse } from 'next/server';
import { fetchTrack, isTrackUrl, SoundCloudError } from '@/lib/soundcloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proxied so the artwork can be drawn onto the canvas without tainting it. */
export async function GET(req: Request) {
  const trackUrl = new URL(req.url).searchParams.get('url') ?? '';
  if (!isTrackUrl(trackUrl)) {
    return NextResponse.json({ error: 'Missing or invalid ?url=' }, { status: 400 });
  }
  try {
    const { artwork } = await fetchTrack(trackUrl);
    if (!artwork) return NextResponse.json({ error: 'No artwork.' }, { status: 404 });
    const res = await fetch(artwork);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Artwork fetch failed (${res.status}).` }, { status: 502 });
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
    const status = err instanceof SoundCloudError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}
