/**
 * Pure helpers for checking a pasted YouTube cookie header. No I/O: the
 * validator page runs these in the browser and never transmits the value,
 * because the string is a live session credential.
 */

/** Names the player expects on a signed-in request. */
export const REQUIRED = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'] as const;
/** At least one of these is present on a current session. */
export const SECURE_ANY = ['__Secure-1PSID', '__Secure-3PSID'] as const;

const SIGN_IN_NAMES = [...REQUIRED, ...SECURE_ANY] as string[];

export function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function parsePairs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of normalize(raw).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return out;
}

export type CookieReport = {
  ok: boolean;
  normalized: string;
  count: number;
  present: string[];
  missing: string[];
  /** The paste has pairs but none of the sign-in cookies. */
  looksUnauthenticated: boolean;
  notes: string[];
};

export function checkCookie(raw: string): CookieReport {
  const normalized = normalize(raw);
  const pairs = parsePairs(normalized);

  const present: string[] = [];
  const missing: string[] = [];
  for (const name of REQUIRED) (pairs.has(name) ? present : missing).push(name);

  const secure = SECURE_ANY.filter((n) => pairs.has(n));
  if (secure.length) present.push(...secure);
  else missing.push(SECURE_ANY.join(' or '));

  const notes: string[] = [];
  const hasSignIn = SIGN_IN_NAMES.some((n) => pairs.has(n));
  const looksUnauthenticated = pairs.size > 0 && !hasSignIn;

  if (!pairs.size) notes.push('No name=value pairs found — paste the whole cookie header value.');
  if (looksUnauthenticated) {
    notes.push('None of the sign-in cookies are present. Make sure you copied from a signed-in request.');
  }

  const ok = missing.length === 0;
  return { ok, normalized, count: pairs.size, present, missing, looksUnauthenticated, notes };
}
