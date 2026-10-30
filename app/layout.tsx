import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dance Exercise Chart Maker',
  description:
    'Paste a YouTube link and get a five-lane dance-exercise rhythm video, auto-charted to the beat.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
