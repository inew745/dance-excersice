'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Scene } from '@/lib/scene';

type Props = {
  scene: Scene | null;
  audioBuffer: AudioBuffer | null;
  leadIn: number;
  totalDuration: number;
  width: number;
  height: number;
};

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export default function Preview({ scene, audioBuffer, leadIn, totalDuration, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef(0);
  /** Maps AudioContext time to video time while playing. */
  const anchorRef = useRef({ audioT0: 0, videoT0: 0 });
  const timeRef = useRef(0);

  const playerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [canFull, setCanFull] = useState(false);

  const paint = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !scene) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      scene.draw(ctx, t);
    },
    [scene],
  );

  const showTime = useCallback(
    (t: number) => {
      timeRef.current = t;
      if (sliderRef.current) sliderRef.current.value = String(t);
      if (labelRef.current) labelRef.current.textContent = `${fmt(t)} / ${fmt(totalDuration)}`;
    },
    [totalDuration],
  );

  const stopSource = useCallback(() => {
    const src = sourceRef.current;
    sourceRef.current = null;
    if (src) {
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
    }
  }, []);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    stopSource();
    setPlaying(false);
  }, [stopSource]);

  const play = useCallback(
    async (from: number) => {
      if (!scene || !audioBuffer) return;
      if (from >= totalDuration - 0.05) from = 0;

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      const ac = audioCtxRef.current;
      if (ac.state === 'suspended') await ac.resume();

      stopSource();

      const src = ac.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ac.destination);

      const when = ac.currentTime + 0.08;
      const audioTime = from - leadIn;
      if (audioTime < 0) {
        // Still in the countdown: delay the music by the remaining lead-in.
        src.start(when - audioTime);
      } else if (audioTime < audioBuffer.duration) {
        src.start(when, audioTime);
      }
      sourceRef.current = src;
      anchorRef.current = { audioT0: when, videoT0: from };
      setPlaying(true);

      const tick = () => {
        const { audioT0, videoT0 } = anchorRef.current;
        const t = videoT0 + (ac.currentTime - audioT0);
        if (t >= totalDuration) {
          showTime(totalDuration);
          paint(totalDuration);
          pause();
          return;
        }
        showTime(Math.max(0, t));
        paint(Math.max(0, t));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [scene, audioBuffer, totalDuration, leadIn, stopSource, paint, showTime, pause],
  );

  // Repaint when the scene is rebuilt (new settings, new chart, new art).
  useEffect(() => {
    pause();
    const t = Math.min(timeRef.current, totalDuration);
    showTime(t);
    paint(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, totalDuration]);

  // Safari still uses the webkit-prefixed API, and iPhone Safari has no
  // element fullscreen at all — hide the control rather than offer a no-op.
  useEffect(() => {
    const el = playerRef.current;
    const withWebkit = el as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    setCanFull(Boolean(withWebkit?.requestFullscreen || withWebkit?.webkitRequestFullscreen));

    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      setIsFull(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = playerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => void })
      | null;
    if (!el) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else doc.webkitExitFullscreen?.();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else {
        el.webkitRequestFullscreen?.();
      }
    } catch {
      // Denied (permissions policy, or not a user gesture) — leave as is.
    }
  }, []);

  // `f` toggles, but not while someone is typing in a settings field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      void toggleFullscreen();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      const src = sourceRef.current;
      if (src) { try { src.stop(); } catch { /* ignore */ } }
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  const onSeek = (value: number) => {
    const wasPlaying = playing;
    pause();
    showTime(value);
    paint(value);
    if (wasPlaying) void play(value);
  };

  return (
    <div className={`player${isFull ? ' is-full' : ''}`} ref={playerRef}>
      <div
        className="stage"
        onDoubleClick={() => void toggleFullscreen()}
        title="Double-click for fullscreen"
      >
        <canvas ref={canvasRef} width={width} height={height} />
      </div>
      <div className="transport">
        <button
          type="button"
          className="primary"
          onClick={() => (playing ? pause() : void play(timeRef.current))}
          disabled={!scene || !audioBuffer}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="ghost" onClick={() => onSeek(0)} disabled={!scene}>
          Restart
        </button>
        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={Math.max(0.1, totalDuration)}
          step={0.05}
          defaultValue={0}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={!scene}
          aria-label="Seek"
        />
        <span className="time" ref={labelRef}>0:00 / 0:00</span>
        {canFull && (
          <button
            type="button"
            className="ghost"
            onClick={() => void toggleFullscreen()}
            aria-pressed={isFull}
            title="Fullscreen (f, or double-click the video)"
          >
            {isFull ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        )}
      </div>
    </div>
  );
}
