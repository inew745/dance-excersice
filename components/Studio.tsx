'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Preview from './Preview';
import { analyzeAudio, type Analysis } from '@/lib/analyze';
import { buildChart, type Difficulty } from '@/lib/chart';
import { DEFAULT_MOVES, type Move } from '@/lib/moves';
import {
  bitmapFromFile,
  decodeAudio,
  fetchYouTubeArt,
  fetchYouTubeAudio,
  resolveYouTube,
  splitTitle,
} from '@/lib/pipeline';
import { detectCapability, renderVideo, type Capability, type ExportFormat } from '@/lib/render';
import { Scene } from '@/lib/scene';

const RESOLUTIONS = [
  { id: '720', label: '720p landscape · 1280×720', w: 1280, h: 720 },
  { id: '1080', label: '1080p landscape · 1920×1080', w: 1920, h: 1080 },
  { id: 'vertical', label: 'Vertical / Shorts · 1080×1920', w: 1080, h: 1920 },
] as const;

type ResId = (typeof RESOLUTIONS)[number]['id'];
type Tab = 'youtube' | 'file';
type BgChoice = 'arena' | 'thumbnail' | 'custom';

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Easy · one move every 2 beats' },
  { id: 'normal', label: 'Normal · one move per beat' },
  { id: 'hard', label: 'Hard · eighth notes' },
  { id: 'expert', label: 'Expert · eighths + doubles' },
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chart';
}

export default function Studio() {
  const [tab, setTab] = useState<Tab>('youtube');
  const [url, setUrl] = useState('');

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [artBitmap, setArtBitmap] = useState<ImageBitmap | null>(null);

  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [resId, setResId] = useState<ResId>('720');
  const [fps, setFps] = useState(30);
  const [leadIn, setLeadIn] = useState(4);
  const [approach, setApproach] = useState(1.8);
  const [showHud, setShowHud] = useState(true);
  const [clipSeconds, setClipSeconds] = useState(0);
  const [format, setFormat] = useState<ExportFormat | 'auto'>('auto');

  const [moves, setMoves] = useState<Move[]>(DEFAULT_MOVES);
  const [icons, setIcons] = useState<(ImageBitmap | null)[]>([null, null, null, null, null]);
  const [bgChoice, setBgChoice] = useState<BgChoice>('arena');
  const [customBg, setCustomBg] = useState<ImageBitmap | null>(null);

  const [caps, setCaps] = useState<Capability | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderNote, setRenderNote] = useState('');
  const [download, setDownload] = useState<{ href: string; name: string; size: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const res = RESOLUTIONS.find((r) => r.id === resId)!;

  useEffect(() => {
    let cancelled = false;
    detectCapability(res.w, res.h, fps).then((c) => { if (!cancelled) setCaps(c); });
    return () => { cancelled = true; };
  }, [res.w, res.h, fps]);

  const chart = useMemo(
    () => (analysis ? buildChart(analysis, difficulty) : null),
    [analysis, difficulty],
  );

  const background = bgChoice === 'custom' ? customBg : bgChoice === 'thumbnail' ? artBitmap : null;

  const previewDims = useMemo(() => {
    const scale = Math.min(1, 920 / res.w);
    return {
      w: Math.round((res.w * scale) / 2) * 2,
      h: Math.round((res.h * scale) / 2) * 2,
    };
  }, [res]);

  const sceneBase = useMemo(
    () => ({ leadIn, approach, moves, title, artist, background, icons, showHud }),
    [leadIn, approach, moves, title, artist, background, icons, showHud],
  );

  const previewScene = useMemo(() => {
    if (!chart || !analysis) return null;
    return new Scene(chart, analysis, {
      width: previewDims.w,
      height: previewDims.h,
      ...sceneBase,
    });
  }, [chart, analysis, previewDims, sceneBase]);

  const totalDuration = useMemo(() => {
    if (!analysis) return 0;
    const full = leadIn + analysis.duration + 2.5;
    return clipSeconds > 0 ? Math.min(full, leadIn + clipSeconds) : full;
  }, [analysis, leadIn, clipSeconds]);

  const reset = () => {
    setAudioBuffer(null);
    setAnalysis(null);
    setArtBitmap(null);
    setDownload(null);
    setError(null);
  };

  const ingest = useCallback(
    async (buffer: ArrayBuffer, meta: { title: string; artist: string }, videoId: string | null) => {
      setStage('Decoding audio');
      setProgress(0.35);
      const decoded = await decodeAudio(buffer);

      setStage('Analysing tempo and onsets');
      const result = await analyzeAudio(decoded, (f) => setProgress(0.4 + f * 0.55));

      if (videoId) {
        setStage('Fetching cover art');
        setArtBitmap(await fetchYouTubeArt(videoId));
      }

      setAudioBuffer(decoded);
      setAnalysis(result);
      setTitle(meta.title);
      setArtist(meta.artist);
      setProgress(1);
    },
    [],
  );

  const loadYouTube = async () => {
    if (!url.trim()) return;
    reset();
    setBusy(true);
    setProgress(0);
    try {
      setStage('Looking up the video');
      const info = await resolveYouTube(url);
      const meta = splitTitle(info);

      setStage('Downloading audio');
      const buffer = await fetchYouTubeAudio(info.id, (received, total) => {
        setProgress(total ? 0.05 + (received / total) * 0.28 : 0.1);
      });

      await ingest(buffer, meta, info.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const loadFile = async (file: File) => {
    reset();
    setBusy(true);
    setProgress(0);
    try {
      setStage('Reading file');
      const buffer = await file.arrayBuffer();
      const name = file.name.replace(/\.[^.]+$/, '');
      const dash = name.match(/^(.*?)\s*[-–—]\s*(.*)$/);
      await ingest(
        buffer,
        dash ? { title: dash[2], artist: dash[1] } : { title: name, artist: 'Your audio' },
        null,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (the browser could not decode that file — try MP3, M4A, WAV or OGG)`
          : 'Could not decode that file.',
      );
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const exportVideo = async () => {
    if (!chart || !analysis || !audioBuffer) return;
    setError(null);
    setDownload(null);
    setRendering(true);
    setProgress(0);
    setRenderNote('Preparing');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const scene = new Scene(chart, analysis, {
        width: res.w,
        height: res.h,
        ...sceneBase,
      });

      const result = await renderVideo(
        {
          scene,
          audioBuffer,
          width: res.w,
          height: res.h,
          fps,
          leadIn,
          totalDuration,
          signal: controller.signal,
          onProgress: (f, note) => {
            setProgress(f);
            if (note) setRenderNote(note);
          },
        },
        format,
      );

      const href = URL.createObjectURL(result.blob);
      setDownload({
        href,
        name: `${slugify(title)}-dance-chart.${result.extension}`,
        size: result.blob.size,
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Rendering failed.');
      }
    } finally {
      setRendering(false);
      abortRef.current = null;
      setRenderNote('');
    }
  };

  const setMoveField = (index: number, patch: Partial<Move>) => {
    setMoves((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const setIcon = async (index: number, file: File | null) => {
    const bmp = file ? await bitmapFromFile(file) : null;
    setIcons((prev) => prev.map((v, i) => (i === index ? bmp : v)));
  };

  const ready = Boolean(chart && analysis && audioBuffer);
  const willUse: ExportFormat | null =
    format !== 'auto' ? format : caps?.mp4 ? 'mp4' : caps?.webm ? 'webm' : null;

  return (
    <>
      <section className="panel">
        <h2>1 · Source</h2>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'youtube'}
            onClick={() => setTab('youtube')}
          >
            YouTube link
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'file'}
            onClick={() => setTab('file')}
          >
            Use my own audio
          </button>
        </div>

        {tab === 'youtube' ? (
          <>
            <div className="row">
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void loadYouTube(); }}
                disabled={busy || rendering}
              />
              <button
                type="button"
                className="primary"
                onClick={() => void loadYouTube()}
                disabled={busy || rendering || !url.trim()}
              >
                {busy ? 'Working…' : 'Load track'}
              </button>
            </div>
            <p className="note" style={{ marginTop: 10 }}>
              YouTube blocks datacenter IPs often, so this can fail on a deployed site even when it
              works locally. If it does, use <strong>Use my own audio</strong>, or set a{' '}
              <code>YOUTUBE_COOKIE</code> environment variable (see the README).
            </p>
          </>
        ) : (
          <>
            <input
              type="file"
              accept="audio/*,video/*"
              disabled={busy || rendering}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }}
            />
            <p className="note" style={{ marginTop: 10 }}>
              MP3, M4A, WAV, OGG or a video file — the audio track is decoded by the browser.
            </p>
          </>
        )}

        {(busy || (rendering && progress > 0)) && (
          <div style={{ marginTop: 14 }}>
            <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="note" style={{ marginTop: 6 }}>
              {stage || renderNote} — {Math.round(progress * 100)}%
            </p>
          </div>
        )}

        {error && (
          <div className="alert err" style={{ marginTop: 14 }}>
            {error}
            {tab === 'youtube' && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => { setTab('file'); setError(null); }}
                >
                  Use my own audio instead →
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {ready && analysis && chart && (
        <>
          <section className="panel">
            <h2>2 · Preview</h2>
            <Preview
              scene={previewScene}
              audioBuffer={audioBuffer}
              leadIn={leadIn}
              totalDuration={totalDuration}
              width={previewDims.w}
              height={previewDims.h}
            />
            <div className="stats">
              <span><b>{Math.round(analysis.bpm)}</b>detected BPM</span>
              <span><b>{chart.notes.length.toLocaleString('en-US')}</b>moves charted</span>
              <span><b>{analysis.onsets.length.toLocaleString('en-US')}</b>onsets found</span>
              <span><b>{Math.floor(totalDuration / 60)}:{String(Math.floor(totalDuration % 60)).padStart(2, '0')}</b>video length</span>
            </div>
          </section>

          <section className="panel">
            <h2>3 · Chart &amp; look</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="difficulty">Difficulty</label>
                <select id="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  {DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="resolution">Resolution</label>
                <select id="resolution" value={resId} onChange={(e) => setResId(e.target.value as ResId)}>
                  {RESOLUTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fps">Frame rate</label>
                <select id="fps" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="approach">Note fall time</label>
                <select id="approach" value={approach} onChange={(e) => setApproach(Number(e.target.value))}>
                  <option value={1.2}>1.2s — fast</option>
                  <option value={1.8}>1.8s — standard</option>
                  <option value={2.4}>2.4s — relaxed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="leadin">Count-in</label>
                <select id="leadin" value={leadIn} onChange={(e) => setLeadIn(Number(e.target.value))}>
                  <option value={3}>3 seconds</option>
                  <option value={4}>4 seconds</option>
                  <option value={6}>6 seconds</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="clip">Length</label>
                <select id="clip" value={clipSeconds} onChange={(e) => setClipSeconds(Number(e.target.value))}>
                  <option value={0}>Whole track</option>
                  <option value={30}>First 30 seconds</option>
                  <option value={60}>First 60 seconds</option>
                  <option value={120}>First 2 minutes</option>
                </select>
                <span className="hint">Short clips render fast — good for trying settings.</span>
              </div>
              <div className="field">
                <label htmlFor="bg">Background</label>
                <select id="bg" value={bgChoice} onChange={(e) => setBgChoice(e.target.value as BgChoice)}>
                  <option value="arena">Painted arena (built in)</option>
                  <option value="thumbnail" disabled={!artBitmap}>Video thumbnail</option>
                  <option value="custom" disabled={!customBg}>My own image</option>
                </select>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const bmp = await bitmapFromFile(f);
                    setCustomBg(bmp);
                    if (bmp) setBgChoice('custom');
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="titlein">On-screen title</label>
                <input id="titlein" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} aria-label="Artist" />
              </div>
            </div>

            <label className="check" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={showHud} onChange={(e) => setShowHud(e.target.checked)} />
              Show score, combo and progress bar
            </label>

            <h2 style={{ marginTop: 22 }}>Lanes</h2>
            <div className="lanes">
              {moves.map((m, i) => (
                <div className="lane-card" key={i}>
                  <div className="swatch" style={{ background: `linear-gradient(90deg, ${m.beam}, ${m.pad})` }} />
                  <div className="glyph">{icons[i] ? '🖼️' : m.glyph}</div>
                  <input
                    type="text"
                    value={m.label}
                    maxLength={10}
                    onChange={(e) => setMoveField(i, { label: e.target.value.toUpperCase() })}
                    aria-label={`Lane ${i + 1} label`}
                  />
                  <input
                    type="text"
                    value={m.glyph}
                    maxLength={4}
                    onChange={(e) => setMoveField(i, { glyph: e.target.value })}
                    aria-label={`Lane ${i + 1} glyph`}
                  />
                  <div className="file">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void setIcon(i, e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>4 · Export</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="format">Format</label>
                <select id="format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat | 'auto')}>
                  <option value="auto">Auto — best this browser can do</option>
                  <option value="mp4" disabled={caps ? !caps.mp4 && !caps.mp4OpusOnly : false}>
                    MP4 (WebCodecs, faster than real time)
                  </option>
                  <option value="webm" disabled={caps ? !caps.webm : false}>WebM (records in real time)</option>
                </select>
              </div>
            </div>

            {caps && !caps.mp4 && !caps.mp4OpusOnly && (
              <div className="alert warn" style={{ marginTop: 14 }}>
                This browser has no H.264 WebCodecs encoder, so export falls back to real-time WebM
                recording: a {Math.round(totalDuration)}-second video takes about{' '}
                {Math.round(totalDuration)} seconds and the tab must stay in the foreground.
                Chrome or Edge gives you MP4.
              </div>
            )}

            {caps?.mp4OpusOnly && (
              <div className="alert warn" style={{ marginTop: 14 }}>
                This browser can encode H.264 but not AAC, so an MP4 from here would carry Opus
                audio — Chrome and VLC play that, but QuickTime and many phone galleries do not.
                Auto mode picks WebM instead; choose MP4 above if you know your player handles it.
              </div>
            )}

            {caps && !caps.mp4 && caps.webm && format === 'auto' && (
              <p className="note" style={{ marginTop: 10 }}>
                WebM records in real time, so expect this to take about{' '}
                {Math.round(totalDuration)} seconds with the tab in the foreground.
              </p>
            )}

            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="primary" onClick={() => void exportVideo()} disabled={rendering}>
                {rendering ? 'Rendering…' : `Render ${willUse ? willUse.toUpperCase() : 'video'}`}
              </button>
              {rendering && (
                <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              )}
            </div>

            {rendering && (
              <div style={{ marginTop: 14 }}>
                <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <p className="note" style={{ marginTop: 6 }}>{renderNote} — {Math.round(progress * 100)}%</p>
              </div>
            )}

            {download && (
              <div style={{ marginTop: 16 }}>
                <a className="primary" href={download.href} download={download.name}
                   style={{ display: 'inline-block', textDecoration: 'none', padding: '11px 22px', borderRadius: 10, color: '#fff' }}>
                  Download {download.name}
                </a>
                <p className="note" style={{ marginTop: 8 }}>
                  {(download.size / 1_048_576).toFixed(1)} MB
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
