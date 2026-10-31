import { NextResponse } from 'next/server';
import { isTrackUrl, resolveAudio, SoundCloudError } from '@/lib/soundcloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resolves and proxies the audio bytes. The SoundCloud CDN URL is time-limited
 * and tied to the resolving context, so the bytes come back through here rather
 * than being handed to the browser to fetch directly.
 */
export async function GET(req: Request) {
  const trackUrl = new URL(req.url).searchParams.get('url') ?? '';
  if (!isTrackUrl(trackUrl)) {
    return NextResponse.json({ error: 'Missing or invalid ?url=' }, { status: 400 });
  }

  try {
    const source = await resolveAudio(trackUrl);
    const upstream = await fetch(source.url);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Audio stream refused with HTTP ${upstream.status}.` },
        { status: 502 },
      );
    }
    const headers = new Headers({
      'content-type': source.mimeType,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    });
    const len = upstream.headers.get('content-length');
    if (len) headers.set('content-length', len);
    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    const status = err instanceof SoundCloudError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}
