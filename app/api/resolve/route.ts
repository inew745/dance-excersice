import { NextResponse } from 'next/server';
import { fetchTrackInfo, parseVideoId, YouTubeError } from '@/lib/youtube';
import { fetchVideo, hasApiKey } from '@/lib/youtube-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const videoId = parseVideoId(body.url ?? '');
  if (!videoId) {
    return NextResponse.json({ error: "That doesn't look like a YouTube link." }, { status: 400 });
  }

  // The official API is not bot-checked, so prefer it for metadata when a key
  // is configured. Innertube stays as the fallback, and is still the only way
  // to get the audio itself.
  let apiError: string | null = null;
  if (hasApiKey()) {
    try {
      const v = await fetchVideo(videoId);
      return NextResponse.json({
        id: v.id,
        title: v.title,
        author: v.channel,
        durationSec: v.durationSec,
        thumbnail: v.thumbnail,
      });
    } catch (err) {
      apiError = err instanceof Error ? err.message : 'YouTube API failed';
    }
  }

  try {
    return NextResponse.json(await fetchTrackInfo(videoId));
  } catch (err) {
    const status = err instanceof YouTubeError ? err.status : 502;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: apiError ? `${apiError} — and the fallback failed too: ${message}` : message },
      { status },
    );
  }
}
