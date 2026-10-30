import { NextResponse } from 'next/server';
import { fetchTrackInfo, parseVideoId, YouTubeError } from '@/lib/youtube';

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

  try {
    const info = await fetchTrackInfo(videoId);
    return NextResponse.json(info);
  } catch (err) {
    const status = err instanceof YouTubeError ? err.status : 502;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status });
  }
}
