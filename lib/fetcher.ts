import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

/**
 * YouTube blocks datacenter IP ranges, which is every IP a Vercel function
 * runs on. Cookies help for a while but are tied to an account that Google can
 * flag; routing the requests through a non-datacenter IP is the fix that
 * actually holds. Set YOUTUBE_PROXY_URL to use one.
 *
 * Both the Innertube calls and the audio byte fetch have to go through the
 * same dispatcher: googlevideo URLs are bound to the IP that resolved them, so
 * resolving via a proxy and then downloading directly would hand back 403s.
 */
let cached: Dispatcher | null | undefined;

function dispatcher(): Dispatcher | null {
  if (cached === undefined) {
    const url = process.env.YOUTUBE_PROXY_URL;
    cached = url ? new ProxyAgent(url) : null;
  }
  return cached;
}

export function usingProxy(): boolean {
  return Boolean(process.env.YOUTUBE_PROXY_URL);
}

export const proxiedFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const agent = dispatcher();
  if (!agent) return fetch(input, init);
  return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: agent,
  }) as unknown as Promise<Response>;
};
