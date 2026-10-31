import Link from 'next/link';
import CookieHelper from './CookieHelper';

export const metadata = {
  title: 'Cookie check · Dance Exercise Chart Maker',
};

export default function CookieHelpPage() {
  return (
    <main className="wrap">
      <header className="masthead">
        <h1>YouTube cookie check</h1>
        <p>
          Only needed for the hosted site, when YouTube blocks the server&apos;s IP. The desktop
          app and local runs use your own connection and need no cookie.
        </p>
      </header>

      <section className="panel">
        <h2>Easiest: copy as cURL</h2>
        <ol className="note" style={{ lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Sign in to youtube.com in a private window (use a throwaway account).</li>
          <li>
            Open developer tools (<code>⌥⌘I</code> on Mac), go to the <strong>Network</strong> tab,
            and reload the page.
          </li>
          <li>
            Right-click the top <code>www.youtube.com</code> request →{' '}
            <strong>Copy</strong> → <strong>Copy as cURL</strong>.
          </li>
          <li>
            Paste the whole thing in the box below — this page pulls the cookie out of it for you.
          </li>
        </ol>
        <p className="note" style={{ marginTop: 10 }}>
          You can also paste just the raw cookie value if you prefer. Either way, don&apos;t use the
          console&apos;s <code>document.cookie</code> — the sign-in cookies are hidden from it, so
          that value will not work.
        </p>
      </section>

      <CookieHelper />

      <footer style={{ marginTop: 24 }}>
        <Link href="/">← Back to the app</Link>
      </footer>
    </main>
  );
}
