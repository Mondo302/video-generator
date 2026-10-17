"use client";

// Canvas player + frame-exact WebM download. Rendering and export run only in the browser.
// Type-only plan imports keep zod out of the client bundle; mediabunny loads on first Download.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Plan, Vibe } from "@/lib/plan";
import { FORMATS, drawFrame, frameSize, planDuration, type Format } from "./render";
import { renderAudio } from "./audio";

export type PlayerProps = { plan: Plan; vibe: Vibe };

type Phase = "idle" | "preparing" | "playing" | "exporting";

const PRIMARY =
  "rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY =
  "rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-40";

const noSubscribe = () => () => {};

export function fileName(plan: Plan, vibe: Vibe, format: Format = "16:9"): string {
  const slug = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
  return `${slug}-${vibe}${format === "9:16" ? "-9x16" : ""}.webm`;
}

export function Player({ plan, vibe }: PlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("16:9"); // render-time choice, never stored
  const size = frameSize(format);
  // Browser-only facts, read without an effect (null / false during server render).
  const canExport = useSyncExternalStore<boolean | null>(noSubscribe, () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined", () => null);
  const probe = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).has("probe"), () => false); // test-only sync marker
  const total = planDuration(plan);

  const still = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawFrame(ctx, Math.min(2, plan.scenes[0].duration_s * 0.6), plan, vibe, false, format);
  }, [plan, vibe, format]);

  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => { if (live) still(); });
    return () => {
      live = false;
      audioRef.current?.close();
      abortRef.current?.abort();
    };
  }, [still]);

  function stop() {
    audioRef.current?.close();
    audioRef.current = null;
    setPhase("idle");
  }

  async function play() {
    stop();
    setPhase("preparing");
    setMessage(null);
    const buffer = await renderAudio(plan, vibe, { probe });
    const ac = new AudioContext();
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(ac.destination);
    const t0 = ac.currentTime + 0.1;
    src.start(t0);
    audioRef.current = ac;
    setPhase("playing");
    const tick = () => {
      if (audioRef.current !== ac) return;
      const ctx = canvasRef.current?.getContext("2d");
      const t = Math.max(0, ac.currentTime - t0);
      if (ctx) drawFrame(ctx, t, plan, vibe, probe, format);
      if (t >= total) stop();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function download() {
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("exporting");
    setProgress(0);
    setMessage(null);
    try {
      await document.fonts.ready;
      const { exportWebm } = await import("./export");
      const blob = await exportWebm(plan, vibe, { signal: controller.signal, probe, format, onProgress: setProgress });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(plan, vibe, format);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Saved ${a.download} (${(blob.size / 1048576).toFixed(1)} MB).`);
    } catch (e) {
      const err = e as Error;
      setMessage(err.name === "AbortError" ? "Download cancelled. Nothing was saved." : `The video could not be made: ${err.message}`);
    } finally {
      abortRef.current = null;
      setPhase("idle");
      still();
    }
  }

  const busy = phase !== "idle";
  return (
    <section aria-label={`Video player, ${vibe} vibe`} className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm">
      <div role="group" aria-label="Video shape" className="mb-4 inline-flex gap-1 rounded-md border border-zinc-800/60 bg-zinc-950 p-1">
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={format === f}
            disabled={busy}
            onClick={() => setFormat(f)}
            className={`rounded px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 ${
              format === f ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {f === "16:9" ? "16:9 wide" : "9:16 vertical"}
          </button>
        ))}
      </div>
      <div className={`overflow-hidden rounded-md bg-black ${format === "9:16" ? "mx-auto aspect-[9/16] w-full max-w-xs" : "aspect-video w-full"}`}>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          className="block h-full w-full"
          role="img"
          aria-label={`${plan.title}: ${plan.scenes.length} scenes, ${total} seconds`}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {phase === "playing" || phase === "preparing" ? (
          <button type="button" onClick={stop} className={PRIMARY}>Stop</button>
        ) : (
          <button type="button" onClick={play} disabled={busy} className={PRIMARY}>Play</button>
        )}
        {canExport ? (
          phase === "exporting" ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className={SECONDARY}>Cancel</button>
          ) : (
            <button type="button" onClick={download} disabled={busy} className={SECONDARY}>Download WebM</button>
          )
        ) : null}
        <span className="text-sm text-zinc-500">{total} s, {plan.scenes.length} scenes</span>
      </div>
      {phase === "exporting" ? (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-label="Making the video file"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-800"
          >
            <div className="h-full rounded-full bg-zinc-300" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-2 text-sm text-zinc-400">Making the video file: {Math.round(progress * 100)}%</p>
        </div>
      ) : null}
      {canExport === false ? (
        <p className="mt-4 text-sm text-zinc-400">This browser can&apos;t export video. Use Chrome or Edge.</p>
      ) : null}
      {message ? <p role="status" className="mt-4 text-sm text-zinc-400">{message}</p> : null}
    </section>
  );
}
