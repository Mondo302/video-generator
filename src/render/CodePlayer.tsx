"use client";

// Player for model-written videos: the module runs only inside the sandbox (src/render/sandbox.ts).
// It is checked first; a failure goes to onRenderError so the page can ask for the one fix.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSandbox, validateModule, type Sandbox } from "./sandbox";
import { toAudioBuffer } from "./export-frames";

export type VideoFormat = "16:9" | "9:16";
export type CodePlayerProps = {
  code: string;
  format: VideoFormat;
  title: string;
  onRenderError?: (message: string) => void;
};

type Phase = "checking" | "ready" | "failed" | "playing" | "exporting";

const PRIMARY =
  "rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY =
  "rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-40";
const noSubscribe = () => () => {};

export function codeFileName(title: string, format: VideoFormat): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
  return `${slug}${format === "9:16" ? "-9x16" : ""}.webm`;
}

export function CodePlayer({ code, format, title, onRenderError }: CodePlayerProps) {
  const { w, h } = format === "9:16" ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sbRef = useRef<Sandbox | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<{ durationSec: number; channels: Float32Array[] } | null>(null);
  const reportRef = useRef(onRenderError);
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const canExport = useSyncExternalStore<boolean | null>(noSubscribe, () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined", () => null);

  useEffect(() => { reportRef.current = onRenderError; }, [onRenderError]);

  async function drawAt(t: number) {
    const sb = sbRef.current;
    if (!sb || sb.destroyed) throw new Error("The video code was stopped.");
    const { bitmap } = await sb.frame(t);
    canvasRef.current?.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
  }

  function fail(text: string) {
    sbRef.current?.destroy();
    setPhase("failed");
    setMessage(text);
    reportRef.current?.(text);
  }

  useEffect(() => {
    let live = true;
    const sb = createSandbox(w, h);
    sbRef.current = sb;
    (async () => {
      const v = await validateModule(sb, code);
      if (!live) return;
      if (!v.ok) { fail(v.problems.join("\n")); return; }
      dataRef.current = { durationSec: v.meta.durationSec, channels: v.audio };
      setDuration(v.meta.durationSec);
      await drawAt(Math.min(1.5, v.meta.durationSec / 4)).catch(() => {});
      if (live) setPhase("ready");
    })();
    return () => {
      live = false;
      audioRef.current?.close();
      abortRef.current?.abort();
      sb.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only for a new module or frame size
  }, [code, w, h]);

  function stop() {
    audioRef.current?.close();
    audioRef.current = null;
    setPhase((p) => (p === "playing" ? "ready" : p));
  }

  function play() {
    const data = dataRef.current;
    if (!data) return;
    stop();
    const ac = new AudioContext();
    const src = ac.createBufferSource();
    src.buffer = toAudioBuffer(data.channels);
    src.connect(ac.destination);
    const t0 = ac.currentTime + 0.15;
    src.start(t0);
    audioRef.current = ac;
    setPhase("playing");
    let busy = false;
    const tick = () => {
      if (audioRef.current !== ac) return;
      const t = Math.max(0, ac.currentTime - t0);
      if (t >= data.durationSec) { stop(); return; }
      if (!busy) { // one frame request in flight; the sandbox kills a module that stops answering
        busy = true;
        drawAt(t).then(() => { busy = false; }, (e: Error) => { stop(); fail(e.message); });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function download() {
    const data = dataRef.current;
    if (!data) return;
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("exporting");
    setProgress(0);
    setMessage(null);
    try {
      const { exportFrames } = await import("./export-frames");
      const blob = await exportFrames({
        width: w, height: h, durationSec: data.durationSec, channels: data.channels, signal: controller.signal, onProgress: setProgress,
        getFrame: async (t) => { const sb = sbRef.current; if (!sb || sb.destroyed) throw new Error("The video code was stopped."); return (await sb.frame(t)).bitmap; },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = codeFileName(title, format);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Saved ${a.download} (${(blob.size / 1048576).toFixed(1)} MB).`);
      setPhase("ready");
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") { setMessage("Download cancelled. Nothing was saved."); setPhase("ready"); }
      else fail(`The video could not be made: ${err.message}`);
    } finally {
      abortRef.current = null;
    }
  }

  const ready = phase === "ready";
  return (
    <section aria-label="Video player" className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm">
      <div className={`overflow-hidden rounded-md bg-black ${format === "9:16" ? "mx-auto aspect-[9/16] w-full max-w-xs" : "aspect-video w-full"}`}>
        <canvas ref={canvasRef} width={w} height={h} className="block h-full w-full" role="img" aria-label={title} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {phase === "playing" ? (
          <button type="button" onClick={stop} className={PRIMARY}>Stop</button>
        ) : (
          <button type="button" onClick={play} disabled={!ready} className={PRIMARY}>Play</button>
        )}
        {canExport ? (
          phase === "exporting" ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className={SECONDARY}>Cancel</button>
          ) : (
            <button type="button" onClick={download} disabled={!ready} className={SECONDARY}>Download WebM</button>
          )
        ) : null}
        {phase === "checking" ? <span className="text-sm text-zinc-500">Checking the video...</span> : null}
        {duration !== null && phase !== "failed" ? <span className="text-sm text-zinc-500">{duration} s</span> : null}
      </div>
      {phase === "exporting" ? (
        <div className="mt-4">
          <div role="progressbar" aria-label="Making the video file" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-zinc-300" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-2 text-sm text-zinc-400">Making the video file: {Math.round(progress * 100)}%</p>
        </div>
      ) : null}
      {canExport === false ? <p className="mt-4 text-sm text-zinc-400">This browser can&apos;t export video. Use Chrome or Edge.</p> : null}
      {phase === "failed" ? <p role="alert" className="mt-4 whitespace-pre-line text-sm text-zinc-400">This video could not be drawn. {message}</p> : null}
      {phase !== "failed" && message ? <p role="status" className="mt-4 text-sm text-zinc-400">{message}</p> : null}
    </section>
  );
}
