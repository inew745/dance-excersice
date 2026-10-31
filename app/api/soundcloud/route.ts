import { NextResponse } from 'next/server';
import { fetchTrack, hasClientId, isTrackUrl, SoundCloudError } from '@/lib/soundcloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // A query-less probe lets the UI hide the tab when unconfigured.
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!body.url) return NextResponse.json({ enabled: hasClientId() });

  if (!isTrackUrl(body.url)) {
    return NextResponse.json({ error: "That doesn't look like a SoundCloud link." }, { status: 400 });
  }

  try {
    return NextResponse.json(await fetchTrack(body.url));
  } catch (err) {
    const status = err instanceof SoundCloudError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}
