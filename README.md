# Dance Exercise Chart Maker

Paste a YouTube link, get a five-lane dance-exercise rhythm video rendered with the audio. Spotify
links and local audio files work too.

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

### "Sign in to confirm you're not a bot"

Expect this on Vercel. YouTube blocks datacenter IP ranges, and every Vercel function runs on one.
It is not a bug in the code — `lib/youtube.ts` already rotates through the `IOS`, `ANDROID_VR`,
`ANDROID`, `TV_SIMPLY`, `MWEB` and `WEB` Innertube clients, because which one gets through keeps
changing. When the IP itself is flagged, none of them help.

Options, most durable first:

**1. `YOUTUBE_PROXY_URL` — route through a non-datacenter IP.**

```
YOUTUBE_PROXY_URL=http://user:pass@residential-proxy.example:8080
```

The only fix that addresses the actual cause. Both the Innertube calls and the audio download go
through it, which is required rather than tidy: googlevideo URLs are bound to the IP that resolved
them, so resolving via a proxy and downloading directly returns 403. Residential and mobile proxies
are paid services.

**2. `YOUTUBE_COOKIE` — borrow a signed-in session.**

Sign in to youtube.com in a private window, open DevTools → Network, click any request to
youtube.com, and copy the entire `Cookie:` request header value.

> **Use a throwaway Google account.** A session replayed from a datacenter IP is exactly the
> pattern Google flags, and the account can be limited or banned. Never use an account you care
> about. The cookie also dies when that browser session signs out, and expires on its own.

`YOUTUBE_PO_TOKEN` and `YOUTUBE_VISITOR_DATA` are supported alongside it.

**3. Run it locally.** `npm run dev` on your own machine uses your home IP, which usually is not
blocked. For personal use this is the path of least resistance.

**4. The "Use my own audio" tab.** Always works — the media never touches the server. The error
message links straight to it.

Failures report the underlying cause rather than a bare `fetch failed`, so you can tell a blocked
IP from a dead proxy from a DNS problem:

```
Could not reach YouTube from the server (fetch failed — connect ECONNREFUSED 10.0.0.1:8080)
```

## Importing from Spotify

A Spotify track link fills in the **title, artist and cover art**. It cannot supply the audio, and
that is not a gap to be plugged later:

- Full tracks are DRM-protected (Widevine) and only decode inside Spotify's own player. There is no
  licensed download path.
- `GET /v1/audio-analysis` and `GET /v1/audio-features` — which return Spotify's own beat, bar and
  section grid, and would have charted better than local onset detection — were closed to new apps
  on **27 November 2024**. Apps without an approved quota extension from before that date get 403.
- 30-second `preview_url` values were restricted in the same round.

So the flow is: paste the link to name the video and grab the artwork, then add an audio file you
have the rights to. If your audio length differs from Spotify's by more than 5s, the app says so —
usually it means a different edit, or the wrong file.

### Credentials

Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and set:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Only the Client Credentials flow is used — this reads public catalogue data, so there is no user
login and no redirect URI to configure. Without these the Spotify tab returns a 503 saying exactly
that.

Accepted link forms: `open.spotify.com/track/<id>`, locale-prefixed
`open.spotify.com/intl-de/track/<id>`, `spotify:track:<id>`, or a bare 22-character id.

The dashboard makes you enter a **Redirect URI** to create the app even though Client Credentials
never redirects. Any valid value works; use `http://127.0.0.1:3000/callback` — Spotify rejects
`http://localhost`, allowing plain HTTP only for explicit loopback IPs.

### If lookups return 403

Spotify's refusal reason is passed through, so the error names the cause. The common one is the app
being in **Development Mode**: reports indicate Spotify's February 2026 migration moved Dev Mode
apps off Client Credentials for metadata endpoints and now expects the app owner to have Premium.
Check the app's mode in the dashboard. Nothing else in the app depends on Spotify — the
**Use my own audio** tab needs no account.

`SPOTIFY_API_BASE` and `SPOTIFY_ACCOUNTS_BASE` override the endpoints, which is how the error paths
are tested against a mock.

## Desktop app (macOS / Windows / Linux)

The web deploy and the desktop build run the same Next app; the desktop one wraps it in Electron
and starts the server inside the app, so **no Node install is needed on the user's machine**.

Worth it for one reason above all: a desktop build runs on your own connection, and YouTube does
not bot-check residential IPs the way it blocks Vercel's. The import that fails on the deployed
site generally just works here.

```bash
npm install
npm run dist:mac      # .dmg + .zip for arm64 and x64
npm run dist:win      # NSIS installer
npm run dist:linux    # AppImage
```

`npm run desktop:build` alone produces the unpacked bundle under `desktop/app` without packaging.

### Building for macOS

Run `npm run dist:mac` **on a Mac**. A `.dmg` needs macOS tooling (`hdiutil`), so it cannot be
produced from Linux or Windows — a cross-build can only emit the `.app` inside a `.zip`.

The build is **unsigned** unless you have an Apple Developer certificate, so Gatekeeper will refuse
it on first open with "cannot be opened because the developer cannot be verified". Either:

- right-click the app → **Open** → **Open** (only needed once), or
- `xattr -cr "/Applications/Dance Exercise Chart Maker.app"`

To ship it without that, set `CSC_LINK` and `CSC_KEY_PASSWORD` to a Developer ID certificate and
notarize — see electron-builder's code signing docs.

### How it is wired

- `output: 'standalone'` is enabled only when `BUILD_DESKTOP=1`, so Vercel deploys are unchanged.
- Next's standalone output omits `.next/static` and `public`; `scripts/build-desktop.mjs` copies
  them in, otherwise the app loads unstyled.
- `electron/main.js` picks a free port, forks the server with `ELECTRON_RUN_AS_NODE`, waits for it
  to answer, then opens the window.
- `node_modules` is copied by naming it as its own `extraResources` entry. electron-builder strips
  a nested `node_modules` from `extraResources`, which leaves the packaged server unable to
  `require('next')`.

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
