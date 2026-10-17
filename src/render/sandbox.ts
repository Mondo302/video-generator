// Runs model-written animation code where it cannot reach the app:
//   page -> <iframe sandbox="allow-scripts"> (opaque origin, CSP: no network) -> module Worker (OffscreenCanvas)
// Frames are drawn in the Worker, so a module that hangs while drawing never blocks the page: every request
// has a deadline, and on a miss the iframe is removed, which terminates its Worker.
// Audio needs OfflineAudioContext, which Workers do not have, so renderAudio runs on the iframe's own thread,
// only after the Worker has already loaded and drawn the module successfully.

export type SandboxMeta = { durationSec: number; fps: number };
export type Sandbox = {
  load(code: string): Promise<SandboxMeta>;
  frame(t: number): Promise<{ bitmap: ImageBitmap; ms: number }>;
  audio(durationSec: number): Promise<Float32Array[]>;
  destroy(): void;
  readonly destroyed: boolean;
};

const DEADLINE = { load: 5000, frame: 2000, audio: 15000 } as const;
const SR = 48000;

// Classic Worker (module Workers from blob URLs fail inside an opaque-origin iframe). The module's own
// source is placed inside an async function, its top-level "export" keywords removed, so its names stay private.
const WORKER_SRC = `
let mod = null, cv = null, cx = null, W = 0, H = 0;
onmessage = async (e) => { const m = e.data; try {
  if (m.op === 'load') {
    mod = await self.__module;
    if (!mod || typeof mod.renderFrame !== 'function' || typeof mod.renderAudio !== 'function' || !mod.meta) throw new Error('The module must export meta, renderFrame and renderAudio.');
    W = m.W; H = m.H; cv = new OffscreenCanvas(W, H); cx = cv.getContext('2d');
    postMessage({ id: m.id, ok: true, meta: JSON.parse(JSON.stringify(mod.meta)) });
  } else if (m.op === 'frame') {
    if (cx.reset) cx.reset(); cx.clearRect(0, 0, W, H);
    const t0 = performance.now(); mod.renderFrame(cx, m.t, W, H); const ms = performance.now() - t0;
    const bmp = cv.transferToImageBitmap();
    postMessage({ id: m.id, ok: true, bmp, ms }, [bmp]);
  }
} catch (err) { postMessage({ id: m.id, ok: false, error: String((err && err.stack) || err) }); } };`;

/** The module as a classic script body: top-level "export " removed, exports returned from an async function. */
export function toWorkerScript(code: string): string {
  const body = code.replace(/^export\s+(?=(?:const|let|var|function|async|class)\b)/gm, "");
  return `self.__module = (async () => {
${body}
;return { meta: typeof meta === "undefined" ? undefined : meta, renderFrame: typeof renderFrame === "undefined" ? undefined : renderFrame, renderAudio: typeof renderAudio === "undefined" ? undefined : renderAudio };
})();
self.__module.catch(() => {});
` + WORKER_SRC;
}

function childDocument(W: number, H: number): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:">
<script>
let worker = null, codeUrl = null, mod = null;
const toParent = (d, transfer) => parent.postMessage(d, '*', transfer || []);
addEventListener('message', async (e) => { if (e.source !== parent) return; const m = e.data; try {
  if (m.op === 'load') {
    codeUrl = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
    worker = new Worker(URL.createObjectURL(new Blob([m.script], { type: 'text/javascript' })));
    worker.onmessage = (ev) => toParent(ev.data, ev.data.bmp ? [ev.data.bmp] : []);
    worker.onerror = (ev) => toParent({ id: m.id, ok: false, error: 'Worker error: ' + (ev.message || 'unknown') });
    worker.postMessage({ id: m.id, op: 'load', url: codeUrl, W: ${W}, H: ${H} });
  } else if (m.op === 'frame') {
    worker.postMessage(m);
  } else if (m.op === 'audio') {
    if (!mod) mod = await import(codeUrl);
    const ac = new OfflineAudioContext(2, Math.max(1, Math.round(m.dur * ${SR})), ${SR});
    await mod.renderAudio(ac);
    const buf = await ac.startRendering();
    const chans = [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
    toParent({ id: m.id, ok: true, chans }, chans.map((c) => c.buffer));
  }
} catch (err) { toParent({ id: m.id, ok: false, error: String((err && err.stack) || err) }); } });
<\/script>`;
}

export function createSandbox(width: number, height: number): Sandbox {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  iframe.srcdoc = childDocument(width, height);
  let destroyed = false;
  let nextId = 1;
  const waiting = new Map<number, { res: (d: Record<string, unknown>) => void; rej: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const ready = new Promise<void>((r) => { iframe.onload = () => r(); });
  document.body.append(iframe);

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const d = e.data as { id: number; ok: boolean; error?: string };
    const w = waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    clearTimeout(w.timer);
    if (d.ok) w.res(d as unknown as Record<string, unknown>);
    else w.rej(new Error(d.error ?? "Unknown error in the video code"));
  };
  window.addEventListener("message", onMessage);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("message", onMessage);
    iframe.remove(); // ends the iframe's document and its Worker
    for (const w of waiting.values()) { clearTimeout(w.timer); w.rej(new Error("The video code was stopped.")); }
    waiting.clear();
  }

  async function rpc(op: keyof typeof DEADLINE, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (destroyed) throw new Error("The video code was stopped.");
    await ready;
    const id = nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        destroy(); // a module that does not answer in time is killed, not waited on
        rej(new Error(`The video code did not answer within ${DEADLINE[op] / 1000} s (${op}). It was stopped.`));
      }, DEADLINE[op]);
      waiting.set(id, { res, rej, timer });
      iframe.contentWindow?.postMessage({ id, op, ...payload }, "*");
    });
  }

  return {
    get destroyed() { return destroyed; },
    async load(code) { return (await rpc("load", { code, script: toWorkerScript(code) })).meta as SandboxMeta; },
    async frame(t) { const d = await rpc("frame", { t }); return { bitmap: d.bmp as ImageBitmap, ms: d.ms as number }; },
    async audio(durationSec) { return (await rpc("audio", { dur: durationSec })).chans as Float32Array[]; },
    destroy,
  };
}

export type Validation = { ok: true; meta: SandboxMeta; audio: Float32Array[]; frameMsMax: number } | { ok: false; problems: string[] };

/** Load and check a module before showing it: ~10 sample frames (errors, time, blank, partly painted), determinism, audio. */
export async function validateModule(sb: Sandbox, code: string): Promise<Validation> {
  const problems: string[] = [];
  let meta: SandboxMeta;
  try { meta = await sb.load(code); } catch (e) { return { ok: false, problems: ["The code did not load: " + firstLines((e as Error).message)] }; }
  if (!(meta.durationSec >= 3 && meta.durationSec <= 60) || meta.fps !== 30) problems.push(`meta must be { durationSec: 3 to 60, fps: 30 }, got ${JSON.stringify(meta)}`);
  const dur = Math.min(60, Math.max(3, Number(meta.durationSec) || 30));
  const probe = new OffscreenCanvas(160, 90);
  const pg = probe.getContext("2d", { willReadFrequently: true });
  if (!pg) return { ok: false, problems: ["2D canvas is not available"] };
  const signature = (bmp: ImageBitmap) => {
    pg.clearRect(0, 0, 160, 90);
    pg.drawImage(bmp, 0, 0, 160, 90);
    const d = pg.getImageData(0, 0, 160, 90).data;
    const colours = new Set<number>();
    let opaque = 0, hash = 0;
    for (let i = 0; i < d.length; i += 4) { colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); if (d[i + 3] > 250) opaque++; hash = (Math.imul(hash, 31) + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0; }
    return { colours: colours.size, opaque: opaque / (d.length / 4), hash };
  };
  let frameMsMax = 0;
  const times = [0, ...Array.from({ length: 9 }, (_, k) => +((dur * (k + 1)) / 10).toFixed(3)), Math.max(0, dur - 1 / 30)];
  for (const t of times) {
    try {
      const { bitmap, ms } = await sb.frame(t);
      const s = signature(bitmap);
      bitmap.close();
      frameMsMax = Math.max(frameMsMax, ms);
      if (ms > 200) problems.push(`The frame at ${t} s took ${Math.round(ms)} ms to draw (limit 200 ms).`);
      if (s.colours < 2) problems.push(`The frame at ${t} s is blank (one colour).`);
      if (s.opaque < 0.99) problems.push(`The frame at ${t} s does not paint the whole canvas.`);
    } catch (e) {
      problems.push(`The frame at ${t} s failed: ${firstLines((e as Error).message)}`);
      if (sb.destroyed) return { ok: false, problems };
    }
  }
  try {
    const tt = +(dur / 3).toFixed(3);
    const a = await sb.frame(tt), sa = signature(a.bitmap); a.bitmap.close();
    (await sb.frame(tt / 2)).bitmap.close();
    const b = await sb.frame(tt), sb2 = signature(b.bitmap); b.bitmap.close();
    if (sa.hash !== sb2.hash) problems.push(`renderFrame is not a pure function of t: t = ${tt} s drew two different pictures.`);
  } catch (e) { problems.push("Determinism check failed: " + firstLines((e as Error).message)); if (sb.destroyed) return { ok: false, problems }; }
  let audio: Float32Array[] = [];
  try {
    audio = await sb.audio(dur);
    let peak = 0;
    for (const c of audio) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
    if (peak < 0.001) problems.push("The audio is silent.");
  } catch (e) { problems.push("The audio failed: " + firstLines((e as Error).message)); }
  return problems.length ? { ok: false, problems } : { ok: true, meta: { durationSec: dur, fps: 30 }, audio, frameMsMax };
}

const firstLines = (s: string) => s.split("\n").slice(0, 3).join(" | ");
