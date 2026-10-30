import Studio from '@/components/Studio';

export default function Home() {
  return (
    <main className="wrap">
      <header className="masthead">
        <h1>Dance Exercise Chart Maker</h1>
        <p>
          Drop in a YouTube link. The track is analysed for tempo and onsets, a five-lane move
          chart is written to the beat, and the whole thing is rendered to a video with the audio —
          all in your browser.
        </p>
      </header>
      <Studio />
      <footer>
        Only make charts from audio you have the rights to use. Downloading audio from YouTube is
        against YouTube&apos;s Terms of Service; the <strong>Use my own audio</strong> tab exists so
        you can work from files you own.
      </footer>
    </main>
  );
}
