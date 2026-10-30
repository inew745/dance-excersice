import { NextResponse } from 'next/server';
import { proxiedFetch } from '@/lib/fetcher';
import { parseVideoId, resolveAudioSource, YouTubeError } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * googlevideo URLs are bound to the IP that resolved them and send no CORS
 * headers, so the browser cannot fetch them directly — the bytes have to come
 * back through this function.
 */
export async function GET(req: Request) {
  const videoId = parseVideoId(new URL(req.url).searchParams.get('v') ?? '');
  if (!videoId) {
    return NextResponse.json({ error: 'Missing or invalid ?v=' }, { status: 400 });
  }

  try {
    const source = await resolveAudioSource(videoId);

    // Must use the same dispatcher that resolved the URL: googlevideo ties
    // the URL to the requesting IP.
    const upstream = await proxiedFetch(source.url, {
      headers: {
        // Without an explicit range googlevideo throttles the transfer hard.
        range: 'bytes=0-',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });

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
    const status = err instanceof YouTubeError ? err.status : 502;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status });
  }
}
