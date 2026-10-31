/**
 * Single-page dance-chart app for the Android WebView.
 *
 * Reuses the framework-agnostic engine from lib/ (analysis, charting, the
 * canvas scene, the MP4/WebM exporter). The UI is vanilla DOM — no Next, no
 * React — so the whole thing bundles to one JS file served from app assets.
 *
 * Audio comes from a picked file or, on-device, from YouTube via the native
 * bridge. Everything after decode is identical to the web app.
 */
import { analyzeAudio, type Analysis } from '../../lib/analyze';
import { buildChart, type Difficulty } from '../../lib/chart';
import { DEFAULT_MOVES } from '../../lib/moves';
import { renderVideo } from '../../lib/render';
import { Scene } from '../../lib/scene';
import {
  fetchAudio,
  hasNativeBridge,
  parseVideoId,
  resolveTrack,
} from './youtube-native';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:...;base64," prefix.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let analysis: Analysis | null = null;
let audioBuffer: AudioBuffer | null = null;
let title = '';
let artist = '';

const LEAD_IN = 4;
const APPROACH = 1.8;

function setStatus(msg: string, kind: 'info' | 'error' | 'ok' = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function setBusy(busy: boolean) {
  document.querySelectorAll('button, input, select').forEach((e) => {
    (e as HTMLButtonElement).disabled = busy;
  });
}

async function decode(buffer: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buffer.slice(0));
  await ctx.close();
  return decoded;
}

async function ingest(buffer: ArrayBuffer, t: string, a: string) {
  setStatus('Decoding audio…');
  audioBuffer = await decode(buffer);
  setStatus('Analysing tempo and onsets…');
  analysis = await analyzeAudio(audioBuffer, (f) =>
    setStatus(`Analysing… ${Math.round(f * 100)}%`),
  );
  title = t;
  artist = a;
  $('titleIn').setAttribute('value', t);
  ($('titleIn') as HTMLInputElement).value = t;
  ($('artistIn') as HTMLInputElement).value = a;
  renderPreview();
  $('studio').style.display = 'block';
  setStatus(`Ready — ${Math.round(analysis.bpm)} BPM detected.`, 'ok');
}

function currentScene(width: number, height: number): Scene {
  const difficulty = ($('difficulty') as HTMLSelectElement).value as Difficulty;
  const chart = buildChart(analysis!, difficulty);
  return new Scene(chart, analysis!, {
    width,
    height,
    leadIn: LEAD_IN,
    approach: APPROACH,
    moves: DEFAULT_MOVES,
    title: ($('titleIn') as HTMLInputElement).value || title,
    artist: ($('artistIn') as HTMLInputElement).value || artist,
    background: null,
    icons: [null, null, null, null, null],
    showHud: true,
  });
}

let previewTimer = 0;
function renderPreview() {
  if (!analysis) return;
  const canvas = $('preview') as HTMLCanvasElement;
  const scene = currentScene(canvas.width, canvas.height);
  const ctx = canvas.getContext('2d')!;
  const total = LEAD_IN + analysis.duration + 2.5;
  let t = LEAD_IN; // start at the first playable moment for a representative frame
  cancelAnimationFrame(previewTimer);
  const start = performance.now();
  const loop = () => {
    const elapsed = (performance.now() - start) / 1000;
    t = LEAD_IN + (elapsed % Math.max(1, analysis!.duration));
    scene.draw(ctx, Math.min(t, total));
    previewTimer = requestAnimationFrame(loop);
  };
  loop();
}

async function doExport() {
  if (!analysis || !audioBuffer) return;
  setBusy(true);
  const res = ($('resolution') as HTMLSelectElement).value;
  const [w, h] = res === 'vertical' ? [1080, 1920] : res === '1080' ? [1920, 1080] : [1280, 720];
  const fps = 30;
  const total = LEAD_IN + analysis.duration + 2.5;
  try {
    const scene = currentScene(w, h);
    setStatus('Rendering video…');
    const result = await renderVideo(
      {
        scene,
        audioBuffer,
        width: w,
        height: h,
        fps,
        leadIn: LEAD_IN,
        totalDuration: total,
        onProgress: (f, note) => setStatus(`${note ?? 'Rendering'} — ${Math.round(f * 100)}%`),
      },
      'auto',
    );
    const sizeMb = (result.blob.size / 1048576).toFixed(1);
    const name = `dance-chart-${Date.now()}.${result.extension}`;

    if (hasNativeBridge() && window.AndroidNative?.saveVideo) {
      // Hand the bytes to native code, which writes them to phone storage.
      setStatus('Saving to your phone…');
      const b64 = await blobToBase64(result.blob);
      const path = window.AndroidNative.saveVideo(name, b64);
      if (path.startsWith('ERROR')) {
        setStatus(`Saved render but could not write file: ${path}`, 'error');
      } else {
        setStatus(`Saved (${sizeMb} MB) to ${path}`, 'ok');
      }
    } else {
      const url = URL.createObjectURL(result.blob);
      const a = $('download') as HTMLAnchorElement;
      a.href = url;
      a.download = name;
      a.style.display = 'inline-block';
      a.textContent = `Download .${result.extension} (${sizeMb} MB)`;
      setStatus('Done. Tap to save the video.', 'ok');
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Render failed.', 'error');
  } finally {
    setBusy(false);
  }
}

async function loadFromYouTube() {
  const raw = ($('ytUrl') as HTMLInputElement).value;
  const id = parseVideoId(raw);
  if (!id) {
    setStatus("That doesn't look like a YouTube link.", 'error');
    return;
  }
  setBusy(true);
  try {
    setStatus('Resolving on your device…');
    const track = await resolveTrack(id);
    setStatus('Downloading audio…');
    const buffer = await fetchAudio(track);
    await ingest(buffer, track.title, track.author);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'YouTube load failed.', 'error');
  } finally {
    setBusy(false);
  }
}

function wire() {
  // YouTube only works when the native bridge is present (the APK). In a plain
  // browser, hide it rather than show a button that cannot work.
  if (hasNativeBridge()) {
    $('ytRow').style.display = 'flex';
    $('loadYt').addEventListener('click', () => void loadFromYouTube());
  } else {
    $('ytNote').textContent = 'YouTube import is only available in the installed app.';
  }

  $('fileIn').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const name = f.name.replace(/\.[^.]+$/, '');
      await ingest(await f.arrayBuffer(), name, 'Your audio');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not decode that file.', 'error');
    } finally {
      setBusy(false);
    }
  });

  $('difficulty').addEventListener('change', renderPreview);
  $('exportBtn').addEventListener('click', () => void doExport());
}

document.addEventListener('DOMContentLoaded', wire);
