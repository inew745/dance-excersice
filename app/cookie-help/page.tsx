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
        <h2>How to get it</h2>
        <ol className="note" style={{ lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Sign in to youtube.com in a private window (use a throwaway account).</li>
          <li>Open the browser&apos;s developer tools and go to the <strong>Network</strong> tab.</li>
          <li>Reload the page, then click the top <code>www.youtube.com</code> document request.</li>
          <li>
            Under <strong>Request Headers</strong>, switch on the <strong>Raw</strong> view and copy
            everything after <code>cookie:</code> on that line.
          </li>
          <li>Paste it below to check it.</li>
        </ol>
        <p className="note" style={{ marginTop: 10 }}>
          Don&apos;t use the console&apos;s <code>document.cookie</code> — the sign-in cookies are
          hidden from it, so that value will not work.
        </p>
      </section>

      <CookieHelper />

      <footer style={{ marginTop: 24 }}>
        <Link href="/">← Back to the app</Link>
      </footer>
    </main>
  );
}
