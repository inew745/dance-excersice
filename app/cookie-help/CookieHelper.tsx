'use client';

import { useMemo, useState } from 'react';
import { checkCookie } from '@/lib/cookie-check';

export default function CookieHelper() {
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => (raw.trim() ? checkCookie(raw) : null), [raw]);

  const copyClean = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.normalized);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the normalized value is shown below regardless.
    }
  };

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2>Check a cookie</h2>
      <p className="note" style={{ marginBottom: 12 }}>
        Paste the value you copied. Everything here runs in your browser — the cookie is never
        sent anywhere, so nothing to worry about pasting it.
      </p>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Paste the cookie header value here…"
        spellCheck={false}
        rows={5}
        style={{
          width: '100%',
          background: '#0d0822',
          color: 'var(--text)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: '11px 13px',
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: 13,
          resize: 'vertical',
        }}
      />

      {report && (
        <div style={{ marginTop: 14 }}>
          <div className={`alert ${report.ok ? '' : report.looksUnauthenticated ? 'err' : 'warn'}`}
               style={report.ok ? { border: '1px solid var(--ok)', color: 'var(--ok)', background: 'rgba(63,224,176,0.08)', borderRadius: 10, padding: '12px 14px' } : undefined}>
            {report.ok ? (
              <>✓ Looks valid — {report.count} cookies, all sign-in values present.</>
            ) : report.looksUnauthenticated ? (
              <>✗ This doesn&apos;t look like a signed-in cookie. None of the sign-in values are here.</>
            ) : (
              <>This has {report.count} cookies but is missing some sign-in values.</>
            )}
          </div>

          {!report.ok && report.missing.length > 0 && (
            <p className="note" style={{ marginTop: 10 }}>
              Missing: {report.missing.map((m) => <code key={m} style={{ marginRight: 6 }}>{m}</code>)}
            </p>
          )}
          {report.present.length > 0 && (
            <p className="note" style={{ marginTop: 6 }}>
              Found: {report.present.map((m) => <code key={m} style={{ marginRight: 6 }}>{m}</code>)}
            </p>
          )}
          {report.notes.map((n, i) => (
            <p key={i} className="note" style={{ marginTop: 6 }}>{n}</p>
          ))}

          {report.ok && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="primary" onClick={() => void copyClean()}>
                {copied ? 'Copied' : 'Copy cleaned value'}
              </button>
              <p className="note" style={{ marginTop: 8 }}>
                Paste this as <code>YOUTUBE_COOKIE</code> in your deployment&apos;s environment
                variables, then redeploy.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
