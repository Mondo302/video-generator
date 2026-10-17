// Frame-by-frame WebM export (mediabunny): frame f is drawn at t = f/30 and encoded with that exact
// timestamp; the offline-rendered audio is added as one buffer. Nothing runs in real time.
// Loaded with a dynamic import from Player, so mediabunny stays out of the first page load.
import { AudioBufferSource, BufferTarget, CanvasSource, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeVideo } from "mediabunny";
import type { Plan, Vibe } from "@/lib/plan";
import { H, W, drawFrame, planDuration } from "./render";
import { renderAudio } from "./audio";

export const FPS = 30;

export type ExportOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  probe?: boolean;
};

const abortError = () => new DOMException("Export cancelled", "AbortError");

export async function exportWebm(plan: Plan, vibe: Vibe, { onProgress, signal, probe = false }: ExportOptions = {}): Promise<Blob> {
  if (signal?.aborted) throw abortError();
  const frames = Math.round(planDuration(plan) * FPS);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  const codec = (await canEncodeVideo("vp9", { width: W, height: H })) ? "vp9" : "vp8";
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: "opus", bitrate: QUALITY_HIGH });
  output.addVideoTrack(video);
  output.addAudioTrack(audio);
  try {
    const buffer = await renderAudio(plan, vibe, { probe });
    await output.start();
    const audioDone = audio.add(buffer); // awaited after the video so the muxer can interleave
    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) throw abortError();
      drawFrame(ctx, f / FPS, plan, vibe, probe);
      await video.add(f / FPS, 1 / FPS);
      if (f % 15 === 14) {
        onProgress?.((f + 1) / frames);
        await new Promise((r) => setTimeout(r, 0)); // let the page paint and see Cancel
      }
    }
    await audioDone;
    await output.finalize();
    onProgress?.(1);
    const buf = output.target.buffer;
    if (!buf) throw new Error("The video file was not written");
    return new Blob([buf], { type: "video/webm" });
  } catch (e) {
    if (output.state !== "canceled" && output.state !== "finalized") await output.cancel().catch(() => {});
    throw e;
  }
}
