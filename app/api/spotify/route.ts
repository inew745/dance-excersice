import { NextResponse } from 'next/server';
import { fetchTrack, parseTrackId, SpotifyError } from '@/lib/spotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const trackId = parseTrackId(body.url ?? '');
  if (!trackId) {
    return NextResponse.json(
      { error: "That doesn't look like a Spotify track link." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await fetchTrack(trackId));
  } catch (err) {
    const status = err instanceof SpotifyError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}
