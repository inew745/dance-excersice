import { NextResponse } from 'next/server';
import { fetchTrackInfo, parseVideoId } from '@/lib/youtube';
import { fetchVideo, hasApiKey } from '@/lib/youtube-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Thumbnails are proxied rather than hot-linked: an image loaded without CORS
 * headers taints the canvas, which would break both captureStream and the
 * WebCodecs export.
 */
export async function GET(req: Request) {
  const videoId = parseVideoId(new URL(req.url).searchParams.get('v') ?? '');
  if (!videoId) return NextResponse.json({ error: 'Missing or invalid ?v=' }, { status: 400 });

  try {
    const candidates: string[] = [];

    if (hasApiKey()) {
      try {
        const v = await fetchVideo(videoId);
        if (v.thumbnail) candidates.push(v.thumbnail);
      } catch {
        // Fall through to Innertube and the well-known URLs.
      }
    }

    if (!candidates.length) {
      try {
        const { thumbnail } = await fetchTrackInfo(videoId);
        if (thumbnail) candidates.push(thumbnail);
      } catch {
        // Still have the predictable i.ytimg.com paths below.
      }
    }

    candidates.push(
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    );

    for (const url of candidates) {
      const res = await fetch(url);
      if (!res.ok || !res.body) continue;
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'image/jpeg',
          'cache-control': 'public, max-age=86400',
          'access-control-allow-origin': '*',
        },
      });
    }
    return NextResponse.json({ error: 'No thumbnail available.' }, { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
