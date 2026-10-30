import { NextResponse } from 'next/server';
import { hasApiKey, searchVideos, YouTubeApiError } from '@/lib/youtube-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';

  // No query is a capability probe, so the UI can hide search when unconfigured.
  if (!q) return NextResponse.json({ enabled: hasApiKey() });

  try {
    return NextResponse.json({ enabled: true, results: await searchVideos(q) });
  } catch (err) {
    const status = err instanceof YouTubeApiError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed.' },
      { status },
    );
  }
}
