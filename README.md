# Dance Exercise Chart Maker

Paste a YouTube link, get a five-lane dance-exercise rhythm video rendered with the audio.

The track is analysed for tempo and onsets, a move chart is written onto the beat grid, and the
gameplay scene is rendered to a video file — MP4 where the browser can, WebM otherwise.

## How it works

```
YouTube URL ──► /api/resolve ──► track metadata
                /api/audio   ──► audio bytes (proxied; googlevideo URLs are IP-locked + no CORS)
                     │
                     ▼
            decodeAudioData ──► AudioBuffer
                     │
                     ▼
   lib/analyze.ts   STFT (2048/512) ──► spectral flux ──► adaptive peak picking ──► onsets
                    autocorrelation of the onset envelope ──► BPM + beat phase
                     │
                     ▼
   lib/chart.ts     beat grid × difficulty, lane chosen from the dominant frequency band
                     │
                     ▼
   lib/scene.ts     draw(ctx, t) — a pure function of time
                     │
                     ├─► lib/encode/mp4.ts   WebCodecs + mp4-muxer   (faster than real time)
                     └─► lib/encode/webm.ts  MediaRecorder            (real time)
```

Everything after the audio download happens in the browser. The server only resolves and proxies
bytes, so rendering costs no function time.

### Lanes

Lanes map to frequency bands, low to high, so the kick drives the stomps and the hats drive the
snaps:

| Lane | Move  | Band          |
|------|-------|---------------|
| 1    | STOMP | 20–120 Hz     |
| 2    | PAT   | 120–400 Hz    |
| 3    | CHEST | 400–1200 Hz   |
| 4    | CLAP  | 1.2–4 kHz     |
| 5    | SNAP  | 4–16 kHz      |

Labels, glyphs and per-lane icon images are editable in the UI, as is the background.

## Running locally

```bash
npm install
npm run dev     # http://localhost:3000
```

## Deploying to Vercel

Push the repo and import it at [vercel.com/new](https://vercel.com/new) — it is a stock Next.js
app and needs no build configuration. `vercel.json` raises the audio route's timeout to 60s.

### YouTube on a deployed site

YouTube bot-checks datacenter IPs, so `/api/audio` fails far more often from Vercel than from your
laptop. Mitigations, in order of effort:

1. **Use the "Use my own audio" tab.** Always works, no server round trip for the media.
2. **Set `YOUTUBE_COOKIE`** in the Vercel project's environment variables to the `Cookie` header
   from a signed-in youtube.com request. Also supported: `YOUTUBE_PO_TOKEN` and
   `YOUTUBE_VISITOR_DATA`.

`lib/youtube.ts` tries the `IOS`, `ANDROID_VR`, `ANDROID`, `TV_SIMPLY`, `MWEB` and `WEB` Innertube
clients in turn, because which one gets through changes over time.

## Browser support

| | MP4 (WebCodecs) | WebM (MediaRecorder) |
|---|---|---|
| Chrome / Edge | yes — faster than real time | yes |
| Firefox | no H.264 encoder | yes |
| Safari | partial, varies by version | no |

Auto mode picks MP4 only when both H.264 **and** AAC are available. Some Chromium builds ship
H.264 but no AAC encoder; an MP4 carrying Opus audio plays in Chrome and VLC but not in QuickTime
or most phone galleries, so auto falls back to WebM there. You can still force MP4 in the UI.

WebM recording runs in real time and needs the tab in the foreground. Use the **Length** control to
render a 30- or 60-second clip while you dial in settings.

## Notes on the artwork

The arena background is drawn procedurally in `lib/scene.ts` and the lane glyphs are standard
Unicode emoji. Nothing is traced from an existing game. Upload your own background and per-lane
icons in the UI if you have artwork you own.

## Licensing of the audio

Downloading audio from YouTube is against YouTube's Terms of Service. The "Use my own audio" tab is
there so you can work from files you have the rights to use. Only publish videos made from audio
you are licensed to use.
