// Frame-exact WebM export from any frame source (here: bitmaps from the sandbox) plus prepared audio.
// Frame f is requested at t = f/30 and encoded with that exact timestamp. Loaded with a dynamic import.
import { AudioBufferSource, BufferTarget, CanvasSource, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeVideo } from "mediabunny";

export const FPS = 30;
const SR = 48000;

export type FrameExportOptions = {
  width: number;
  height: number;
  durationSec: number;
  getFrame: (t: number) => Promise<ImageBitmap>;
  channels: Float32Array[]; // stereo, 48 kHz
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

const abortError = () => new DOMException("Export cancelled", "AbortError");

/** Peak-normalise to -1 dB if needed and wrap the channels in an AudioBuffer. */
export function toAudioBuffer(channels: Float32Array[]): AudioBuffer {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const k = peak > 0.89 ? 0.89 / peak : 1;
  const buf = new AudioBuffer({ length: Math.max(1, channels[0]?.length ?? 1), numberOfChannels: 2, sampleRate: SR });
  for (let ch = 0; ch < 2; ch++) {
    const src = channels[Math.min(ch, channels.length - 1)];
    if (!src) continue;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] * k;
    buf.copyToChannel(out, ch);
  }
  return buf;
}

export async function exportFrames(o: FrameExportOptions): Promise<Blob> {
  if (o.signal?.aborted) throw abortError();
  const frames = Math.round(o.durationSec * FPS);
  const canvas = new OffscreenCanvas(o.width, o.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  const codec = (await canEncodeVideo("vp9", { width: o.width, height: o.height })) ? "vp9" : "vp8";
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: "opus", bitrate: QUALITY_HIGH });
  output.addVideoTrack(video);
  output.addAudioTrack(audio);
  try {
    await output.start();
    const audioDone = audio.add(toAudioBuffer(o.channels)); // awaited after the video so the muxer can interleave
    for (let f = 0; f < frames; f++) {
      if (o.signal?.aborted) throw abortError();
      const bmp = await o.getFrame(f / FPS);
      ctx.drawImage(bmp, 0, 0, o.width, o.height);
      bmp.close();
      await video.add(f / FPS, 1 / FPS);
      if (f % 15 === 14) o.onProgress?.((f + 1) / frames);
    }
    await audioDone;
    await output.finalize();
    o.onProgress?.(1);
    const buf = output.target.buffer;
    if (!buf) throw new Error("The video file was not written");
    return new Blob([buf], { type: "video/webm" });
  } catch (e) {
    if (output.state !== "canceled" && output.state !== "finalized") await output.cancel().catch(() => {});
    throw e;
  }
}
